#!/usr/bin/env python3
"""Fetches the speech models for the hosted server (tools/live.Dockerfile runs this while building the image).

    python tools/fetch-models.py --out /models           download, check size and SHA-256, keep only verified files
    python tools/fetch-models.py --verify ~/sherpa-models  only check files that are already there (no network)

Every file is pinned: the Hugging Face files by commit, all of them by size and SHA-256, so a changed or damaged
download stops the build instead of reaching the server. Sources (all public):
  - TalTechNLP/streaming-zipformer-large.et-en.w2n (Hugging Face, Apache-2.0): Estonian streaming speech recogniser, ~598 MB
  - nemo_en_titanet_small.onnx (k2-fsa/sherpa-onnx release "speaker-recongition-models"): speaker embedding model, ~40 MB.
    Its licence has not been checked yet: check it before the hosted pilot has other people in it.
Standard library only.
"""

import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

ASR_REVISION = "82d23225b01ff8962847d95dd30234f1e737b724"
ASR_REPO = f"https://huggingface.co/TalTechNLP/streaming-zipformer-large.et-en.w2n/resolve/{ASR_REVISION}"
SPEAKER_RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models"

# (url, path under --out, size in bytes, SHA-256)
MODELS = [
    (f"{ASR_REPO}/encoder.onnx", "streaming-zipformer-large.et-en.w2n/encoder.onnx", 592970112,
     "3a9bd0025feb459a5c0d4ed2f072e76e30598c3fb9e66bf3c578f58104b527e7"),
    (f"{ASR_REPO}/decoder.onnx", "streaming-zipformer-large.et-en.w2n/decoder.onnx", 3117082,
     "1823fda916dfd5070d5edf33b7f0bda3534790fbe85fed318400b4077dd38fe8"),
    (f"{ASR_REPO}/joiner.onnx", "streaming-zipformer-large.et-en.w2n/joiner.onnx", 2052462,
     "56b25cd31740be5c9e6e6b79f09282b760ab985950b65493d4eae49917e072c8"),
    (f"{ASR_REPO}/tokens.txt", "streaming-zipformer-large.et-en.w2n/tokens.txt", 11493,
     "cbe23ea2ef76303d874ab45ef8471b570e565b9048ab0aeda1c7adf2c663ee97"),
    (f"{SPEAKER_RELEASE}/nemo_en_titanet_small.onnx", "nemo_en_titanet_small.onnx", 40257283,
     "ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e"),
]
CHUNK = 1 << 20


def check(path: Path, size: int, sha256: str) -> str | None:
    """None if the file is as expected, otherwise what is wrong with it."""
    if not path.is_file():
        return "puudub"
    if path.stat().st_size != size:
        return f"suurus {path.stat().st_size} B, oodati {size} B"
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while block := f.read(CHUNK):
            digest.update(block)
    return None if digest.hexdigest() == sha256 else f"SHA-256 {digest.hexdigest()[:12]}…, oodati {sha256[:12]}…"


def download(url: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "konevali-fetch-models"})
    with urllib.request.urlopen(request, timeout=60) as response, partial.open("wb") as out:
        while block := response.read(CHUNK):
            out.write(block)
    partial.replace(target)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Download (or only verify) the pinned speech models.")
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument("--out", type=Path, help="folder to download into")
    group.add_argument("--verify", type=Path, help="check the files already in this folder, download nothing")
    args = p.parse_args(argv)
    folder = args.out or args.verify
    bad = 0
    for url, relative, size, sha256 in MODELS:
        target = folder / relative
        problem = check(target, size, sha256)
        if problem and args.out:
            print(f"laen alla {relative} ({size / 1e6:.1f} MB)", flush=True)
            download(url, target)
            problem = check(target, size, sha256)
            if problem:
                target.unlink(missing_ok=True)  # never keep a file that is not the pinned one
        print(f"{'OK ' if problem is None else 'VIGA'} {relative}" + (f": {problem}" if problem else ""), flush=True)
        bad += problem is not None
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
