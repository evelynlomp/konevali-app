#!/usr/bin/env python3
"""Live ASR server for Kõneväli, stage 0: microphone audio in over a WebSocket, finished sentences out. One speaker "A".

    pip install sherpa-onnx numpy websockets
    python tools/live-server.py --model-dir sherpa-models/streaming-zipformer-large.et-en.w2n

Then run the app (npm run dev) and open  http://localhost:5173/vali?live  . The browser asks for the microphone.

Protocol (the browser's LiveSpeechSource is the other end):
  browser -> server  binary frames: 16 kHz, mono, 16-bit little-endian PCM, any frame size
                     text "end": decode what is left and send the last sentences (used by tools/live-test-client.py)
  server -> browser  text frames, JSON: {"type": "final", "speaker": "A", "text": "...", "start": ms, "t": ms, "lag": s}
                     start / t = audio time of the sentence's first / last token, lag = audio seconds between t and the moment
                     the sentence was sent

What it does is what `make-replay.py --gain --decoding-method greedy_search --window 8` does offline, but with only the
audio heard so far: the gain and the "quiet" level come from a running window of the last minute, a fresh stream starts at
the first pause after --window seconds (or after 3 x that at the latest), and a sentence is sent as soon as its
punctuation is recognised, or after --break seconds of silence.

Speaker names (stage 1a). With --roster (made by tools/make-roster.py) and --speaker-model (the same model) every
sentence is named after the closest enrolled voice, or "Tundmatu" when nobody on the roster is close enough
(or, for a sentence under 0.8 s, after the previous sentence). The event then also carries "name", "score" (best
similarity), "margin" (lead over the second best), "short" and "embed_ms" (time the voice comparison took). The roster
is read once at start-up; there is no enrolment over the WebSocket yet. Without --roster every sentence is "A".

The server keeps no text. For the roster it keeps the last ~90 s of raw audio of the connection in memory, to compare
the voice of each sentence; nothing is written to disk. With --verbose it prints the sentences (only for local testing).
"""

import argparse
import asyncio
import importlib.util
import json
import sys
import threading
import time
from collections import deque
from pathlib import Path

import numpy as np
from websockets.exceptions import ConnectionClosed

_spec = importlib.util.spec_from_file_location("make_replay", Path(__file__).with_name("make-replay.py"))
mr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mr)

RATE = 16000
CHUNK = RATE // 10  # the recogniser is fed 100 ms at a time
POLL_CHUNKS = 3  # new words are looked for every 300 ms
LEVEL_HISTORY = 600  # chunks (one minute) that the running gain and quiet level are taken from
MIN_LEVEL_CHUNKS = 10  # gain starts after 1 s of audio ...
MIN_QUIET_CHUNKS = 50  # ... and the quiet level (and so cutting at pauses) after 5 s
MAX_GAIN_DB = 30.0
GAIN_STEP_DB = 1.0  # the gain moves at most this much per chunk, so it does not jump
MAX_WINDOW_FACTOR = 3  # a stream is cut after this many windows even without a pause
RAW_CHUNKS = 900  # chunks (90 s) of raw audio kept for the roster; a sentence is never this long


class Roster:
    """The enrolled voices and the speaker embedding model, shared by all connections."""

    def __init__(self, args):
        data = mr.load_roster(args.roster)
        if data["model"] != Path(args.speaker_model).name:
            sys.exit(f"Nimekiri on tehtud mudeliga {data['model']}, aga --speaker-model on {Path(args.speaker_model).name}.")
        self.people = data["people"]
        self.threshold = args.roster_threshold if args.roster_threshold is not None else data["threshold"]
        self.embed, _ = mr.create_speaker_embedder(args)
        self.lock = threading.Lock()  # one comparison at a time, whichever connection asks

    def label(self, segment: np.ndarray) -> tuple[str, float, float | None, float]:
        """(name or Tundmatu, similarity, margin, milliseconds it took) for the voice in `segment` (16 kHz)."""
        started = time.perf_counter()
        with self.lock:
            vector = self.embed(segment, RATE)
        if vector is None:
            return mr.UNKNOWN, 0.0, None, (time.perf_counter() - started) * 1000
        name, score, margin = mr.closest_person(vector, self.people, self.threshold)
        return name, score, margin, (time.perf_counter() - started) * 1000


