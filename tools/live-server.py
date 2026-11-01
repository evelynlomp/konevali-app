#!/usr/bin/env python3
"""Live ASR server for Kõneväli: microphone audio in over a WebSocket, finished sentences out.

    pip install sherpa-onnx numpy websockets
    python tools/live-server.py --model-dir sherpa-models/streaming-zipformer-large.et-en.w2n \\
        [--speaker-model sherpa-models/speaker/nemo_en_titanet_small.onnx]

Then run the app (npm run dev) and open  http://localhost:5173/vali?live  . The browser asks for the microphone.

Protocol (the browser's LiveSpeechSource is the other end):
  browser -> server  binary frames: 16 kHz, mono, 16-bit little-endian PCM, any frame size
                     text "end": decode what is left and send the last sentences (used by tools/live-test-client.py)
                     text JSON: {"type": "hello", "key": ...}                       see "Public address" below
                                {"type": "names", "on": true | false}              turn names on / off (off wipes every voice print)
                                {"type": "enroll_start", "id": "..."}              the audio that follows is one person's voice sample
                                {"type": "enroll_end", "id": "..."}                ... until here; the server answers with "enroll"
                                {"type": "enroll_cancel"}                          throw the sample away
                                {"type": "remove", "id": "..."}                    delete that person's voice print
  server -> browser  text frames, JSON:
                     {"type": "ready", "names": bool}                               once, after the connection is accepted
                     {"type": "final", "speaker": "A", "text": "...", "start": ms, "t": ms, "lag": s}
                     {"type": "names", "on": bool, "ids": [...]}                    names state, after every change
                     {"type": "enroll", "id": "...", "ok": bool, "reason": "...", "seconds": s}
                     start / t = audio time of the sentence's first / last token, lag = audio seconds between t and the moment
                     the sentence was sent

What it does is what make-replay.py --gain --decoding-method greedy_search --window 8 does offline, but with only the
audio heard so far: the gain and the "quiet" level come from a running window of the last minute, a fresh stream starts at
the first pause after --window seconds (or after 3 x that at the latest), and a sentence is sent as soon as its
punctuation is recognised, or after --break seconds of silence.

Names. Without --speaker-model every sentence is "A". With it a connection can turn names on, and give a voice sample
per person (id chosen by the page); a sentence is then named (speaker = that id) after the closest voice print, or
"Tundmatu" when nobody is close enough or the sentence is too short to tell. Unsure always means "Tundmatu": nothing is
guessed. A voice print is a vector kept in the memory of that one connection, nothing else: it is not written to disk or
to the logs, it is used for nothing but naming, and it is deleted when names are turned off, when the person is removed,
or when the connection closes. The sample audio is dropped as soon as the print is made. While names are on and a print
exists, the raw audio of a sentence is held in memory only until that sentence has been named: from a half second before
its first word until the voice comparison is done, then it is deleted at once. While nobody is speaking only the latest
3 s are kept, and never more than 30 s in all (a safety cap; a sentence longer than that is named from its last 30 s).
A voice sample is not shown as text: the recogniser pauses while a sample is taken. A voice print is not used for
authentication, tracking, or to infer emotion, age, sex or anything else.

The server keeps no text. With --verbose it prints the sentences (only for local testing).

Public address (anything but localhost). Then the KONEVALI_TOKEN environment variable is required: a client must send
{"type": "hello", "key": "<token>"} as its first message within 5 s, or the connection is closed with code 4401. A
public server also refuses --verbose (it would log what people say). A connection with no message for 15 minutes is
closed (code 4408), which also ends its voice prints.
"""

import argparse
import asyncio
import hmac
import importlib.util
import json
import os
import re
import sys
import threading
from collections import deque
from pathlib import Path

import numpy as np
from websockets.exceptions import ConnectionClosed


