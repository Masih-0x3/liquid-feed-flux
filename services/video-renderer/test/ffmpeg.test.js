import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAudioWindowExtractCommand,
  buildEnhancedAudioExtractCommand,
  buildOpenCvInpaintRenderCommand,
  captionDetectionFps,
  buildFrameSampleCommand,
  buildRenderCommand,
  buildWatermarkInspectionSheetCommand,
  resolveWatermarkLayout,
  shouldEnableAdaptiveMask,
} from "../src/ffmpeg.js";

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

test("adaptive mask is enabled only when caption detection is confident", () => {
  assert.equal(shouldEnableAdaptiveMask({ captionBandScore: 0.81, textLikeRegions: 4 }), true);
  assert.equal(shouldEnableAdaptiveMask({ captionBandScore: 0.81, textLikeRegions: 1 }), false);
  assert.equal(shouldEnableAdaptiveMask({ captionBandScore: 0.49, textLikeRegions: 8 }), false);
});

test("caption detection samples across longer videos instead of only the opening seconds", () => {
  assert.equal(captionDetectionFps({ durationMs: 4000 }, 6), 1);
  assert.equal(Number(captionDetectionFps({ durationMs: 30000 }, 6).toFixed(2)), 0.2);
  assert.equal(Number(captionDetectionFps({ durationMs: 120000 }, 6).toFixed(2)), 0.05);
});

test("early audio extraction cuts a bounded opening window for transcript rescue", () => {
  const command = buildAudioWindowExtractCommand("/tmp/in.mp4", "/tmp/audio.early.mp3", {
    startSeconds: 0,
    durationSeconds: 14,
  });

  assert.equal(command.bin, "ffmpeg");
  assert.deepEqual(command.args.slice(0, 8), [
    "-hide_banner",
    "-y",
    "-ss",
    "0",
    "-t",
    "14",
    "-i",
    "/tmp/in.mp4",
  ]);
  assert.ok(command.args.includes("-vn"));
  assert.ok(command.args.includes("16000"));
  assert.equal(command.args.at(-1), "/tmp/audio.early.mp3");
});

test("enhanced audio extraction uses speech-focused normalization for rescue transcription", () => {
  const command = buildEnhancedAudioExtractCommand("/tmp/in.mp4", "/tmp/audio.enhanced.mp3");
  const args = command.args.join(" ");

  assert.equal(command.bin, "ffmpeg");
  assert.match(args, /highpass=f=120/);
  assert.match(args, /lowpass=f=3800/);
  assert.match(args, /afftdn=nf=-25/);
  assert.match(args, /dynaudnorm=f=150:g=15:p=0\.95/);
  assert.ok(command.args.includes("64k"));
});

test("render command performs one encoded pass with subtitles and watermark overlay", () => {
  const command = buildRenderCommand({
    inputPath: "/tmp/in.mp4",
    assPath: "/tmp/fa.ass",
    watermarkPath: "/tmp/watermark.ass",
    outputPath: "/tmp/out.mp4",
    width: 1080,
    height: 1920,
    enableAdaptiveMask: true,
    crf: 23,
    preset: "veryfast",
    threads: 3,
    delogoRegions: [{ x: 150.4, y: 174.2, w: 138, h: 25 }],
  });

  assert.equal(command.bin, "ffmpeg");
  assert.equal(command.args.filter((arg) => arg === "-filter_complex").length, 1);
  assert.ok(command.args.includes("libx264"));
  assert.ok(command.args.includes("+faststart"));
  assert.ok(command.args.includes("yuv420p"));
  assert.ok(command.args.includes("-sn"));
  assert.match(command.args.join(" "), /subtitles=.*fa\.ass/);
  assert.match(command.args.join(" "), /drawtext=.*@Masihh/);
  assert.match(command.args.join(" "), /delogo=x=150:y=174:w=138:h=25/);
  assert.match(command.args.join(" "), /fontcolor=white@0\.34/);
  assert.match(command.args.join(" "), /drawbox=x=0:y=ih\*0\.70:w=iw:h=ih\*0\.24:color=black@0\.18/);
  assert.ok(command.args.join(" ").indexOf("delogo=x=150") < command.args.join(" ").indexOf("subtitles="));
});