class LiveSession:
    """One browser connection: its own recogniser stream, sentence builder and gain."""

    def __init__(self, recognizer, window_s: float, break_s: float, max_words: int, roster: Roster | None = None):
        self.recognizer, self.window_s, self.roster = recognizer, window_s, roster
        self.raw: deque[np.ndarray] = deque(maxlen=RAW_CHUNKS)  # untouched 100 ms chunks, for the roster
        self.raw_first = 0  # index of the oldest chunk in self.raw
        self.previous_name: str | None = None
        self.counts: dict[str, int] = {}
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

    def feed(self, pcm: bytes) -> list[dict]:
        """Take 16-bit PCM bytes; return the sentences finished by them."""
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
        if self.roster:
            if len(self.raw) == self.raw.maxlen:
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

    def _name(self, event: dict) -> dict:
        """The roster's verdict on a sentence: fields to add to the event."""
        segment = self._segment(event["start"], event["t"])
        if len(segment) < mr.ROSTER_MIN_SECONDS * RATE:
            name = self.previous_name or mr.UNKNOWN
            return {"speaker": name, "name": name, "short": True}
        name, score, margin, embed_ms = self.roster.label(segment)
        self.previous_name = name
        extra = {"speaker": name, "name": name, "score": round(score, 3), "embed_ms": round(embed_ms)}
        if margin is not None:
            extra["margin"] = round(margin, 3)
        return extra

    def _new_events(self) -> list[dict]:
        events = self.builder.events[self.sent:]
        self.sent = len(self.builder.events)
        out = []
        for e in events:
            event = {"type": "final", "speaker": e["speaker"], "text": e["text"], "start": e["start"], "t": e["t"]}
            if self.roster:
                event.update(self._name(event))
                self.counts[event["speaker"]] = self.counts.get(event["speaker"], 0) + 1
            event["lag"] = round(max(0.0, self.audio_s - e["t"] / 1000), 2)
            out.append(event)
        return out


async def handle(ws, recognizer, args, active: set, roster: Roster | None = None) -> None:
    if len(active) >= args.max_connections:
        await ws.close(code=1013, reason="busy")
        return
    session = LiveSession(recognizer, args.window, args.break_s, args.max_words, roster)
    active.add(ws)
    print(f"yhendus avatud ({len(active)} aktiivset)", file=sys.stderr)
    loop = asyncio.get_running_loop()
    try:
        async for message in ws:
            if isinstance(message, bytes):
                events = await loop.run_in_executor(None, session.feed, message)
            elif message == "end":
                events = await loop.run_in_executor(None, session.finish)
            else:
                continue
            for event in events:
                if args.verbose:
                    who = f" {event['speaker']:<8} {event.get('score', 0):.2f} {event.get('embed_ms', 0):>3} ms" if roster else ""
                    print(f"[{event['t'] / 1000:6.1f}s lag {event['lag']:4.1f}s{who}] {event['text']}", file=sys.stderr)
                await ws.send(json.dumps(event, ensure_ascii=False))
    except ConnectionClosed:
        pass  # a browser tab that is closed does not say goodbye
    finally:
        active.discard(ws)
        counts = f"; lauseid nime järgi {session.counts}" if session.counts else ""
        print(f"yhendus suletud ({len(active)} aktiivset){counts}", file=sys.stderr)


async def serve(args) -> None:
    import websockets

    recognizer = mr.create_recognizer(argparse.Namespace(
        model_dir=args.model_dir, num_threads=args.num_threads, decoding_method="greedy_search",
        window=args.window, pause=1.2, max_chunk=600.0))
    roster = Roster(args) if args.roster else None
    active: set = set()
    origins = [None, *args.origin]  # None = clients that are not browsers
    async with websockets.serve(lambda ws: handle(ws, recognizer, args, active, roster), args.host, args.port,
                                origins=origins, max_size=1 << 20):
        names = f", nimekiri: {', '.join(sorted(roster.people))} (lävi {roster.threshold})" if roster else ""
        print(f"Kuulan ws://{args.host}:{args.port}  (aken {args.window} s, lubatud lehed: {', '.join(args.origin) or 'puuduvad'}{names})", file=sys.stderr)
        await asyncio.Future()


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Kõneväli live ASR server (stage 0, one speaker).")
    p.add_argument("--model-dir", required=True, help="folder with encoder.onnx, decoder.onnx, joiner.onnx, tokens.txt")
    p.add_argument("--host", default="127.0.0.1", help="address to listen on (default: this computer only)")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--origin", action="append", default=None, help="web page origin allowed to connect (repeatable; default http://localhost:5173 and http://127.0.0.1:5173)")
    p.add_argument("--window", type=float, default=8.0, help="seconds after which a fresh stream starts at the next pause (default 8)")
    p.add_argument("--break", dest="break_s", type=float, default=1.5, help="seconds of silence that end a sentence without punctuation (default 1.5)")
    p.add_argument("--max-words", type=int, default=18)
    p.add_argument("--max-connections", type=int, default=2)
    p.add_argument("--num-threads", type=int, default=2)
    p.add_argument("--speaker-model", help="speaker embedding model (.onnx), the one the roster was made with (needed with --roster)")
    p.add_argument("--roster", type=Path, help="roster made by tools/make-roster.py: sentences are named after the closest enrolled voice, or 'Tundmatu'")
    p.add_argument("--roster-threshold", type=float, help="similarity below which a voice is nobody on the roster (default: the value stored in the roster)")
    p.add_argument("--verbose", action="store_true", help="print every sentence to the terminal (local testing only)")
    args = p.parse_args(argv)
    args.origin = args.origin or ["http://localhost:5173", "http://127.0.0.1:5173"]
    if args.window <= 0:
        p.error("--window must be above 0")
    if args.roster and not args.speaker_model:
        p.error("--roster needs --speaker-model")
    return args


if __name__ == "__main__":
    try:
        asyncio.run(serve(parse_args()))
    except KeyboardInterrupt:
        pass
