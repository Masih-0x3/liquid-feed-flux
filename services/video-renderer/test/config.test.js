import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RENDER_VERSION,
  DEFAULT_TESSERACT_LANG,
  loadConfigFromEnv,
  loadServerRuntimeFromEnv,
  parseRenderQueueCutoffAt,
} from "../src/config.js";

const REQUIRED_ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  OPENAI_API_KEY: "openai-key",
  DEEPGRAM_API_KEY: "deepgram-key",
  RENDERER_ID: "renderer-test",
};

test("loads renderer config from explicit environment values", () => {
  const config = loadConfigFromEnv({
    ...REQUIRED_ENV,
    WORK_DIR: "/tmp/work",
    RENDER_VERSION: "render-v2",
    TRANSCRIPTION_PROVIDER: "deepgram",
    DEEPGRAM_LANGUAGE_FALLBACKS: "multi,en,fa",
    WATERMARK_VISION_TOP_P: "0.25",
    TESSERACT_LANG: "eng+fas",
    KEEP_PREFLIGHT_WORKDIR: "1",
  });

  assert.equal(config.supabaseUrl, REQUIRED_ENV.SUPABASE_URL);
  assert.equal(config.rendererId, "renderer-test");
  assert.equal(config.workDir, "/tmp/work");
  assert.equal(config.renderVersion, "render-v2");
  assert.deepEqual(config.deepgramLanguageFallbacks, ["multi", "en", "fa"]);
  assert.equal(config.watermarkVisionTopP, 0.25);
  assert.equal(config.tesseractLang, "eng+fas");
  assert.equal(config.keepPreflightWorkdir, true);
});

test("uses delivery-safe renderer defaults", () => {
  const config = loadConfigFromEnv(REQUIRED_ENV);

  assert.equal(config.renderVersion, DEFAULT_RENDER_VERSION);
  assert.equal(config.transcriptionProvider, "deepgram");
  assert.equal(config.enhancedAudioRetry, true);
  assert.deepEqual(config.deepgramLanguageFallbacks, ["multi", "en", "fa", "he", "ar"]);
  assert.equal(config.enableVisionPreflight, true);
  assert.equal(config.delogoEngine, "opencv");
  assert.equal(config.tesseractLang, DEFAULT_TESSERACT_LANG);
  assert.equal(config.keepPreflightWorkdir, false);
  assert.match(config.opencvScript, /scripts\/opencv_inpaint_pipe\.py$/);
});

test("requires core production secrets", () => {
  assert.throws(() => loadConfigFromEnv({ ...REQUIRED_ENV, SUPABASE_URL: "" }), /SUPABASE_URL is required/);
  assert.throws(() => loadConfigFromEnv({ ...REQUIRED_ENV, SUPABASE_SERVICE_ROLE_KEY: "" }), /SUPABASE_SERVICE_ROLE_KEY is required/);
  assert.throws(() => loadConfigFromEnv({ ...REQUIRED_ENV, OPENAI_API_KEY: "" }), /OPENAI_API_KEY is required/);
});

test("requires Deepgram key only for Deepgram transcription", () => {
  assert.throws(() => loadConfigFromEnv({
    ...REQUIRED_ENV,
    DEEPGRAM_API_KEY: "",
    TRANSCRIPTION_PROVIDER: "deepgram",
  }), /DEEPGRAM_API_KEY is required/);

  const config = loadConfigFromEnv({
    ...REQUIRED_ENV,
    DEEPGRAM_API_KEY: "",
    TRANSCRIPTION_PROVIDER: "openai",
  });
  assert.equal(config.transcriptionProvider, "openai");
});

