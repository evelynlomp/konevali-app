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

The server keeps no audio and no text; with --verbose it prints the sentences (only for local testing).
"""

import argparse
import asyncio
import importlib.util
import json
import sys
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


class LiveSession:
    """One browser connection: its own recogniser stream, sentence builder and gain."""

    def __init__(self, recognizer, window_s: float, break_s: float, max_words: int):
        self.recognizer, self.window_s = recognizer, window_s
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

    def _new_events(self) -> list[dict]:
        events = self.builder.events[self.sent:]
        self.sent = len(self.builder.events)
        return [{"type": "final", "speaker": e["speaker"], "text": e["text"], "start": e["start"], "t": e["t"],
                 "lag": round(max(0.0, self.audio_s - e["t"] / 1000), 2)} for e in events]


async def handle(ws, recognizer, args, active: set) -> None:
    if len(active) >= args.max_connections:
        await ws.close(code=1013, reason="busy")
        return
    session = LiveSession(recognizer, args.window, args.break_s, args.max_words)
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
                    print(f"[{event['t'] / 1000:6.1f}s lag {event['lag']:4.1f}s] {event['text']}", file=sys.stderr)
                await ws.send(json.dumps(event, ensure_ascii=False))
    except ConnectionClosed:
        pass  # a browser tab that is closed does not say goodbye
    finally:
        active.discard(ws)
        print(f"yhendus suletud ({len(active)} aktiivset)", file=sys.stderr)


async def serve(args) -> None:
    import websockets

    recognizer = mr.create_recognizer(argparse.Namespace(
        model_dir=args.model_dir, num_threads=args.num_threads, decoding_method="greedy_search",
        window=args.window, pause=1.2, max_chunk=600.0))
    active: set = set()
    origins = [None, *args.origin]  # None = clients that are not browsers
    async with websockets.serve(lambda ws: handle(ws, recognizer, args, active), args.host, args.port,
                                origins=origins, max_size=1 << 20):
        print(f"Kuulan ws://{args.host}:{args.port}  (aken {args.window} s, lubatud lehed: {', '.join(args.origin) or 'puuduvad'})", file=sys.stderr)
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
    p.add_argument("--verbose", action="store_true", help="print every sentence to the terminal (local testing only)")
    args = p.parse_args(argv)
    args.origin = args.origin or ["http://localhost:5173", "http://127.0.0.1:5173"]
    if args.window <= 0:
        p.error("--window must be above 0")
    return args


if __name__ == "__main__":
    try:
        asyncio.run(serve(parse_args()))
    except KeyboardInterrupt:
        pass