test("render command can delogo without watermark when no subtitle track exists", () => {
  const command = buildRenderCommand({
    inputPath: "/tmp/in.mp4",
    assPath: null,
    outputPath: "/tmp/out.mp4",
    width: 720,
    height: 1280,
    delogoRegions: [{ x: 285, y: 1048, w: 149, h: 46 }],
  });
  const args = command.args.join(" ");

  assert.doesNotMatch(args, /drawtext=.*@Masihh/);
  assert.match(args, /delogo=x=285:y=1048:w=149:h=46/);
  assert.doesNotMatch(args, /subtitles=/);
  assert.ok(command.args.includes("-sn"));
});

test("render command can explicitly watermark a delogo-only render", () => {
  const command = buildRenderCommand({
    inputPath: "/tmp/in.mp4",
    assPath: null,
    outputPath: "/tmp/out.mp4",
    width: 720,
    height: 1280,
    enableWatermark: true,
    delogoRegions: [{ x: 285, y: 1048, w: 149, h: 46 }],
  });
  const args = command.args.join(" ");

  assert.match(args, /drawtext=.*@Masihh/);
  assert.match(args, /delogo=x=285:y=1048:w=149:h=46/);
  assert.match(args, /fontcolor=white@0\.34/);
  assert.doesNotMatch(args, /subtitles=/);
});

test("watermark layout avoids stacking global marks on delogo repairs", () => {
  const layout = resolveWatermarkLayout({
    width: 1920,
    height: 1080,
    delogoRegions: [{ x: 707, y: 521, w: 793, h: 169 }],
  });

  assert.equal(layout.local.length, 1);
  assert.equal(layout.local[0].text, "X @Masihh");
  assert.ok(layout.center);
  assert.equal(overlaps(layout.local[0].region, layout.center.region), false);
  assert.equal(layout.ghosts.every((ghost) => !overlaps(layout.local[0].region, ghost.region)), true);
});

test("watermark layout keeps repeated marks light and makes the badge legible", () => {
  const layout = resolveWatermarkLayout({
    width: 1280,
    height: 720,
    hasSubtitleTrack: true,
    subtitlePlacement: { marginV: 216 },
  });

  assert.equal(layout.center.opts.fontColor, "white@0.16");
  assert.equal(layout.badge.opts.fontColor, "white@0.34");
  assert.ok(layout.badge.opts.fontSize >= 30);
  assert.equal(layout.badge.opts.box, false);
  assert.equal(layout.badge.opts.boxColor, "black@0.00");
  assert.equal(layout.badge.opts.boxBorder, 0);
  assert.equal(layout.badge.opts.border.width, 1);
  assert.equal(layout.badge.opts.border.color, "black@0.34");
  assert.equal(layout.badge.opts.shadow.color, "black@0.36");
  assert.equal(layout.badge.opts.sideShadow.color, "black@0.18");
  assert.ok(layout.ghosts.length >= 4);
  assert.equal(layout.ghosts.every((ghost) => Number(String(ghost.opts.fontColor).split("@")[1]) <= 0.132), true);
  assert.ok(layout.center.opts.sideShadow);
  assert.equal(layout.ghosts.every((ghost) => Boolean(ghost.opts.sideShadow)), true);
});

test("delogo replacement watermark covers most of the repaired region", () => {
  const repair = { x: 707, y: 521, w: 793, h: 169 };
  const layout = resolveWatermarkLayout({
    width: 1920,
    height: 1080,
    delogoRegions: [repair],
  });

  assert.equal(layout.local.length, 1);
  assert.ok(layout.local[0].region.w >= repair.w * 0.82);
  assert.ok(layout.local[0].region.h >= repair.h * 0.82);
  assert.ok(layout.local[0].region.x >= repair.x);
  assert.ok(layout.local[0].region.y >= repair.y);
  assert.ok(layout.local[0].region.x + layout.local[0].region.w <= repair.x + repair.w);
  assert.ok(layout.local[0].region.y + layout.local[0].region.h <= repair.y + repair.h);
});

test("watermark layout respects subtitle and protected regions", () => {
  const layout = resolveWatermarkLayout({
    width: 1280,
    height: 720,
    hasSubtitleTrack: true,
    subtitlePlacement: { marginV: 216 },
    protectedRegions: [{ x: 0.78, y: 0.02, w: 0.20, h: 0.10 }],
  });
  const subtitleRegion = { x: 0, y: 374, w: 1280, h: 346 };
  const protectedTopRight = { x: 998, y: 14, w: 256, h: 72 };

  for (const placement of [layout.center, layout.badge, ...layout.ghosts].filter(Boolean)) {
    assert.equal(overlaps(placement.region, subtitleRegion), false);
    assert.equal(overlaps(placement.region, protectedTopRight), false);
  }
});

