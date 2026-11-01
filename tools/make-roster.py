#!/usr/bin/env python3
"""Enrol people for Kõneväli: a short voice sample of each person -> roster.json (a voice print per name).

    python tools/make-roster.py --speaker-model sherpa-models/speaker/nemo_en_titanet_small.onnx --out roster.json \\
        --person "Mari=mari.wav" \\
        --person "Jaan=koosolek.wav@12.0-19.5,40-46"

A person is NAME=FILE, or NAME=FILE@START-END[,START-END...] (seconds) to take only the parts of a longer recording where
that person speaks alone. About 10 seconds of clear speech is plenty: on our recordings 5 s already recognised people
nearly as well. Then label a recording with the roster:

    python tools/make-replay.py meeting.wav --events-from ~/konevali-data/replay/meeting.json \\
        --speaker-model sherpa-models/speaker/nemo_en_titanet_small.onnx --roster roster.json

Sentences get the name of the closest enrolled voice, or "Tundmatu" if nobody on the roster is close enough.

A roster holds voice prints, which are personal biometric data: it is not committed (see .gitignore), keep it private.
The speaker model must be the same when the roster is made and when it is used. The default similarity thresholds are
starting values taken from five recordings, not calibrated; override with --threshold.
"""

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np

_spec = importlib.util.spec_from_file_location("make_replay", Path(__file__).with_name("make-replay.py"))
mr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mr)

# similarity below which a voice is "nobody on the roster", measured on rec5 (known voices 0.27-0.8, strangers 0.02-0.31)
DEFAULT_THRESHOLDS = {
    "nemo_en_titanet_small.onnx": 0.33,
    "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx": 0.36,
}
PIECE_SECONDS = 4.0  # the sample is cut into pieces of at most this length, each gets a voice print, the person's is their mean
MIN_PIECE_SECONDS = 1.5
GOOD_SECONDS = 5.0  # less speech than this gave clearly worse recognition
ACTIVE_BELOW_PEAK_DB = 30.0  # frames quieter than the loud ones by more than this are not speech


def parse_person(text: str) -> tuple[str, Path, list[tuple[float, float]] | None]:
    if "=" not in text:
        sys.exit(f"--person {text!r}: kirjuta NIMI=FAIL või NIMI=FAIL@ALGUS-LÕPP,...")
    name, rest = text.split("=", 1)
    path, _, ranges = rest.partition("@")
    parts = None
    if ranges:
        try:
            parts = [tuple(float(x) for x in r.split("-")) for r in ranges.split(",")]
            assert all(len(p) == 2 and p[0] < p[1] for p in parts)
        except (ValueError, AssertionError):
            sys.exit(f"--person {text!r}: ajavahemikud peavad olema kujul ALGUS-LÕPP sekundites")
    return name.strip(), Path(path.strip()), parts


def speech_pieces(samples: np.ndarray, rate: int) -> list[np.ndarray]:
    """The speech in `samples` (silence dropped) as pieces of MIN_PIECE_SECONDS..PIECE_SECONDS."""
    levels = mr.frame_db(samples, rate, 0.05)
    if len(levels) == 0:
        return []
    active = levels > float(np.percentile(levels, 90)) - ACTIVE_BELOW_PEAK_DB
    hop = int(rate * 0.05)
    runs, start = [], None
    for i, on in enumerate(list(active) + [False]):
        if on and start is None:
            start = i
        elif not on and start is not None:
            runs.append([start, i])
            start = None
    merged = []
    for a, b in runs:  # short dips are not pauses between sentences
        if merged and (a - merged[-1][1]) * 0.05 < 0.4:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    pieces = []
    for a, b in merged:
        n = max(1, round((b - a) * 0.05 / PIECE_SECONDS))
        for k in range(n):
            lo, hi = a + (b - a) * k // n, a + (b - a) * (k + 1) // n
            if (hi - lo) * 0.05 >= MIN_PIECE_SECONDS:
                pieces.append(samples[lo * hop: hi * hop])
    return pieces


