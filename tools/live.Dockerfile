# Live ASR server for a hosted test (Railway). Build context: the repository root.
#   RAILWAY_DOCKERFILE_PATH=tools/live.Dockerfile
#
# The speech models (~640 MB) are downloaded while the image is built, by tools/fetch-models.py, pinned by Hugging Face
# commit, size and SHA-256 (a wrong file stops the build). Needed variables when the service runs:
#   WEB_ORIGIN       the web page's address, e.g. https://example.up.railway.app (no slash at the end)
#   KONEVALI_TOKEN   the access key (the server refuses to start on a public address without it)
# Optional: MAX_CONNECTIONS (2), NUM_THREADS (2); SPEAKER_MODEL="" turns names off (no voice comparison at all).
# The server never runs with --verbose (it would write what people say to the logs). Voice prints live only in the
# memory of one connection.
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1

# 1. Python packages (wheels only: no compiler). The import checks that the shared libraries sherpa-onnx needs are there.
COPY tools/requirements-live.txt ./tools/
RUN pip install --no-cache-dir -r tools/requirements-live.txt \
 && python -c "import numpy, sherpa_onnx, websockets; print('sherpa-onnx', sherpa_onnx.__version__, 'numpy', numpy.__version__, 'websockets', websockets.__version__)"

# 2. The models: a big layer that stays cached while the code changes.
COPY tools/fetch-models.py ./tools/
RUN python tools/fetch-models.py --out /models
ENV MODEL_DIR=/models/streaming-zipformer-large.et-en.w2n \
    SPEAKER_MODEL=/models/nemo_en_titanet_small.onnx

# 3. The server.
COPY tools/live-server.py tools/make-replay.py tools/make-roster.py ./tools/
CMD ["sh", "-c", "exec python tools/live-server.py --model-dir \"$MODEL_DIR\" --host 0.0.0.0 --port \"${PORT:-8765}\" --origin \"${WEB_ORIGIN:?WEB_ORIGIN puudub}\" --max-connections \"${MAX_CONNECTIONS:-2}\" --num-threads \"${NUM_THREADS:-2}\" ${SPEAKER_MODEL:+--speaker-model \"$SPEAKER_MODEL\"}"]
