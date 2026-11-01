# Live ASR server for a hosted test (Railway). Build context: the repository root.
#   RAILWAY_DOCKERFILE_PATH=tools/live.Dockerfile
# The speech model (about 600 MB) is NOT in the image: put it on a volume and set MODEL_DIR to its folder.
# Needed variables: MODEL_DIR, WEB_ORIGIN (the web page's address, e.g. https://example.up.railway.app),
# KONEVALI_TOKEN (the access key). The server refuses to start on a public address without the key, and it
# never uses --verbose (it would write what people say to the logs). SPEAKER_MODEL (optional) is the speaker
# embedding model file on the same volume (nemo_en_titanet_small.onnx): only then can a session turn names on;
# voice prints are kept in the memory of one connection and nowhere else.
FROM python:3.12-slim
WORKDIR /app
COPY tools/requirements-live.txt ./tools/
RUN pip install --no-cache-dir -r tools/requirements-live.txt
COPY tools/live-server.py tools/make-replay.py tools/make-roster.py ./tools/
ENV PYTHONUNBUFFERED=1
CMD ["sh", "-c", "exec python tools/live-server.py --model-dir \"$MODEL_DIR\" --host 0.0.0.0 --port \"${PORT:-8765}\" --origin \"$WEB_ORIGIN\" --max-connections \"${MAX_CONNECTIONS:-2}\" --num-threads \"${NUM_THREADS:-2}\" ${SPEAKER_MODEL:+--speaker-model \"$SPEAKER_MODEL\"}"]
