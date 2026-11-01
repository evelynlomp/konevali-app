#!/usr/bin/env python3
"""Turn a WAV recording into a Kõneväli replay file, using Sherpa-ONNX streaming ASR.

    WAV  ->  Sherpa ASR (tokens with times)  ->  sentences  ->  [speaker labels]  ->  replay JSON  ->  /vali?replay=<name>

Without --speaker-model every sentence gets the same speaker ("A"). With it, each sentence gets a voice
embedding (Sherpa speaker embedding model) and is given the label of the earlier speaker it matches, or a new
label A, B, C, ... in order of first appearance: the anonymous speakers exist before anyone has a name.

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

Missing speech (optional, both off by default). A quiet phone recording or the recogniser's pause resets can leave
much of the speech untranscribed. On a 6-person quiz recording (5 min) these gave 38% -> 69% of the active audio
covered, 343 -> 557 words:

    python tools/make-replay.py meeting.wav --model-dir <asr model> --gain --decoding-method greedy_search --window 8

--gain scales the audio for the ASR only. --window 8 turns the recogniser's pause resets off and starts a fresh
stream at the first pause (0.3 s) after 8 s, decoding what was heard first; it uses past audio only. The text is
not checked against a transcript: listen to the result.

Speaker labels (optional), the smallest possible version:

    # a speaker embedding model, kept outside the repository (26 MB):
    mkdir sherpa-models/speaker
    curl -L -o sherpa-models/speaker/wespeaker_en_voxceleb_resnet34.onnx https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34.onnx

    python tools/make-replay.py meeting.wav --model-dir <asr model> --speaker-model sherpa-models/speaker/wespeaker_en_voxceleb_resnet34.onnx

Any Sherpa speaker model works. On three own recordings (3, 4 and 6 speakers) 3D-Speaker campplus zh_en
(3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx) separated people best and WeSpeaker worst; NeMo
nemo_en_titanet_small.onnx was close to 3D-Speaker. Score scales differ per model, so the threshold differs too: the
default 0.6 is only a starting point; thresholds that worked on the first two recordings were about 0.43-0.55 for
3D-Speaker and 0.30-0.6 for NeMo (with --min-speaker-seconds 2.5). The 6-person recording had no threshold that
labelled everyone correctly online.
A table of sentences, labels and scores is printed. The threshold is not calibrated: if one person gets two labels,
lower --speaker-threshold, if two people share one, raise it. To try thresholds without running the ASR again, feed
the sentences of an earlier replay file:  --events-from public/replay/meeting.json  (the WAV is still needed, for the audio).
Not done yet: no speaker change detection (two voices in one sentence get one label), no names.

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
GAIN_TARGET_DB = -20.0  # --gain: level of the loud frames after scaling
WINDOW_QUIET_S = 0.3  # --window: a new stream starts only in a pause at least this long
WINDOW_QUIET_DB = 10.0  # ... "quiet" = less than this many dB above the recording's 10th-percentile level

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

    def flush_if_idle(self, now_s: float) -> None:
        """Live use: end the sentence being built when nothing has been said for `break_s` (offline, the next chunk tells)."""
        if self._pending and now_s - self._pending[-1][1] >= self.break_s:
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


def frame_db(samples: np.ndarray, rate: int, seconds: float) -> np.ndarray:
    """Level in dB of every `seconds`-long frame."""
    hop = max(1, int(rate * seconds))
    frames = samples[: len(samples) // hop * hop].reshape(-1, hop)
    return 10 * np.log10(np.mean(frames ** 2, axis=1) + 1e-12)


def normalise_level(samples: np.ndarray, rate: int, target_db: float = GAIN_TARGET_DB) -> tuple[np.ndarray, float]:
    """Scale quiet audio up so its loud frames sit at `target_db`; the model drops speech it hears too quietly.

    Returns the new samples (clipped to +-1) and the gain used in dB.
    """
    levels = frame_db(samples, rate, 0.05)
    if len(levels) == 0:
        return samples, 0.0
    gain = target_db - float(np.percentile(levels, 90))
    return np.clip(samples * 10 ** (gain / 20), -1, 1).astype(np.float32), gain


def _finish_stream(recognizer, stream, rate: int, offset_s: float, end_s: float) -> list[Token]:
    """Let the recogniser decode everything it has heard so far (it holds back the last moments) and return the tokens.

    A fresh stream counts time from 0, so `offset_s` (where the stream started) is added to the token times.
    """
    stream.accept_waveform(rate, np.zeros(int(TAIL_SECONDS * rate), dtype=np.float32))
    stream.input_finished()
    _decode_ready(recognizer, stream)
    return [(text, when + offset_s) for text, when in _chunk_tokens(recognizer, stream, end_s - offset_s)]


def transcribe(recognizer, samples: np.ndarray, rate: int, speaker: str = "A", capitalize: bool = False,
               break_s: float = 1.5, max_words: int = 18, window_s: float = 0.0) -> list[dict]:
    """Stream `samples` through `recognizer`; return one event per sentence.

    `t`     = audio time (ms) of the last token of the sentence (when a live app would have its final text)
    `start` = audio time (ms) of its first token

    With `window_s` > 0 the recogniser's own endpoint resets should be off (they drop the last words before a
    reset). Instead, once `window_s` seconds have passed and the last WINDOW_QUIET_S were quiet, everything heard is
    decoded and a fresh stream starts. Only past audio is used, so it works live too.
    """
    builder = SentenceBuilder(speaker, capitalize, break_s, max_words)
    stream = recognizer.create_stream()
    chunk = max(1, int(rate * CHUNK_SECONDS))
    levels = frame_db(samples, rate, CHUNK_SECONDS) if window_s > 0 else None
    quiet_below = float(np.percentile(levels, 10)) + WINDOW_QUIET_DB if levels is not None and len(levels) else 0.0
    window_start, quiet_chunks = 0.0, 0

    for pos in range(0, len(samples), chunk):
        part = samples[pos : pos + chunk]
        stream.accept_waveform(rate, part)
        _decode_ready(recognizer, stream)
        now = (pos + len(part)) / rate
        if levels is not None:
            quiet_chunks = quiet_chunks + 1 if pos // chunk < len(levels) and levels[pos // chunk] < quiet_below else 0
            if now - window_start >= window_s and quiet_chunks >= WINDOW_QUIET_S / CHUNK_SECONDS:
                builder.add_chunk(_finish_stream(recognizer, stream, rate, window_start, now))
                stream, window_start, quiet_chunks = recognizer.create_stream(), now, 0
        elif recognizer.is_endpoint(stream):
            builder.add_chunk(_chunk_tokens(recognizer, stream, now))
            recognizer.reset(stream)

    # end of the file: flush whatever is still being recognised
    builder.add_chunk(_finish_stream(recognizer, stream, rate, window_start, len(samples) / rate))
    builder.flush()
    return builder.events


def speaker_label(index: int) -> str:
    """0 -> A, 1 -> B, ... 25 -> Z, 26 -> AA."""
    label, n = "", index + 1
    while n:
        n, remainder = divmod(n - 1, 26)
        label = chr(65 + remainder) + label
    return label


def assign_speakers(events: list[dict], samples: np.ndarray, rate: int, embed, manager,
                    threshold: float = 0.6, min_seconds: float = 1.5) -> list[dict]:
    """Give every sentence an anonymous speaker label by comparing voice embeddings; changes `events` in place.

    `embed(segment, rate)` -> a vector, or None when there is too little audio.
    `manager` has Sherpa's SpeakerEmbeddingManager methods add / remove / search / score.

    A sentence whose voice matches an earlier speaker (cosine score >= threshold) gets that speaker's label and
    moves the speaker's average; otherwise it starts a new speaker. Sentences shorter than `min_seconds` are too
    short for a reliable voice: they keep the previous label and never start a speaker.
    Added to each event: `score` = best similarity to the speakers heard so far, `new` = it started a speaker,
    `short` = it only inherited the previous label.
    """
    vectors: dict[str, list[list[float]]] = {}
    previous = None
    for event in events:
        for key in ("score", "new", "short"):
            event.pop(key, None)
        begin, end = round(event["start"] * rate / 1000), round(event["t"] * rate / 1000)
        segment = samples[begin:end]
        vector = embed(segment, rate) if len(segment) >= min_seconds * rate else None
        if vector is None:
            event["speaker"] = previous or speaker_label(0)
            event["short"] = True
            continue
        best = max(manager.score(name, vector) for name in vectors) if vectors else None
        name = manager.search(vector, threshold) if vectors else ""
        if name:
            vectors[name].append(vector)
            manager.remove(name)  # add() does not replace an existing name
            manager.add(name, np.mean(vectors[name], axis=0).tolist())
        else:
            name = speaker_label(len(vectors))
            manager.add(name, vector)
            vectors[name] = [vector]
            event["new"] = True
        event["speaker"] = name
        if best is not None:
            event["score"] = round(float(best), 3)
        previous = name
    return events


UNKNOWN = "Tundmatu"
ROSTER_MIN_SECONDS = 0.8  # a known voice is recognised from less audio than a new speaker is started from


def load_roster(path: Path) -> dict:
    """A roster made by tools/make-roster.py: {"model", "threshold", "people": {name: unit vector}}."""
    data = json.loads(path.read_text(encoding="utf-8"))
    people = {p["name"]: np.array(p["vector"], dtype=np.float32) for p in data.get("people", []) if p.get("vector")}
    if not people:
        sys.exit(f"{path}: selles failis pole ühtegi inimest")
    return {"model": data.get("model", ""), "threshold": float(data.get("threshold", 0.0)), "people": people}


def assign_roster(events: list[dict], samples: np.ndarray, rate: int, embed, people: dict, threshold: float,
                  min_seconds: float = ROSTER_MIN_SECONDS) -> list[dict]:
    """Name every sentence after the enrolled person whose voice it is closest to; changes `events` in place.

    A sentence whose best cosine similarity is below `threshold` is not anyone on the roster: it gets UNKNOWN.
    Sentences shorter than `min_seconds` keep the previous label. Added to each event: `score` = best similarity,
    `margin` = lead over the second best person, `short` = it only inherited the previous label.
    """
    previous = None
    for event in events:
        for key in ("score", "margin", "short", "new"):
            event.pop(key, None)
        begin, end = round(event["start"] * rate / 1000), round(event["t"] * rate / 1000)
        segment = samples[begin:end]
        vector = embed(segment, rate) if len(segment) >= min_seconds * rate else None
        if vector is None:
            event["speaker"] = previous or UNKNOWN
            event["short"] = True
            continue
        v = np.array(vector, dtype=np.float32)
        v /= np.linalg.norm(v)
        ranked = sorted(((float(v @ c), name) for name, c in people.items()), reverse=True)
        score, name = ranked[0]
        event["speaker"] = name if score >= threshold else UNKNOWN
        event["score"] = round(score, 3)
        if len(ranked) > 1:
            event["margin"] = round(score - ranked[1][0], 3)
        previous = event["speaker"]
    return events


def make_embedder(extractor):
    """Wrap a Sherpa SpeakerEmbeddingExtractor as embed(segment, rate)."""
    def embed(segment: np.ndarray, rate: int):
        stream = extractor.create_stream()
        stream.accept_waveform(rate, segment)
        stream.input_finished()
        return list(extractor.compute(stream)) if extractor.is_ready(stream) else None
    return embed


def speaker_table(events: list[dict]) -> str:
    """One line per sentence: number, label, score, flag, time, start of the text."""
    lines = []
    for i, e in enumerate(events, 1):
        flag = "new" if e.get("new") else "short" if e.get("short") else ""
        score = f"{e['score']:.2f}" if "score" in e else "  - "
        lines.append(f"{i:>3}  {e['speaker']:<3} {score}  {flag:<5} {e['start'] / 1000:6.1f}-{e['t'] / 1000:6.1f}s  {e['text'][:60]}")
    return "\n".join(lines)


def speaker_summary(events: list[dict]) -> str:
    totals: dict[str, list] = {}
    for e in events:
        count, seconds = totals.setdefault(e["speaker"], [0, 0.0])
        totals[e["speaker"]] = [count + 1, seconds + (e["t"] - e["start"]) / 1000]
    return ", ".join(f"{name}: {count} lauset ({seconds:.0f} s)" for name, (count, seconds) in sorted(totals.items()))


def load_events(path: Path) -> tuple[list[dict], str]:
    """The sentences (and ASR model name) of an earlier replay file, to label speakers without running the ASR again."""
    data = json.loads(path.read_text(encoding="utf-8"))
    events = [e for e in data.get("events", []) if all(k in e for k in ("t", "start", "text"))]
    if not events:
        sys.exit(f"{path}: selles failis pole lauseid (vaja on t, start, text)")
    return events, str(data.get("model", ""))


def create_speaker_embedder(args: argparse.Namespace):
    try:
        import sherpa_onnx
    except ImportError:
        sys.exit("sherpa-onnx puudub. Paigalda: pip install sherpa-onnx numpy")
    model = Path(args.speaker_model)
    if not model.is_file():
        sys.exit(f"Kõneleja mudelit ei leitud: {model}\n(vt skripti algusest allalaadimise käsku)")
    config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(model), num_threads=args.num_threads, debug=False, provider="cpu")
    if not config.validate():
        sys.exit(f"Kõneleja mudel ei kõlba: {model}")
    extractor = sherpa_onnx.SpeakerEmbeddingExtractor(config)
    return make_embedder(extractor), sherpa_onnx.SpeakerEmbeddingManager(extractor.dim)


def build_replay(events: list[dict], audio_name: str, model_name: str, speakers: dict | None = None,
                 names: dict | None = None) -> dict:
    replay = {"version": 1, "audio": audio_name, "model": model_name}
    if speakers:
        replay["speakers"] = speakers  # how the labels were made; Kõneväli ignores it
    if names:
        replay["names"] = names  # label -> name shown on the field (a roster's labels are already names)
    replay["events"] = events
    return replay


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
        enable_endpoint_detection=args.window == 0,  # off by default in Sherpa; reset at pauses. --window cuts streams itself
        rule2_min_trailing_silence=args.pause,
        rule3_min_utterance_length=args.max_chunk,
    )


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="WAV -> Kõneväli replay JSON (Sherpa-ONNX ASR, one speaker).")
    p.add_argument("wav", type=Path, help="16/24/32-bit PCM WAV file")
    p.add_argument("--model-dir", help="folder with encoder.onnx, decoder.onnx, joiner.onnx, tokens.txt (not needed with --events-from)")
    p.add_argument("--out", type=Path, help="output JSON (default: public/replay/<wav name>.json)")
    p.add_argument("--speaker", default="A", help="speaker label used for every sentence (default: A)")
    p.add_argument("--decoding-method", default="modified_beam_search", choices=["greedy_search", "modified_beam_search"])
    p.add_argument("--break", dest="break_s", type=float, default=1.5, help="seconds of silence that end a sentence even without punctuation (default 1.5)")
    p.add_argument("--max-words", type=int, default=18, help="a sentence longer than this is cut at the next comma, so captions stay short enough for the field (default 18)")
    p.add_argument("--pause", type=float, default=1.2, help="seconds of silence at which the recogniser starts a new chunk; a chunk starts with a capital letter, so small values capitalise mid-sentence words (default 1.2)")
    p.add_argument("--max-chunk", type=float, default=600.0, help="longest recogniser chunk in seconds; forcing a cut loses words, so this is effectively off (default 600)")
    p.add_argument("--gain", action="store_true", help="scale the audio for the ASR so the loud parts sit at -20 dB; helps quiet phone recordings (speaker labels still use the original audio)")
    p.add_argument("--window", type=float, default=0.0, help="seconds: instead of the recogniser's pause resets, start a fresh stream at the first pause after this many seconds (suggested 8; 0 = off, the default)")
    p.add_argument("--speaker-model", help="speaker embedding model (.onnx); without it every sentence gets --speaker")
    p.add_argument("--speaker-threshold", type=float, default=0.6, help="cosine score from which a voice counts as an earlier speaker (default 0.6, not calibrated)")
    p.add_argument("--min-speaker-seconds", type=float, default=1.5, help="sentences shorter than this keep the previous label (default 1.5)")
    p.add_argument("--roster", type=Path, help="people made by tools/make-roster.py (needs the same --speaker-model): sentences get the name of the closest enrolled voice, or 'Tundmatu'")
    p.add_argument("--roster-threshold", type=float, help="cosine similarity below which a voice is nobody on the roster (default: the value stored in the roster file)")
    p.add_argument("--events-from", type=Path, help="take the sentences from an earlier replay JSON instead of running the ASR")
    p.add_argument("--num-threads", type=int, default=2)
    p.add_argument("--capitalize", action="store_true", help="capitalise the first letter of every sentence")
    return p.parse_args(argv)


def main(argv=None) -> None:
    args = parse_args(argv)
    if not args.wav.is_file():
        sys.exit(f"Faili ei leitud: {args.wav}")
    out = args.out or Path("public/replay") / f"{args.wav.stem}.json"

    if not args.events_from and not args.model_dir:
        sys.exit("Vaja on kas --model-dir (ASR mudel) või --events-from (varasem replay JSON).")
    samples, rate = read_wav(args.wav)
    print(f"{args.wav.name}: {len(samples) / rate:.1f} s, {rate} Hz", file=sys.stderr)

    if args.events_from:
        events, asr_model = load_events(args.events_from)
        print(f"{len(events)} lauset failist {args.events_from}", file=sys.stderr)
    else:
        recognizer = create_recognizer(args)
        heard = samples
        if args.gain:
            heard, gain = normalise_level(samples, rate)
            print(f"Võimendus {gain:+.0f} dB", file=sys.stderr)
        print("Tuvastan…", file=sys.stderr)
        events = transcribe(recognizer, heard, rate, speaker=args.speaker, capitalize=args.capitalize,
                            break_s=args.break_s, max_words=args.max_words, window_s=args.window)
        asr_model = Path(args.model_dir).name

    speakers = names = None
    if args.roster and not args.speaker_model:
        sys.exit("--roster vajab ka --speaker-model (sama mudel, millega nimekiri tehti).")
    if args.speaker_model:
        embed, manager = create_speaker_embedder(args)
        print("Märgendan kõnelejad…", file=sys.stderr)
        if args.roster:
            roster = load_roster(args.roster)
            if roster["model"] != Path(args.speaker_model).name:
                sys.exit(f"Nimekiri on tehtud mudeliga {roster['model']}, aga --speaker-model on {Path(args.speaker_model).name}: hääled ei ole võrreldavad.")
            threshold = args.roster_threshold if args.roster_threshold is not None else roster["threshold"]
            assign_roster(events, samples, rate, embed, roster["people"], threshold)
            names = {name: name for name in [*roster["people"], UNKNOWN]}
            speakers = {"model": roster["model"], "roster": sorted(roster["people"]), "threshold": threshold}
        else:
            assign_speakers(events, samples, rate, embed, manager, args.speaker_threshold, args.min_speaker_seconds)
            speakers = {"model": Path(args.speaker_model).name, "threshold": args.speaker_threshold, "min_seconds": args.min_speaker_seconds}
        print(speaker_table(events), file=sys.stderr)
        print(speaker_summary(events), file=sys.stderr)

    replay = build_replay(events, args.wav.name, asr_model, speakers, names)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(replay, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(events)} lauset -> {out}", file=sys.stderr)
    if not events:
        print("Hoiatus: ühtegi lauset ei tuvastatud (liiga vaikne heli või vale mudel?).", file=sys.stderr)
    else:
        print(f"Ava: http://localhost:5173/vali?replay={out.stem}", file=sys.stderr)


if __name__ == "__main__":
    main()
