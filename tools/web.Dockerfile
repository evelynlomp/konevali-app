# The Kõneväli web page for a hosted test (Railway). Build context: the repository root.
#   RAILWAY_DOCKERFILE_PATH=tools/web.Dockerfile
#
# Build variables (Railway passes service variables to the build only for the ARGs declared here):
#   VITE_LIVE_URL    the live server's address, wss://... (otherwise the page falls back to ws://localhost:8765)
#   VITE_CONTACT     who answers questions about the data (shown on the privacy page)
#   VITE_HOSTING     where the server runs, in one honest sentence (shown on the privacy page)
# Do not put the access key in any VITE_ variable: they end up in the public JavaScript.
#
# Dependencies come from bun.lock (--frozen-lockfile: exactly the locked versions); the build itself runs on Node,
# the way it was checked. The result (.output) is self-contained, so the final image is Node and that folder only.
FROM node:24-slim AS build
WORKDIR /app
RUN npm install -g bun@1
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile
COPY . .
ARG VITE_LIVE_URL
ARG VITE_CONTACT
ARG VITE_HOSTING
ENV NITRO_PRESET=node-server \
    VITE_LIVE_URL=$VITE_LIVE_URL \
    VITE_CONTACT=$VITE_CONTACT \
    VITE_HOSTING=$VITE_HOSTING
RUN node node_modules/vite/bin/vite.js build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0
COPY --from=build /app/.output ./.output
CMD ["node", ".output/server/index.mjs"]
