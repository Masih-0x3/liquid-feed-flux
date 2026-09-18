// 0X3-672 W5 benchmark: generate the fixed synthetic cohort.
// Runs inside the production renderer image so fixture ffmpeg flags match the
// real toolchain (drawtext/libass available, same encoders).
// 21 clips across duration buckets, orientation, noise, audio, watermark text.

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const OUT = process.env.COHORT_DIR || "/bench/cohort";
const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

// duration buckets: <=30s, 31-90s, 91-240s
const DURATIONS = [8, 12, 16, 20, 24, 28, 30, 32, 40, 48, 56, 64, 72, 80, 88, 95, 110, 130, 160, 190, 220];

const clips = DURATIONS.map((duration, i) => {
  const portrait = i % 2 === 0;
  return {
    name: `clip-${String(i + 1).padStart(2, "0")}`,
    file: `clip-${String(i + 1).padStart(2, "0")}.mp4`,
    duration_s: duration,
    width: portrait ? 1080 : 1920,
    height: portrait ? 1920 : 1080,
    orientation: portrait ? "portrait" : "landscape",
    noisy: i % 3 === 0,
    audio: !(i === 4 || i === 9 || i === 14 || i === 19),
    watermark_text: i % 3 === 1 ? "@xot_source" : null,
    bucket: duration <= 30 ? "short" : duration <= 90 ? "mid" : "long",
  };
});

await mkdir(OUT, { recursive: true });

for (const clip of clips) {
  const dest = join(OUT, clip.file);
  const vfilters = [];
  // Keep noise light: sources should land in realistic X-video bitrate range
  // (~2-8 Mbps), not entropy-bombed files that force encode-retry ladders.
  if (clip.noisy) vfilters.push("noise=alls=8:allf=t");
  if (clip.watermark_text) {
    vfilters.push(
      `drawtext=fontfile=${FONT}:text='${clip.watermark_text}':fontsize=${clip.orientation === "portrait" ? 42 : 36}:fontcolor=white@0.85:borderw=2:bordercolor=black@0.6:x=w-tw-36:y=36`,
    );
  }
  // A persistent bottom caption band so OCR/caption-detection stages do real work.
  vfilters.push(
    `drawtext=fontfile=${FONT}:text='Synthetic caption line ${clip.name}':fontsize=34:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=12:x=(w-text_w)/2:y=h*0.78`,
  );
  const vchain = vfilters.length ? `,${vfilters.join(",")}` : "";

  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  args.push("-f", "lavfi", "-i", `testsrc2=size=${clip.width}x${clip.height}:rate=30:duration=${clip.duration_s}`);
  if (clip.audio) {
    // Speech-like energy: dual sines under light pink noise.
    args.push(
      "-f", "lavfi", "-i", `sine=frequency=220:duration=${clip.duration_s}`,
      "-f", "lavfi", "-i", `sine=frequency=330:duration=${clip.duration_s}`,
      "-f", "lavfi", "-i", `anoisesrc=color=pink:duration=${clip.duration_s}:amplitude=0.06:seed=7`,
      "-filter_complex",
      `[0:v]${vchain ? vchain.slice(1) : "null"}[v];[1:a][2:a]amix=inputs=2:weights='0.6 0.4':normalize=0[a0];[a0][3:a]amix=inputs=2:weights='0.85 0.15':normalize=0[a]`,
      "-map", "[v]", "-map", "[a]",
    );
  } else {
    if (vchain) args.push("-vf", vchain.slice(1));
    args.push("-an");
  }
  args.push(
    "-c:v", "libx264", "-preset", "veryfast", "-crf", clip.noisy ? "27" : "24",
    "-maxrate", "6M", "-bufsize", "12M", "-pix_fmt", "yuv420p",
  );
  if (clip.audio) args.push("-c:a", "aac", "-b:a", "128k");
  args.push(dest);

  const t0 = Date.now();
  await execFileAsync("ffmpeg", args, { maxBuffer: 16 * 1024 * 1024 });
  const { stdout: sizeOut } = await execFileAsync("stat", ["-c", "%s", dest]);
  clip.bytes = Number(sizeOut.trim());
  console.log(`${clip.name} ${clip.duration_s}s ${clip.orientation}${clip.noisy ? " noisy" : ""}${clip.audio ? " audio" : " silent"}${clip.watermark_text ? " wm" : ""} ${(clip.bytes / 1048576).toFixed(1)}MB (${Date.now() - t0}ms)`);
}

await writeFile(join(OUT, "manifest.json"), JSON.stringify({ generated: new Date().toISOString(), clips }, null, 2));
console.log(`manifest: ${clips.length} clips`);
