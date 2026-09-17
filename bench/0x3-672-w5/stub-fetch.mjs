// Deterministic provider stubs for the 0X3-672 W5 benchmark.
// Every external HTTP call the renderer makes is answered locally with a fixed
// artificial latency so before/after comparisons isolate the pipeline overlap
// change rather than real provider variance.

const PROVIDER_LATENCY_MS = Number(process.env.BENCH_PROVIDER_LATENCY_MS ?? 900);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Deepgram listen response: timed utterances covering the first ~12s at high
// confidence so no enhanced-audio retry or early-rescue path triggers.
function deepgramPayload() {
  const words = [];
  const utterances = [];
  const cueTexts = [
    "Welcome back to the channel everyone.",
    "Today we are looking at a quick news update.",
    "The situation on the ground keeps changing fast.",
    "Here is what we know so far this morning.",
  ];
  let t = 0.5;
  for (let i = 0; i < cueTexts.length; i += 1) {
    const text = cueTexts[i];
    const start = t;
    const end = t + 2.4;
    utterances.push({ start, end, transcript: text, confidence: 0.98, channel: 0, speaker: 0 });
    for (const word of text.split(" ")) {
      words.push({ word, punctuated_word: word, start, end: Math.min(end, start + 0.3), confidence: 0.98 });
    }
    t = end + 0.6;
  }
  return {
    metadata: { duration: 12, request_id: "bench-deepgram" },
    results: {
      channels: [{
        detected_language: "en",
        language_confidence: 0.99,
        alternatives: [{ transcript: cueTexts.join(" "), confidence: 0.98, words }],
      }],
      utterances,
    },
  };
}

// Vision watermark analysis: clean result → normal render path (no delogo,
// no block). Deterministic across runs.
function visionPayload() {
  return {
    output_text: JSON.stringify({
      has_watermark: false,
      confidence: 0.92,
      location: "none",
      detected_text_or_logo: "",
      has_subtitles: false,
      should_block: false,
      block_reason: "",
      existing_subtitles: { detected: false, confidence: 0.1, band: "none" },
      lower_text_region: { detected: false, confidence: 0.1, band: "none" },
      recommended_subtitle_zone: "bottom",
      render_decision: "render",
      needs_specialist_review: false,
      overlays: [],
    }),
  };
}

// Removable-watermark specialist call (second vision endpoint shape).
function removableWatermarkPayload() {
  return {
    output_text: JSON.stringify({
      decision: "render",
      confidence: 0.9,
      reason: "no removable watermark detected",
      removable_watermarks: [],
      must_keep: [],
    }),
  };
}

// Cleanup / translation responses echo the submitted segments verbatim
// (translate adds a Persian prefix) so cue count + timings validate exactly
// and no repair round-trip is needed.
function segmentsResponse(parsedBody) {
  const parts = parsedBody?.input
    ?.flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    ?.map((part) => part?.text ?? "")
    ?.filter(Boolean) ?? [];
  let segments = [];
  let isTranslation = false;
  for (const text of parts) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed?.segments)) {
        segments = parsed.segments;
        isTranslation = Boolean(parsed?.target_language);
        break;
      }
    } catch { /* not the JSON content part */ }
  }
  const out = segments.map((seg) => ({
    id: seg.id,
    start: seg.start,
    end: seg.end,
    text: isTranslation ? `ترجمهٔ ${seg.text}` : seg.text,
  }));
  return { output_text: JSON.stringify({ segments: out }) };
}

export function createStubFetch(calls = []) {
  return async function stubFetch(url, init = {}) {
    const target = String(url);
    const started = Date.now();
    await sleep(PROVIDER_LATENCY_MS);
    let response;
    if (target.includes("api.deepgram.com")) {
      response = jsonResponse(deepgramPayload());
    } else if (target.includes("api.openai.com")) {
      let parsed = null;
      try { parsed = JSON.parse(String(init.body ?? "")); } catch { parsed = null; }
      const bodyText = String(init.body ?? "");
      const hasImages = bodyText.includes('"input_image"') || bodyText.includes('"image_url"');
      if (hasImages && bodyText.includes("removable_watermarks")) {
        response = jsonResponse(removableWatermarkPayload());
      } else if (hasImages) {
        response = jsonResponse(visionPayload());
      } else {
        response = jsonResponse(segmentsResponse(parsed));
      }
    } else {
      response = jsonResponse({});
    }
    calls.push({ url: target.slice(0, 120), ms: Date.now() - started, status: response.status });
    return response;
  };
}