def enrol(samples: np.ndarray, rate: int, embed) -> dict | None:
    """Voice print of one person from their sample: {"vector", "seconds", "pieces", "consistency"}."""
    pieces = speech_pieces(samples, rate)
    vectors = []
    for piece in pieces:
        v = embed(piece, rate)
        if v is not None:
            v = np.array(v, dtype=np.float32)
            vectors.append(v / np.linalg.norm(v))
    if not vectors:
        return None
    centre = np.mean(vectors, axis=0)
    centre /= np.linalg.norm(centre)
    consistency = None
    if len(vectors) > 1:  # how alike each piece is to the others: low = several voices or a lot of noise in the sample
        scores = []
        for i, v in enumerate(vectors):
            rest = np.mean([w for j, w in enumerate(vectors) if j != i], axis=0)
            scores.append(float(v @ rest / np.linalg.norm(rest)))
        consistency = float(np.mean(scores))
    return {"vector": centre.tolist(), "seconds": round(sum(len(p) for p in pieces) / rate, 1), "pieces": len(vectors),
            "consistency": None if consistency is None else round(consistency, 2)}


def main(argv=None) -> None:
    p = argparse.ArgumentParser(description="Make a roster (voice prints of named people) from short voice samples.")
    p.add_argument("--speaker-model", required=True, help="speaker embedding model (.onnx), the same one make-replay.py will use")
    p.add_argument("--person", action="append", required=True, help="NAME=FILE or NAME=FILE@START-END[,START-END...] (seconds)")
    p.add_argument("--out", type=Path, help="roster file (default: <data folder>/rosters/roster.json, outside the repository)")
    p.add_argument("--threshold", type=float, help="cosine similarity below which a voice is nobody on the roster (default depends on the model)")
    p.add_argument("--num-threads", type=int, default=2)
    args = p.parse_args(argv)

    model_name = Path(args.speaker_model).name
    threshold = args.threshold if args.threshold is not None else DEFAULT_THRESHOLDS.get(model_name)
    if threshold is None:
        sys.exit(f"Mudelile {model_name} pole vaikeläve: anna --threshold. (WeSpeaker ei sobi: tundmatuid ei saa usaldusväärselt eristada.)")
    embed, _ = mr.create_speaker_embedder(args)

    people, warnings = [], []
    print(f"{'nimi':<14}{'kõnet':>8}{'osi':>5}{'ühtlus':>8}", file=sys.stderr)
    for text in args.person:
        name, path, ranges = parse_person(text)
        if not path.is_file():
            sys.exit(f"Faili ei leitud: {path}")
        samples, rate = mr.read_wav(path)
        if ranges:
            samples = np.concatenate([samples[int(a * rate): int(b * rate)] for a, b in ranges])
        result = enrol(samples, rate, embed)
        if result is None:
            sys.exit(f"{name}: näites ei leidunud piisavalt kõnet (vaja vähemalt {MIN_PIECE_SECONDS:.1f} s järjest)")
        people.append({"name": name, **result})
        shown = "-" if result["consistency"] is None else f"{result['consistency']:.2f}"
        print(f"{name:<14}{result['seconds']:>7.1f}s{result['pieces']:>5}{shown:>8}", file=sys.stderr)
        if result["seconds"] < GOOD_SECONDS:
            warnings.append(f"{name}: kõnet vaid {result['seconds']:.1f} s, parem on vähemalt {GOOD_SECONDS:.0f} s (soovitavalt ~10 s)")
        if result["consistency"] is not None and result["consistency"] < threshold:
            warnings.append(f"{name}: näite osad on üksteisega vähe sarnased ({result['consistency']:.2f} < {threshold}); proovis võib olla mitu häält või palju müra")
    for w in warnings:
        print("Hoiatus:", w, file=sys.stderr)

    roster = {"version": 1, "model": model_name, "threshold": threshold,
              "note": "voice prints are personal biometric data: keep private, do not commit", "people": people}
    out = args.out or mr.data_dir() / "rosters" / "roster.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(roster, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(people)} inimest -> {out} (lävi {threshold})", file=sys.stderr)


if __name__ == "__main__":
    main()
