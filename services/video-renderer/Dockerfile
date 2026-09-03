FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0

ENV NODE_ENV=production \
    PORT=8787 \
    WORK_DIR=/tmp/xot-video-renderer \
    FONTS_DIR=/usr/share/fonts

RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    fontconfig \
    fonts-noto-core \
    python3 \
    python3-numpy \
    python3-opencv \
    tesseract-ocr \
    tesseract-ocr-ara \
    tesseract-ocr-eng \
    tesseract-ocr-fas \
    tesseract-ocr-heb \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

RUN mkdir -p /usr/local/share/fonts/vazirmatn \
  && cp node_modules/vazirmatn/fonts/ttf/*.ttf /usr/local/share/fonts/vazirmatn/ \
  && fc-cache -f

COPY src ./src
COPY scripts ./scripts
COPY README.md ./

# npm is needed only while dependencies are installed. Keep the runtime image
# to the renderer process and its production dependencies.
RUN rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx

RUN mkdir -p /tmp/xot-video-renderer \
  && chown -R node:node /tmp/xot-video-renderer /app

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

CMD ["node", "src/index.js"]
