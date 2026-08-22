# XOT Video Renderer

Node 20 service for the production Persian video render gate. Supabase stays the
control plane; this service claims `video_renders`, downloads source media from
`temp-media`, transcribes audio with Deepgram, translates timed cues, burns the
subtitles plus the `X @Masihh` watermark with one ffmpeg encode pass,
uploads the processed MP4, and calls the completion RPC.

Required Ubuntu packages:

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg fontconfig fonts-noto-core python3 python3-opencv python3-numpy tesseract-ocr tesseract-ocr-eng tesseract-ocr-fas tesseract-ocr-ara tesseract-ocr-heb
```

Docker installs Vazirmatn from the pinned npm package and copies the TTF files
into the image font directory. Native installs should either install Vazirmatn
manually or use Docker Compose.

Required environment:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=...
DEEPGRAM_API_KEY=...
VIDEO_RENDERER_TOKEN=...
PORT=8787
RENDER_CONCURRENCY=1
RENDER_SHUTDOWN_GRACE_MS=30000
TRANSCRIPTION_PROVIDER=deepgram
DEEPGRAM_MODEL=nova-3
DEEPGRAM_LANGUAGE_FALLBACKS=multi,en,fa,he,ar
ENHANCED_AUDIO_RETRY=1
SUBTITLE_TRANSCRIBE_MODEL=gpt-4o-transcribe-diarize
SUBTITLE_TRANSLATE_MODEL=gpt-5.4-mini
WATERMARK_VISION_MODEL=gpt-5.4-mini
VISION_SPECIALIST_MODE=always
TESSERACT_LANG=eng+fas+ara+heb
MAX_DELOGO_REGIONS=2
MAX_SINGLE_DELOGO_AREA_RATIO=0.10
MAX_TOTAL_DELOGO_AREA_RATIO=0.15
FFMPEG_THREADS=3
OUTPUT_PRESET=veryfast
OUTPUT_CRF=23
MAX_OUTPUT_BYTES=49000000
OUTPUT_SIZE_RETRY_CRF_STEP=4
MAX_OUTPUT_RETRY_CRF=30
DELOGO_ENGINE=opencv
OPENCV_INPAINT_ALGORITHM=telea
OPENCV_INPAINT_RADIUS=2
OPENCV_INPAINT_KERNEL=7
OPENCV_INPAINT_DILATE_ITERATIONS=2
OPENCV_INPAINT_CLOSE_ITERATIONS=1
OPENCV_INPAINT_FEATHER=0
```

`VIDEO_RENDERER_TOKEN` is required for HTTP dispatch routes such as
`POST /v1/render` and `POST /v1/preflight`. When it is missing or blank, those
routes return `401` and Edge callers should leave the row for poller-only
processing instead of making an unauthenticated request.

Authenticated dispatch accepts only JSON with `render_id` and the existing
optional `tweet_id` and `source` fields. The service rejects unsupported
content encodings/types, invalid UTF-8, unsupported JSON shape, declared or
streamed bodies above 64 KiB, and bodies fragmented into more than 256 chunks
before capacity acquisition or a database claim. Input errors use stable
`400`, `413`, or `415` JSON responses and never echo the supplied body.
Those fixed source limits must be checked against observed production request
sizes before any change; they are not a substitute for proxy/slow-client
runtime validation.

`RENDER_CONCURRENCY` is one shared, non-queuing capacity limit for HTTP render,
HTTP preflight, and polling. It defaults to `1` and rejects a saturated HTTP
request before it claims a render, with `429` and `Retry-After`. Values outside
the conservative source range `1` to `4` fail at startup. On `SIGTERM` or
`SIGINT`, the service stops new claims, clears poll/heartbeat timers, closes the
listener, and waits up to `RENDER_SHUTDOWN_GRACE_MS` (default `30000`) for active
work to drain. A grace timeout is reported as an incomplete drain; it is not a
claim that a child process was safely aborted.

Production `src` ffmpeg, ffprobe, OpenCV, and Tesseract commands use one managed
runner: fixed source deadlines of 60 seconds for probes, 180 seconds for analysis,
120 seconds for OCR, and 30 minutes for rendering; 10 seconds of `SIGTERM` grace;
then `SIGKILL` plus a five-second forced-settle bound. Captured text stdout is
limited to 256 KiB, stderr retains only its final 64 KiB, and binary stdout is
limited to 32 MiB. Raw stderr is never added to a managed error message; only a
bounded byte-count diagnostic is retained. Shutdown asks registered command groups to stop before it
observes capacity drain and latches the runner so a later stage rejects before
spawning. Callers may also pass an `AbortSignal` to the runner. These are
source-level containment limits, not evidence
that a particular host killed every descendant or has adequate CPU, memory, PID,
or temporary-storage limits; tune them only after measured host/runtime evidence.

