# 0X3-672 W5 renderer benchmark harness

Paired before/after benchmark for the renderer overlap change (`7c98f68`).

## What it does

- `gen-cohort.mjs` — builds the fixed 21-clip synthetic cohort inside the
  production renderer image (`xot-video-renderer:<tag>`) so fixture ffmpeg
  flags match the real toolchain. Buckets: ≤30s / 31–90s / 91–240s, portrait +
  landscape, clean/noisy, audio/silent, watermark-text overlay on ~1/3.
- `run-clip.mjs` — drives the real `processRenderRow` for one clip with a fake
  Supabase (`fake-supabase.mjs`) and deterministic provider stubs
  (`stub-fetch.mjs`, ~900ms latency). Local stages (ffprobe, ffmpeg,
  tesseract) run for real; Deepgram/OpenAI are stubbed.
- `run-paired.mjs` — interleaved pairs: per clip, runs BEFORE then AFTER
  back-to-back so sustained host load affects both revisions equally.
- `compare-paired.mjs` — per-clip medians across rounds, cohort p50/p95, a
  noise-immune modeled-overlap estimate per run, and quality-equivalence
  checks (ok parity, failure-mode parity, output probes via ffprobe).

## Running

```bash
# two worktrees: before = 6686368 (pre-overlap), after = branch tip
docker run --rm -v "$BENCH:/bench" \
  -v "$BEFORE/services/video-renderer:/src-before" \
  -v "$AFTER/services/video-renderer:/src-after" \
  -w /bench xot-video-renderer:<tag> \
  node harness/gen-cohort.mjs            # once — writes cohort/ + manifest.json

node harness/run-paired.mjs --before /src-before/src --after /src-after/src --round p1
# repeat for p2, p3, then:
node harness/compare-paired.mjs --rounds=p1,p2,p3 --probe
```

## Measured results (2026-09-17, 3 paired rounds, 63 renders)

- Outputs: **15/15 rendered files MD5-identical** between revisions — the
  byte-identity check runs in `compare-paired.mjs --probe` (missing,
  unprobeable, or differing artifacts are reported as issues and fail the
  run); duration, resolution, audio presence, and ≤49MB output cap are
  verified per output by ffprobe.
- Failure parity: the two >160s portrait clips exhaust the encode-retry
  ladder identically on both revisions (`output exceeds max output bytes`).
- Wall clock (per-clip medians): p50 −1.9%, p95 −9.3%; median delta −793ms.
- Noise-immune overlap model (each run's own stage timings): median saving
  ≈0.9s/clip (~1.4% of mean clip time), p95 ≈1.4s.
- The encode-retry ladder dominates tail latency (clips 12–14 burn a second
  full encode; 19/21 burn ~4–5 min then fail) — the remaining lever, not
  addressed here since it changes encode policy.
- ≥25% p95 goal NOT claimed: measured evidence does not support it.
