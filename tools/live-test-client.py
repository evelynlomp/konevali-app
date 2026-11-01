#!/usr/bin/env python3
"""Plays a WAV file to tools/live-server.py like a microphone would and prints when each sentence arrives.

    python tools/live-test-client.py meeting.wav [--speed 1] [--url ws://localhost:8765] [--out events.json]

--speed 1 sends in real time (a 5-minute file takes 5 minutes); 4 is four times faster, but the server then has
less time per second of audio. "late" = how long after the sentence ended (in recording time) it arrived.
"""

import argparse
import asyncio
import importlib.util
import json
import sys
import time
from pathlib import Path

import numpy as np

_spec = importlib.util.spec_from_file_location("make_replay", Path(__file__).with_name("make-replay.py"))
mr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mr)

RATE = 16000
CHUNK = RATE // 10


def to_16k_pcm(samples: np.ndarray, rate: int) -> bytes:
    if rate != RATE:
        positions = np.arange(0, len(samples), rate / RATE)
        samples = np.interp(positions, np.arange(len(samples)), samples)
    return (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()


async def run(args) -> None:
    import websockets

    samples, rate = mr.read_wav(args.wav)
    pcm = to_16k_pcm(samples, rate)
    total = len(pcm) / 2 / RATE
    events: list[dict] = []
    started = time.monotonic()

    async with websockets.connect(args.url, max_size=1 << 20) as ws:
        async def receive():
            async for message in ws:
                event = json.loads(message)
                now = (time.monotonic() - started) * args.speed
                event["late"] = round(now - event["t"] / 1000, 1)
                events.append(event)
                print(f"[{event['t'] / 1000:6.1f}s  late {event['late']:5.1f}s] {event['text']}")

        receiver = asyncio.create_task(receive())
        step = CHUNK * 2
        for i, pos in enumerate(range(0, len(pcm), step)):
            await ws.send(pcm[pos: pos + step])
            wait = (i + 1) * 0.1 / args.speed - (time.monotonic() - started)
            if wait > 0:
                await asyncio.sleep(wait)
        await ws.send("end")
        await asyncio.sleep(2.0)  # the last sentences come back after "end"
        await ws.close()
        await receiver

    words = sum(len(e["text"].split()) for e in events)
    late = sorted(e["late"] for e in events)
    print(f"\n{total:.0f} s heli, {len(events)} lauset, {words} sõna; "
          f"hilinemine (sõnumi lõpust): mediaan {late[len(late) // 2]:.1f} s, 90. pr {late[int(len(late) * 0.9)]:.1f} s, max {late[-1]:.1f} s" if events else "\nÜhtegi lauset ei tulnud.")
    if args.out:
        # everything the server sent (a roster server adds name, score, margin, short, embed_ms), plus "late"
        args.out.write_text(json.dumps({"version": 1, "audio": args.wav.name, "events": [
            {k: v for k, v in e.items() if k != "type"} for e in events]}, ensure_ascii=False, indent=1), encoding="utf-8")


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("wav", type=Path)
    p.add_argument("--url", default="ws://localhost:8765")
    p.add_argument("--speed", type=float, default=1.0)
    p.add_argument("--out", type=Path, help="save the received sentences as a replay-like JSON")
    return p.parse_args(argv)


if __name__ == "__main__":
    asyncio.run(run(parse_args()))
