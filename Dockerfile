# Flimify render backend — the studio-bridge on a server, so the web editor
# (flimify.com/studio) can generate / caption / auto-edit / export via Claude +
# Remotion + ffmpeg. Build context = the flimify-studio repo root.
#
# Serves TWO things on one port:
#   • the JSON API the web editor calls  (/health /generate /export /caption …)
#   • the full editor itself at  <host>/  (same-origin → fully functional)
FROM node:20-bookworm

# ffmpeg + the system libraries Remotion's headless Chrome needs to render frames.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates fonts-liberation \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libgbm1 libasound2 libpango-1.0-0 libcairo2 libatspi2.0-0 libxshmfence1 \
  && rm -rf /var/lib/apt/lists/*

# Claude Code CLI — authenticates headlessly via ANTHROPIC_API_KEY at runtime.
RUN npm install -g @anthropic-ai/claude-code

# ── render project: Remotion deps + the Captions component (the heavy install) ──
WORKDIR /render
COPY server/render-project/package.json server/render-project/package-lock.json ./
RUN npm ci || npm install
COPY server/render-project/ ./
# pre-download Remotion's headless browser so the first render isn't slow
RUN npx remotion browser ensure || true

# ── the app: the bridge + the web editor build it serves ──
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV FLIMIFY_RENDER_PROJECT=/render \
    FLIMIFY_DIST_DIR=/srv/dist \
    FLIMIFY_BIND_HOST=0.0.0.0 \
    NODE_ENV=production
# The platform injects $PORT (Render/Railway/Fly); the bridge reads it.
EXPOSE 3939
CMD ["node", "studio-bridge/server.cjs"]
