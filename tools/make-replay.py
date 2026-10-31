#!/usr/bin/env python3
"""Turn a WAV recording into a Kõneväli replay file, using Sherpa-ONNX streaming ASR.

First version: every sentence gets the same speaker ("A"); no speaker embeddings yet.

    WAV  ->  Sherpa ASR (tokens with times)  ->  sentences  ->  replay JSON  ->  /vali?replay=<name>

Setup (once):

    pip install sherpa-onnx numpy

    # the Estonian streaming model, kept outside the repository (it is large):
    mkdir sherpa-models/streaming-zipformer-large.et-en.w2n
    for f in encoder.onnx decoder.onnx joiner.onnx tokens.txt; do
      curl -L -o sherpa-models/streaming-zipformer-large.et-en.w2n/$f \
        https://huggingface.co/TalTechNLP/streaming-zipformer-large.et-en.w2n/resolve/main/$f
    done

Run (from the repository root):

    python tools/make-replay.py meeting.wav --model-dir sherpa-models/streaming-zipformer-large.et-en.w2n

Then start the app and open  http://localhost:5173/vali?replay=meeting

The WAV must be 16-, 24- or 32-bit integer PCM (any sample rate, any channel count; several channels are averaged).
To convert something else:  ffmpeg -i input.m4a -ac 1 -ar 16000 meeting.wav

How sentences are found. The model writes punctuation itself, and Sherpa gives every token a time. So the text is
cut into sentences at ". ? !", and each sentence gets the time of its last token. A sentence is never cut by the
recogniser itself (that loses words), but a pause is not a reason to cut either: a sentence goes on across short
pauses until punctuation, a long silence (--break) or a long run of words (--max-words, at a comma) ends it.

The output goes to public/replay/<wav name>.json. That folder is not ignored by git yet:
do not commit a replay of a real meeting.
"""

import argparse
import json
import sys
import wave
from pathlib import Path

import numpy as np

CHUNK_SECONDS = 0.1  # audio is fed to the recognizer in 100 ms pieces, like a live stream
TAIL_SECONDS = 0.66  # silence appended at the end so the last words are decoded (as Sherpa's own examples do)
MODEL_FILES = {"tokens": "tokens.txt", "encoder": "encoder.onnx", "decoder": "decoder.onnx", "joiner": "joiner.onnx"}
SENTENCE_END = {".", "?", "!"}
MIN_TAIL_WORDS = 4  # a sentence is not cut at a comma if this few words or fewer would be left

Token = tuple[str, float]  # (token text, absolute time in seconds); a leading space marks the start of a word