test("OpenCV inpaint render command pipes cleaned frames into final encode", () => {
  const command = buildOpenCvInpaintRenderCommand({
    inputPath: "/tmp/in.mp4",
    assPath: "/tmp/fa.ass",
    outputPath: "/tmp/out.mp4",
    width: 1920,
    height: 1080,
    fps: 30,
    delogoRegions: [{ x: 707, y: 521, w: 793, h: 169 }],
    opencvPython: "/venv/bin/python",
    opencvScript: "/srv/opencv_inpaint_pipe.py",
    opencvMode: "hybrid",
    opencvAlgorithm: "telea",
    opencvRadius: 2,
    opencvKernel: 7,
    opencvDilateIterations: 2,
    opencvCloseIterations: 1,
    opencvFeather: 0,
  });
  const producerArgs = command.pipeline[0].args.join(" ");
  const consumerArgs = command.pipeline[1].args.join(" ");

  assert.equal(command.bin, "pipeline");
  assert.equal(command.pipeline[0].bin, "/venv/bin/python");
  assert.match(producerArgs, /--rect 707,521,793,169/);
  assert.match(producerArgs, /--algorithm telea/);
  assert.match(producerArgs, /--radius 2/);
  assert.match(consumerArgs, /-f rawvideo/);
  assert.match(consumerArgs, /-s 1920x1080/);
  assert.match(consumerArgs, /-map 1:a\?/);
  assert.doesNotMatch(consumerArgs, /delogo=x=/);
  assert.match(consumerArgs, /fontcolor=white@0\.34/);
  assert.match(consumerArgs, /fontcolor=black@0\.22/);
  assert.match(consumerArgs, /bordercolor=black@0\.28/);
  assert.match(consumerArgs, /subtitles=.*fa\.ass/);
  assert.match(consumerArgs, /drawtext=.*@Masihh/);
});

test("OpenCV inpaint delogo-only command does not draw watermark by default", () => {
  const command = buildOpenCvInpaintRenderCommand({
    inputPath: "/tmp/in.mp4",
    assPath: null,
    outputPath: "/tmp/out.mp4",
    width: 1920,
    height: 1080,
    fps: 30,
    delogoRegions: [{ x: 707, y: 521, w: 793, h: 169 }],
    opencvPython: "/venv/bin/python",
    opencvScript: "/srv/opencv_inpaint_pipe.py",
  });
  const consumerArgs = command.pipeline[1].args.join(" ");

  assert.doesNotMatch(consumerArgs, /drawtext=.*@Masihh/);
  assert.doesNotMatch(consumerArgs, /subtitles=/);
  assert.match(consumerArgs, /-filter_complex \[0:v\]null\[v\]/);
});

test("frame sample command extracts one source frame for vision box coordinates", () => {
  const command = buildFrameSampleCommand("/tmp/in.mp4", "/tmp/frame.jpg", { seekSeconds: 4.2, width: 1440 });

  assert.equal(command.bin, "ffmpeg");
  assert.deepEqual(command.args.slice(0, 10), ["-hide_banner", "-y", "-ss", "4.2", "-i", "/tmp/in.mp4", "-vf", "scale=1440:-1:flags=lanczos", "-frames:v", "1"]);
  assert.ok(command.args.includes("/tmp/frame.jpg"));
});

test("watermark inspection sheet command creates zoomed regions from a sampled frame", () => {
  const command = buildWatermarkInspectionSheetCommand("/tmp/frame.jpg", "/tmp/inspect.jpg", {
    tileWidth: 640,
    tileHeight: 320,
  });
  const args = command.args.join(" ");

  assert.equal(command.bin, "ffmpeg");
  assert.match(args, /crop=iw\*0\.50:ih\*0\.34:0:0/);
  assert.match(args, /crop=iw\*0\.62:ih\*0\.38:iw\*0\.19:ih\*0\.56/);
  assert.match(args, /xstack=inputs=6/);
  assert.match(args, /layout=0_0\|640_0\|0_320\|640_320\|0_640\|640_640/);
  assert.ok(command.args.includes("/tmp/inspect.jpg"));
});