The transcription path is Deepgram-first. The renderer extracts normal mono
16 kHz audio and sends that to Deepgram. Only when Deepgram returns no timed
segments or weak rejected speech does `ENHANCED_AUDIO_RETRY=1` create a second,
speech-focused audio file and retry Deepgram. Do not enhance every video by
default; enhancement is a rescue path because it can degrade already-clear
speech and adds a second STT call only when needed. Set `ENHANCED_AUDIO_RETRY=0`
only for debugging or strict latency experiments.

OpenAI vision preflight is enabled by default. Each video sends up to three
individual source frames to `WATERMARK_VISION_MODEL` so coordinate output stays
anchored to the real frame. The contact sheet is still generated for local OCR
and is included only in the watermark specialist request to help catch small
persistent source marks. Set `INCLUDE_CONTACT_SHEET_IN_VISION=1` only if a future
case needs extra persistence context in the general request. The model returns
structured sections for watermarks, existing burned-in subtitles, news
tickers/teletext/lower-thirds, subtitle placement, and a render decision.
Contextual labels like `UNCLASSIFIED`, `CENTCOM`, broadcaster logos, map labels,
chyrons, and tickers are preserved, while source/reposter handles can be
converted into ffmpeg `delogo` regions.

`VISION_SPECIALIST_MODE=always` runs the general, watermark, subtitle, and
placement checks together so wall-clock time is close to the slowest vision
request rather than the sum. Use `auto` to run specialist checks only for messy
or uncertain videos, or `off` for one-call-only preflight. Delogo is
intentionally capped by region count and total area; videos that exceed the
limits are blocked rather than patched badly. Set `ENABLE_OPENAI_VISION_PREFLIGHT=0`
only for emergency cost/latency fallback.

The adaptive bottom subtitle mask is off by default because delogo is preferred.
Set `ENABLE_ADAPTIVE_SUBTITLE_MASK=1` only when hard-burned subtitle replacement
needs an additional darkening pass.

When delogo regions are present, `DELOGO_ENGINE=opencv` runs a selective OpenCV
inpaint pipe first and then passes cleaned raw frames into ffmpeg for the final
watermark/subtitle encode. This costs more CPU than ffmpeg `delogo`, but avoids
the obvious rectangular/vertical smear on semi-transparent creator marks.
Set `DELOGO_ENGINE=ffmpeg` for emergency fallback if Python/OpenCV is unavailable.

Run locally:

```bash
npm --prefix services/video-renderer test
npm --prefix services/video-renderer start
```

The root `npm run check:renderer-process-runner` command is a no-process source
contract using fake child streams. It does not run ffmpeg, OCR, or the renderer.

Run on the Ubuntu renderer with Docker Compose from the repo checkout:

```bash
cd /opt/xot-renderer/services/video-renderer
sudo cp .env.example /opt/xot-renderer/.env.video-renderer
sudo chmod 600 /opt/xot-renderer/.env.video-renderer
sudoedit /opt/xot-renderer/.env.video-renderer
docker compose up -d --build
curl http://127.0.0.1:8797/health
```

The compose file binds the service only to host port `127.0.0.1:8797`, while
the container listens internally on `8787`. The non-default host port avoids
colliding with the Hermes WebUI on shared Hermes/XOT servers. Secrets are read
from `/opt/xot-renderer/.env.video-renderer`. Do not commit or copy that env
file back into the repository.

Run a no-upload local preview:

```bash
npm --prefix services/video-renderer run preview -- /path/to/source.mp4 /tmp/xot-video-preview
```

This writes `preflight.json` and `contact-sheet.jpg`. If `OPENAI_API_KEY` is
set and the video is not blocked by preflight, it also writes a short
`preview.mp4`. The `X @Masihh` watermark is burned only when a subtitle track is
added unless `PREVIEW_WATERMARK_APPLY_WHEN` is explicitly changed.

Run the local golden acceptance workflow:

```bash
npm --prefix services/video-renderer run golden:select -- --count 50
npm --prefix services/video-renderer run golden:run -- --batch 1
npm --prefix services/video-renderer run golden:summarize -- --batch 1
```

The golden workflow is read-only against Supabase. It stores originals,
preflight JSON, subtitles, contact sheets, run logs, and rendered previews under
`/Users/stevmq/Downloads/xot-video-golden/<run-id>/`. It does not upload
processed files, enqueue posts, or touch Telegram/X delivery state.