def _pcm_to_float(raw: bytes, width: int) -> np.ndarray:
    """Little-endian integer PCM of `width` bytes per sample -> float32 in [-1, 1)."""
    if width == 2:
        return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if width == 4:
        return np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    # 24-bit: three bytes per sample, sign-extended by hand (numpy has no 3-byte integer)
    b = np.frombuffer(raw[: len(raw) // 3 * 3], dtype=np.uint8).reshape(-1, 3).astype(np.int32)
    value = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
    value = np.where(value >= 0x800000, value - 0x1000000, value)
    return value.astype(np.float32) / 8388608.0


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    """16-, 24- or 32-bit integer PCM WAV -> (float32 mono samples in [-1, 1], sample rate)."""
    try:
        with wave.open(str(path), "rb") as f:
            channels, width, rate = f.getnchannels(), f.getsampwidth(), f.getframerate()
            raw = f.readframes(f.getnframes())
    except (wave.Error, EOFError) as error:
        sys.exit(f"Ei saa WAV-i lugeda ({error}). Teisenda: ffmpeg -i {path.name} -ac 1 -ar 16000 uus.wav")
    if width not in (2, 3, 4):
        sys.exit(f"Vaja on 16-, 24- või 32-bitist PCM WAV-i, siin on {8 * width}-bitine. Teisenda: ffmpeg -i {path.name} -ac 1 -ar 16000 uus.wav")
    samples = _pcm_to_float(raw, width)
    if channels > 1:
        samples = samples[: len(samples) // channels * channels].reshape(-1, channels).mean(axis=1)
    return samples, rate


def _decode_ready(recognizer, stream) -> None:
    while recognizer.is_ready(stream):
        recognizer.decode_stream(stream)


def _chunk_tokens(recognizer, stream, fallback_s: float) -> list[Token]:
    """The tokens recognised since the last reset, with absolute times in seconds.

    Sherpa gives token times relative to the result's start_time. If the installed version does not
    give tokens with times, fall back to the whole text as one token placed at `fallback_s`.
    """
    result = recognizer.get_result_all(stream)
    tokens = list(getattr(result, "tokens", None) or [])
    stamps = list(getattr(result, "timestamps", None) or [])
    if tokens and len(tokens) == len(stamps):
        start = getattr(result, "start_time", None)
        base = fallback_s if start is None else float(start)
        return [(t, base + float(s)) for t, s in zip(tokens, stamps)]
    text = " ".join(str(getattr(result, "text", result)).split())
    return [(" " + text, fallback_s)] if text else []


class SentenceBuilder:
    """Collects tokens, possibly from several recogniser chunks, and cuts them into sentence events."""

    def __init__(self, speaker: str = "A", capitalize: bool = False, break_s: float = 1.5, max_words: int = 18):
        self.speaker, self.capitalize, self.break_s, self.max_words = speaker, capitalize, break_s, max_words
        self.events: list[dict] = []
        self._pending: list[Token] = []
        self._last_t = 0

    def add_chunk(self, tokens: list[Token]) -> None:
        if not tokens:
            return
        # a long silence between chunks ends the sentence even without punctuation
        if self._pending and tokens[0][1] - self._pending[-1][1] >= self.break_s:
            self.flush()
        for i, (text, when) in enumerate(tokens):
            self._pending.append((text, when))
            following = tokens[i + 1][0] if i + 1 < len(tokens) else None
            if self._ends_sentence(text, following) or self._too_long(text, following, tokens, i):
                self.flush()

    def flush(self) -> None:
        """End the sentence being built (if any) and add it as an event."""
        pending, self._pending = self._pending, []
        text = " ".join("".join(t for t, _ in pending).split())
        if not any(c.isalnum() for c in text):
            return
        if self.capitalize:
            text = text[0].upper() + text[1:]
        start = round(pending[0][1] * 1000)
        end = max(round(pending[-1][1] * 1000), start, self._last_t)  # never earlier than the previous event
        self._last_t = end
        self.events.append({"t": end, "speaker": self.speaker, "text": text, "start": start})

    @staticmethod
    def _ends_sentence(text: str, following: str | None) -> bool:
        if text.strip() not in SENTENCE_END:
            return False
        # "8.5": a full stop glued to the next token is part of a number, not the end of a sentence
        return following is None or following[:1].isspace()

    def _too_long(self, text: str, following: str | None, tokens: list[Token], i: int) -> bool:
        words = sum(1 for t, _ in self._pending if t[:1].isspace())
        if following is not None and not following[:1].isspace():
            return False  # never cut inside a word
        if words >= 2 * self.max_words:
            return True
        if words < self.max_words or text.strip() != ",":
            return False
        # cut at this comma only if the sentence does not end in a few more words (no tiny leftover like "eks ole.")
        left = 0
        for j in range(i + 1, len(tokens)):
            if self._ends_sentence(tokens[j][0], tokens[j + 1][0] if j + 1 < len(tokens) else None):
                return left > MIN_TAIL_WORDS
            left += tokens[j][0][:1].isspace()
        return True  # no sentence end in sight


def transcribe(recognizer, samples: np.ndarray, rate: int, speaker: str = "A", capitalize: bool = False,
               break_s: float = 1.5, max_words: int = 18) -> list[dict]:
    """Stream `samples` through `recognizer`; return one event per sentence.

    `t`     = audio time (ms) of the last token of the sentence (when a live app would have its final text)
    `start` = audio time (ms) of its first token
    """
    builder = SentenceBuilder(speaker, capitalize, break_s, max_words)
    stream = recognizer.create_stream()
    chunk = max(1, int(rate * CHUNK_SECONDS))

    for pos in range(0, len(samples), chunk):
        part = samples[pos : pos + chunk]
        stream.accept_waveform(rate, part)
        _decode_ready(recognizer, stream)
        if recognizer.is_endpoint(stream):
            now = (pos + len(part)) / rate
            builder.add_chunk(_chunk_tokens(recognizer, stream, now))
            recognizer.reset(stream)

    # end of the file: flush whatever is still being recognised
    stream.accept_waveform(rate, np.zeros(int(TAIL_SECONDS * rate), dtype=np.float32))
    stream.input_finished()
    _decode_ready(recognizer, stream)
    builder.add_chunk(_chunk_tokens(recognizer, stream, len(samples) / rate))
    builder.flush()
    return builder.events


def build_replay(events: list[dict], audio_name: str, model_name: str) -> dict:
    return {"version": 1, "audio": audio_name, "model": model_name, "events": events}


def create_recognizer(args: argparse.Namespace):
    try:
        import sherpa_onnx
    except ImportError:
        sys.exit("sherpa-onnx puudub. Paigalda: pip install sherpa-onnx numpy")
    model_dir = Path(args.model_dir)
    paths = {key: model_dir / name for key, name in MODEL_FILES.items()}
    missing = [str(p) for p in paths.values() if not p.is_file()]
    if missing:
        sys.exit("Mudeli faile ei leitud:\n  " + "\n  ".join(missing) + "\n(vt skripti algusest allalaadimise käske)")
    return sherpa_onnx.OnlineRecognizer.from_transducer(
        tokens=str(paths["tokens"]),
        encoder=str(paths["encoder"]),
        decoder=str(paths["decoder"]),
        joiner=str(paths["joiner"]),
        num_threads=args.num_threads,
        sample_rate=16000,
        feature_dim=80,
        decoding_method=args.decoding_method,
        enable_endpoint_detection=True,  # off by default; the recogniser is reset at pauses, where no words are lost
        rule2_min_trailing_silence=args.pause,
        rule3_min_utterance_length=args.max_chunk,
    )


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="WAV -> Kõneväli replay JSON (Sherpa-ONNX ASR, one speaker).")
    p.add_argument("wav", type=Path, help="16/24/32-bit PCM WAV file")
    p.add_argument("--model-dir", required=True, help="folder with encoder.onnx, decoder.onnx, joiner.onnx, tokens.txt")
    p.add_argument("--out", type=Path, help="output JSON (default: public/replay/<wav name>.json)")
    p.add_argument("--speaker", default="A", help="speaker label used for every sentence (default: A)")
    p.add_argument("--decoding-method", default="modified_beam_search", choices=["greedy_search", "modified_beam_search"])
    p.add_argument("--break", dest="break_s", type=float, default=1.5, help="seconds of silence that end a sentence even without punctuation (default 1.5)")
    p.add_argument("--max-words", type=int, default=18, help="a sentence longer than this is cut at the next comma, so captions stay short enough for the field (default 18)")
    p.add_argument("--pause", type=float, default=1.2, help="seconds of silence at which the recogniser starts a new chunk; a chunk starts with a capital letter, so small values capitalise mid-sentence words (default 1.2)")
    p.add_argument("--max-chunk", type=float, default=600.0, help="longest recogniser chunk in seconds; forcing a cut loses words, so this is effectively off (default 600)")
    p.add_argument("--num-threads", type=int, default=2)
    p.add_argument("--capitalize", action="store_true", help="capitalise the first letter of every sentence")
    return p.parse_args(argv)


def main(argv=None) -> None:
    args = parse_args(argv)
    if not args.wav.is_file():
        sys.exit(f"Faili ei leitud: {args.wav}")
    out = args.out or Path("public/replay") / f"{args.wav.stem}.json"

    samples, rate = read_wav(args.wav)
    print(f"{args.wav.name}: {len(samples) / rate:.1f} s, {rate} Hz", file=sys.stderr)
    recognizer = create_recognizer(args)

    print("Tuvastan…", file=sys.stderr)
    events = transcribe(recognizer, samples, rate, speaker=args.speaker, capitalize=args.capitalize,
                        break_s=args.break_s, max_words=args.max_words)

    replay = build_replay(events, args.wav.name, Path(args.model_dir).name)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(replay, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(events)} lauset -> {out}", file=sys.stderr)
    if not events:
        print("Hoiatus: ühtegi lauset ei tuvastatud (liiga vaikne heli või vale mudel?).", file=sys.stderr)
    else:
        print(f"Ava: http://localhost:5173/vali?replay={out.stem}", file=sys.stderr)


if __name__ == "__main__":
    main()