def _load(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


mr = _load("make_replay", "make-replay.py")
mroster = _load("make_roster", "make-roster.py")  # its enrol(): one voice print from a short sample

RATE = 16000
CHUNK = RATE // 10  # the recogniser is fed 100 ms at a time
POLL_CHUNKS = 3  # new words are looked for every 300 ms
LEVEL_HISTORY = 600  # chunks (one minute) that the running gain and quiet level are taken from
MIN_LEVEL_CHUNKS = 10  # gain starts after 1 s of audio ...
MIN_QUIET_CHUNKS = 50  # ... and the quiet level (and so cutting at pauses) after 5 s
MAX_GAIN_DB = 30.0
GAIN_STEP_DB = 1.0  # the gain moves at most this much per chunk, so it does not jump
MAX_WINDOW_FACTOR = 3  # a stream is cut after this many windows even without a pause
RAW_MAX_CHUNKS = 300  # chunks (30 s): the most raw audio ever held, a safety cap (the longest sentence we measured was ~25 s)
RAW_LEAD_MS = 500  # audio kept from before a sentence's first token: the token's time is a little later than the speech
RAW_IDLE_MS = 3000  # while nothing is being said only this much of the latest audio is kept (a new sentence shows up a moment late)
MAX_PROFILES = 8  # voice prints per connection
ENROL_MAX_S = 30  # a voice sample longer than this is cut off
PROFILE_ID = re.compile(r"^[\w-]{1,64}$")
IDLE_TIMEOUT_S = 15 * 60.0
AUTH_TIMEOUT_S = 5.0
CLOSE_UNAUTHORIZED = 4401  # the page maps this to "access key missing or wrong"
CLOSE_IDLE = 4408


class VoiceNames:
    """The speaker embedding model, shared by all connections. It holds no voices: each connection keeps its own."""

    def __init__(self, args):
        model = Path(args.speaker_model).name
        threshold = args.names_threshold if args.names_threshold is not None else mroster.DEFAULT_THRESHOLDS.get(model)
        if threshold is None:
            sys.exit(f"Mudelile {model} pole vaikeläve: anna --names-threshold.")
        self.threshold = threshold
        self.embed, _ = mr.create_speaker_embedder(args)
        self.lock = threading.Lock()  # one comparison at a time, whichever connection asks

    def vector(self, segment: np.ndarray, rate: int = RATE):
        with self.lock:
            return self.embed(segment, rate)


class LiveSession:
    """One browser connection: its own recogniser stream, sentence builder, gain and (in memory only) voice prints."""

    def __init__(self, recognizer, window_s: float, break_s: float, max_words: int, names: VoiceNames | None = None):
        self.recognizer, self.window_s, self.names = recognizer, window_s, names
        self.names_on = False
        self.profiles: dict[str, np.ndarray] = {}  # id -> unit voice vector; the only voice data kept
        self.enrolling: tuple[str, bytearray] | None = None  # (id, the sample's audio so far)
        # untouched 100 ms chunks of audio that is still needed to name a sentence (see _drop_unneeded), only while a print exists
        self.raw: deque[np.ndarray] = deque(maxlen=RAW_MAX_CHUNKS)
        self.raw_first = 0  # index of the oldest chunk in self.raw
        self.builder = mr.SentenceBuilder("A", False, break_s, max_words)
        self.stream = recognizer.create_stream()
        self.window_start = 0.0  # audio time at which the current stream started
        self.committed = 0  # tokens of the current stream already given to the sentence builder
        self.audio_s = 0.0
        self.chunks = 0
        self.levels: deque[float] = deque(maxlen=LEVEL_HISTORY)
        self.quiet_chunks = 0
        self.gain_db = 0.0
        self.sent = 0
        self.pending = np.zeros(0, dtype=np.float32)

    # ---- audio and sentences ------------------------------------------------------------------------------------

    def feed(self, pcm: bytes) -> list[dict]:
        """Take 16-bit PCM bytes; return the sentences finished by them. While a voice sample is taken, the audio goes
        to the sample instead (and is not recognised)."""
        if self.enrolling is not None:
            sample = self.enrolling[1]
            room = ENROL_MAX_S * RATE * 2 - len(sample)
            if room > 0:
                sample += pcm[:room]
            return []
        usable = len(pcm) // 2 * 2
        audio = np.frombuffer(pcm[:usable], dtype="<i2").astype(np.float32) / 32768.0
        self.pending = np.concatenate([self.pending, audio])
        while len(self.pending) >= CHUNK:
            chunk, self.pending = self.pending[:CHUNK], self.pending[CHUNK:]
            self._chunk(chunk)
        return self._new_events()

    def finish(self) -> list[dict]:
        """The audio is over: decode what is left and end the sentence being built."""
        self._take_tokens(mr._finish_stream(self.recognizer, self.stream, RATE, self.window_start, self.audio_s))
        self.builder.flush()
        return self._new_events()

    def _chunk(self, chunk: np.ndarray) -> None:
        if self.profiles:
            if not self.raw:
                self.raw_first = self.chunks
            elif len(self.raw) == self.raw.maxlen:
                self.raw_first += 1
            self.raw.append(chunk.copy())
        level = float(10 * np.log10(np.mean(chunk ** 2) + 1e-12))
        self.levels.append(level)
        if len(self.levels) >= MIN_LEVEL_CHUNKS:
            wanted = min(MAX_GAIN_DB, max(0.0, mr.GAIN_TARGET_DB - float(np.percentile(self.levels, 90))))
            self.gain_db += max(-GAIN_STEP_DB, min(GAIN_STEP_DB, wanted - self.gain_db))
        heard = np.clip(chunk * 10 ** (self.gain_db / 20), -1, 1).astype(np.float32)
        quiet_below = float(np.percentile(self.levels, 10)) + mr.WINDOW_QUIET_DB
        quiet = len(self.levels) >= MIN_QUIET_CHUNKS and level < quiet_below
        self.quiet_chunks = self.quiet_chunks + 1 if quiet else 0

        self.stream.accept_waveform(RATE, heard)
        mr._decode_ready(self.recognizer, self.stream)
        self.audio_s += CHUNK / RATE
        self.chunks += 1

        age = self.audio_s - self.window_start
        pause = self.quiet_chunks >= mr.WINDOW_QUIET_S / mr.CHUNK_SECONDS
        if (age >= self.window_s and pause) or age >= self.window_s * MAX_WINDOW_FACTOR:
            self._take_tokens(mr._finish_stream(self.recognizer, self.stream, RATE, self.window_start, self.audio_s))
            self.stream, self.window_start, self.committed, self.quiet_chunks = self.recognizer.create_stream(), self.audio_s, 0, 0
        elif self.chunks % POLL_CHUNKS == 0:
            tokens = mr._chunk_tokens(self.recognizer, self.stream, self.audio_s - self.window_start)
            self._take_tokens([(text, when + self.window_start) for text, when in tokens])
        self.builder.flush_if_idle(self.audio_s)
        self._drop_unneeded()

    def _take_tokens(self, tokens: list) -> None:
        """Give the builder the tokens it has not seen yet (a greedy stream's tokens never change once written)."""
        fresh = tokens[self.committed:]
        self.committed = len(tokens)
        self.builder.add_chunk(fresh)

    def _segment(self, start_ms: int, end_ms: int) -> np.ndarray:
        """The raw audio of a sentence (16 kHz floats), or an empty array if it is no longer kept."""
        first = max(self.raw_first, int(start_ms / 100))
        last = min(self.raw_first + len(self.raw), int(end_ms / 100) + 1)
        if last <= first:
            return np.zeros(0, dtype=np.float32)
        audio = np.concatenate([self.raw[i - self.raw_first] for i in range(first, last)])
        begin = max(0, round(start_ms * RATE / 1000) - first * CHUNK)
        return audio[begin: begin + round((end_ms - start_ms) * RATE / 1000)]

    def _drop_before(self, ms: float) -> None:
        """Delete the raw audio older than `ms` (whole 100 ms chunks)."""
        first_kept = int(ms / 100)
        while self.raw and self.raw_first < first_kept:
            self.raw.popleft()
            self.raw_first += 1

    def _drop_unneeded(self) -> None:
        """Keep only the audio of sentences that are not named yet: those finished but not sent, the one being built, and
        a short lead-in; everything before that is deleted."""
        if not self.raw:
            return
        waiting = [e["start"] for e in self.builder.events[self.sent:]]
        building = self.builder.open_start_ms()
        if building is not None:
            waiting.append(building)
        keep_from = min(waiting) - RAW_LEAD_MS if waiting else self.audio_s * 1000 - RAW_IDLE_MS
        self._drop_before(keep_from)

    def _name(self, event: dict) -> dict:
        """Whose voice a sentence is: the id of the closest voice print, or "Tundmatu" if there is any doubt."""
        unknown = {"speaker": mr.UNKNOWN, "name": mr.UNKNOWN}
        segment = self._segment(event["start"], event["t"])
        if len(segment) < mr.ROSTER_MIN_SECONDS * RATE:
            return unknown  # too short to tell: not guessed
        vector = self.names.vector(segment)
        if vector is None:
            return unknown
        person, _, _ = mr.closest_person(vector, self.profiles, self.names.threshold)
        return unknown if person == mr.UNKNOWN else {"speaker": person}

    def _new_events(self) -> list[dict]:
        events = self.builder.events[self.sent:]
        self.sent = len(self.builder.events)
        out = []
        for e in events:
            event = {"type": "final", "speaker": e["speaker"], "text": e["text"], "start": e["start"], "t": e["t"]}
            if self.names and self.profiles:
                event.update(self._name(event))
                self._drop_before(e["t"])  # named: its audio is not needed any more (the chunk shared with the next sentence stays)
            event["lag"] = round(max(0.0, self.audio_s - e["t"] / 1000), 2)
            out.append(event)
        return out

    # ---- names and voice prints ---------------------------------------------------------------------------------

    def handle_text(self, text: str) -> list[dict]:
        """A text message from the page; the answers to send back."""
        if text == "end":
            return self.finish()
        try:
            message = json.loads(text)
        except ValueError:
            return []
        if not isinstance(message, dict):
            return []
        kind, pid = message.get("type"), message.get("id")
        if kind == "names":
            if message.get("on") is True and self.names:
                self.names_on = True
            else:
                self.wipe()
            return [self._state()]
        if kind == "remove":
            if isinstance(pid, str) and self.profiles.pop(pid, None) is not None and not self.profiles:
                self.raw.clear()
            return [self._state()]
        if kind == "enroll_cancel":
            self.enrolling = None
            return []
        if kind == "enroll_start":
            reason = self._enrol_refusal(pid)
            if reason:
                return [self._enrol_reply(pid, reason)]
            self.enrolling = (pid, bytearray())
            return []
        if kind == "enroll_end":
            return self._finish_enrol(pid)
        return []

    def wipe(self) -> None:
        """Names off: every voice print, the raw audio kept for them and any sample being taken are dropped at once."""
        self.names_on = False
        self.profiles.clear()
        self.raw.clear()
        self.enrolling = None

    def _state(self) -> dict:
        return {"type": "names", "on": self.names_on, "ids": sorted(self.profiles)}

    @staticmethod
    def _enrol_reply(pid, reason: str | None = None, seconds: float | None = None) -> dict:
        reply = {"type": "enroll", "id": pid if isinstance(pid, str) else "", "ok": reason is None}
        if reason:
            reply["reason"] = reason
        if seconds is not None:
            reply["seconds"] = seconds
        return reply

    def _enrol_refusal(self, pid) -> str | None:
        if not (self.names and self.names_on):
            return "unavailable"
        if not isinstance(pid, str) or not PROFILE_ID.match(pid) or pid == mr.UNKNOWN:
            return "bad_id"
        if pid not in self.profiles and len(self.profiles) >= MAX_PROFILES:
            return "limit"
        return None

    def _finish_enrol(self, pid) -> list[dict]:
        taken, self.enrolling = self.enrolling, None
        if taken is None or taken[0] != pid:
            return [self._enrol_reply(pid, "unavailable")]
        audio = np.frombuffer(bytes(taken[1][: len(taken[1]) // 2 * 2]), dtype="<i2").astype(np.float32) / 32768.0
        taken[1].clear()  # the sample's audio is not kept
        result = mroster.enrol(audio, RATE, lambda segment, rate: self.names.vector(segment, rate))
        if result is None or result["seconds"] < mroster.GOOD_SECONDS:
            return [self._enrol_reply(pid, "too_little")]
        if result["consistency"] is not None and result["consistency"] < self.names.threshold:
            return [self._enrol_reply(pid, "inconsistent")]
        vector = np.array(result["vector"], dtype=np.float32)
        self.profiles[pid] = vector / np.linalg.norm(vector)
        return [self._enrol_reply(pid, seconds=result["seconds"]), self._state()]


async def authorised(ws, token: str | None) -> bool:
    """With a token the first message must be {"type": "hello", "key": <token>}; without one anything goes (local use)."""
    if not token:
        return True
    try:
        first = await asyncio.wait_for(ws.recv(), AUTH_TIMEOUT_S)
        key = json.loads(first).get("key", "") if isinstance(first, str) else ""
    except (asyncio.TimeoutError, ConnectionClosed, ValueError, AttributeError):
        return False
    return isinstance(key, str) and hmac.compare_digest(key.encode(), token.encode())


async def handle(ws, recognizer, args, active: set, names: VoiceNames | None = None) -> None:
    if not await authorised(ws, args.token):
        await ws.close(code=CLOSE_UNAUTHORIZED, reason="unauthorized")
        return
    if len(active) >= args.max_connections:
        await ws.close(code=1013, reason="busy")
        return
    session = LiveSession(recognizer, args.window, args.break_s, args.max_words, names)
    active.add(ws)
    print(f"yhendus avatud ({len(active)} aktiivset)", file=sys.stderr)
    loop = asyncio.get_running_loop()
    try:
        await ws.send(json.dumps({"type": "ready", "names": names is not None}))
        while True:
            try:
                message = await asyncio.wait_for(ws.recv(), IDLE_TIMEOUT_S)
            except asyncio.TimeoutError:
                await ws.close(code=CLOSE_IDLE, reason="idle")
                break
            work = session.feed if isinstance(message, bytes) else session.handle_text
            for reply in await loop.run_in_executor(None, work, message):
                if args.verbose and reply.get("type") == "final":
                    print(f"[{reply['t'] / 1000:6.1f}s lag {reply['lag']:4.1f}s {reply['speaker']}] {reply['text']}", file=sys.stderr)
                await ws.send(json.dumps(reply, ensure_ascii=False))
    except ConnectionClosed:
        pass  # a browser tab that is closed does not say goodbye
    finally:
        session.wipe()  # voice prints end with the connection
        active.discard(ws)
        print(f"yhendus suletud ({len(active)} aktiivset)", file=sys.stderr)


async def serve(args) -> None:
    import websockets

    recognizer = mr.create_recognizer(argparse.Namespace(
        model_dir=args.model_dir, num_threads=args.num_threads, decoding_method="greedy_search",
        window=args.window, pause=1.2, max_chunk=600.0))
    names = VoiceNames(args) if args.speaker_model else None
    active: set = set()
    origins = [None, *args.origin]  # None = clients that are not browsers
    async with websockets.serve(lambda ws: handle(ws, recognizer, args, active, names), args.host, args.port,
                                origins=origins, max_size=1 << 20):
        shown = f", nimed võimalikud (lävi {names.threshold})" if names else ", nimed puuduvad"
        print(f"Kuulan ws://{args.host}:{args.port}  (aken {args.window} s, lubatud lehed: {', '.join(args.origin) or 'puuduvad'}{shown})", file=sys.stderr)
        await asyncio.Future()


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Kõneväli live ASR server.")
    p.add_argument("--model-dir", required=True, help="folder with encoder.onnx, decoder.onnx, joiner.onnx, tokens.txt")
    p.add_argument("--host", default="127.0.0.1", help="address to listen on (default: this computer only)")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--origin", action="append", default=None, help="web page origin allowed to connect (repeatable; default http://localhost:5173 and http://127.0.0.1:5173)")
    p.add_argument("--window", type=float, default=8.0, help="seconds after which a fresh stream starts at the next pause (default 8)")
    p.add_argument("--break", dest="break_s", type=float, default=1.5, help="seconds of silence that end a sentence without punctuation (default 1.5)")
    p.add_argument("--max-words", type=int, default=18)
    p.add_argument("--max-connections", type=int, default=2)
    p.add_argument("--num-threads", type=int, default=2)
    p.add_argument("--speaker-model", help="speaker embedding model (.onnx); with it a connection can turn names on (voice prints, in memory only)")
    p.add_argument("--names-threshold", type=float, help="similarity below which a voice is nobody (default depends on the speaker model)")
    p.add_argument("--verbose", action="store_true", help="print every sentence to the terminal (local testing only)")
    args = p.parse_args(argv)
    args.origin = args.origin or ["http://localhost:5173", "http://127.0.0.1:5173"]
    args.token = os.environ.get("KONEVALI_TOKEN") or None  # from the environment, never the command line (visible to other processes)
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        if not args.token:
            p.error("a server that listens on a public address needs the KONEVALI_TOKEN environment variable")
        if args.verbose:
            p.error("--verbose is not allowed on a public address: it would write what people say to the logs")
    if args.window <= 0:
        p.error("--window must be above 0")
    return args


if __name__ == "__main__":
    try:
        asyncio.run(serve(parse_args()))
    except KeyboardInterrupt:
        pass