test("loads server runtime separately from render config", () => {
  const runtime = loadServerRuntimeFromEnv({
    VIDEO_RENDERER_TOKEN: "  dispatch-token  ",
    PORT: "9000",
    RENDER_CONCURRENCY: "2",
    RENDER_SHUTDOWN_GRACE_MS: "45000",
    POLL_INTERVAL_MS: "10",
    HEARTBEAT_INTERVAL_MS: "20",
    npm_package_version: "0.2.0",
  });

  assert.equal(runtime.token, "dispatch-token");
  assert.equal(runtime.port, 9000);
  assert.equal(runtime.pollIntervalMs, 1000);
  assert.equal(runtime.heartbeatIntervalMs, 5000);
  assert.equal(runtime.renderConcurrency, 2);
  assert.equal(runtime.shutdownGraceMs, 45000);
  assert.equal(runtime.renderPollingEnabled, false);
  assert.equal(runtime.renderPollingEffective, false);
  assert.equal(runtime.renderQueueCutoffValid, false);
  assert.equal(runtime.renderQueueCutoffAt, null);
  assert.equal(runtime.renderQueueCutoffBlockReason, null);
  assert.equal(runtime.renderPollingBlockReason, null);
  assert.equal(runtime.version, "0.2.0");
});

test("blank numeric env values keep defaults", () => {
  const config = loadConfigFromEnv({
    ...REQUIRED_ENV,
    OUTPUT_CRF: "",
    FFMPEG_THREADS: "",
    WATERMARK_VISION_FRAME_WIDTH: "",
  });
  const runtime = loadServerRuntimeFromEnv({
    PORT: "",
    POLL_INTERVAL_MS: "",
    HEARTBEAT_INTERVAL_MS: "",
  });

  assert.equal(config.crf, 20);
  assert.equal(config.threads, 3);
  assert.equal(config.watermarkVisionFrameWidth, 1440);
  assert.equal(runtime.port, 8787);
  assert.equal(runtime.pollIntervalMs, 5000);
  assert.equal(runtime.heartbeatIntervalMs, 30000);
  assert.equal(runtime.renderConcurrency, 1);
  assert.equal(runtime.shutdownGraceMs, 30000);
});

test("fails closed for invalid renderer capacity and shutdown grace", () => {
  assert.throws(
    () => loadServerRuntimeFromEnv({ RENDER_CONCURRENCY: "0" }),
    /RENDER_CONCURRENCY/,
  );
  assert.throws(
    () => loadServerRuntimeFromEnv({ RENDER_CONCURRENCY: "5" }),
    /RENDER_CONCURRENCY/,
  );
  assert.throws(
    () => loadServerRuntimeFromEnv({ RENDER_SHUTDOWN_GRACE_MS: "999" }),
    /RENDER_SHUTDOWN_GRACE_MS/,
  );
});

test("automatic polling requires an explicit switch and UTC cutoff", () => {
  const ready = loadServerRuntimeFromEnv({
    RENDER_POLLING_ENABLED: "true",
    RENDER_QUEUE_CUTOFF_AT: "2026-08-25T02:00:00Z",
  });
  assert.equal(ready.renderPollingEnabled, true);
  assert.equal(ready.renderPollingEffective, true);
  assert.equal(ready.renderQueueCutoffValid, true);
  assert.equal(ready.renderQueueCutoffAt, "2026-08-25T02:00:00.000Z");
  assert.equal(ready.renderQueueCutoffBlockReason, null);
  assert.equal(ready.renderPollingBlockReason, null);

  for (const cutoff of [undefined, "", "2026-08-25", "2026-08-25T02:00:00", "not-a-date"]) {
    const blocked = loadServerRuntimeFromEnv({
      RENDER_POLLING_ENABLED: "1",
      RENDER_QUEUE_CUTOFF_AT: cutoff,
    });
    assert.equal(blocked.renderPollingEffective, false);
    assert.equal(blocked.renderPollingBlockReason, "missing_or_invalid_render_queue_cutoff_at");
  }
  assert.equal(parseRenderQueueCutoffAt("2026-08-25T04:30:00+02:00"), "2026-08-25T02:30:00.000Z");
});
