FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PORT=8787 \
    WORK_DIR=/tmp/xot-video-renderer \
    FONTS_DIR=/usr/share/fonts

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    fonts-vazirmatn \
    python3 \
    python3-numpy \
    python3-opencv \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY README.md ./

RUN mkdir -p /tmp/xot-video-renderer \
  && chown -R node:node /tmp/xot-video-renderer /app

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

CMD ["npm", "start"]
