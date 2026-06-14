import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRemovableWatermarkRequest,
  buildTranscriptCleanupRequest,
  buildTranslationRepairRequest,
  buildVisionPreflightRequest,
  buildTranslationRequest,
  cleanupTranscriptSegments,
  detectLanguageFromTranscription,
  parseRemovableWatermarkResult,
  parseVisionWatermarkResult,
  shouldRunSpecialistVisionChecks,
  translateSegments,
} from "../src/openai.js";

test("detects Persian and Hebrew from transcription metadata or script", () => {
  assert.equal(detectLanguageFromTranscription({ language: "fa", text: "سلام دنیا" }), "fa");
  assert.equal(detectLanguageFromTranscription({ text: "این یک جمله فارسی است" }), "fa");
  assert.equal(detectLanguageFromTranscription({ text: "שלום עולם" }), "he");
  assert.equal(detectLanguageFromTranscription({ text: "hello world" }), "en");
  assert.equal(detectLanguageFromTranscription({
    results: {
      channels: [{
        alternatives: [{ transcript: "Can we get a Free Palestine?", words: [{ word: "hello" }] }],
      }],
    },
  }), "en");
});

test("builds target-language-specific translation prompts", () => {
  const persian = buildTranslationRequest({
    model: "gpt-5.4-mini",
    targetLanguage: "fa",
    contextText: "Post context: Can we get a Free Palestine?",
    segments: [{ id: 1, start: 0, end: 1, text: "hello" }],
  });
  const english = buildTranslationRequest({
    model: "gpt-5.4-mini",
    targetLanguage: "en",
    segments: [{ id: 1, start: 0, end: 1, text: "سلام" }],
  });

  assert.match(JSON.stringify(persian), /natural Persian/);
  assert.match(JSON.stringify(persian), /quoted slogans, political phrases/);
  assert.match(JSON.stringify(persian), /Free Palestine/);
  assert.match(JSON.stringify(persian), /free concert/);
  assert.match(JSON.stringify(persian), /فری فلسطین/);
  assert.match(JSON.stringify(persian), /spoken Persian/);
  assert.match(JSON.stringify(persian), /cue N must contain only meaning from source cue N/);
  assert.match(JSON.stringify(persian), /Never move a sentence, phrase, or idea into an adjacent cue/);
  assert.match(JSON.stringify(persian), /یه «فلسطین آزاد» می‌گی؟/);
  assert.match(JSON.stringify(persian), /Give me one Free Palestine/);
  assert.match(JSON.stringify(persian), /بگو/);
  assert.match(JSON.stringify(persian), /Do not invent greetings/);
  assert.match(JSON.stringify(persian), /what up/);
  assert.equal(persian.temperature, 0);
  assert.match(JSON.stringify(english), /natural English/);
  assert.doesNotMatch(JSON.stringify(english), /natural Persian/);
});

test("builds translation repair prompts for invalid translated cues", () => {
  const request = buildTranslationRepairRequest({
    model: "gpt-5.4-mini",
    targetLanguage: "fa",
    sourceSegments: [{ id: 1, start: 0, end: 1, text: "המזרח התיכון משתנה." }],
    draftSegments: [{ id: 1, start: 0, end: 1, text: "" }],
    errorMessage: "empty cue text for id 1",
  });
  const text = JSON.stringify(request);

  assert.match(text, /Repair an invalid Persian subtitle translation/);
  assert.match(text, /Every output text must be non-empty/);
  assert.match(text, /same cue ids and exact timings/);
  assert.match(text, /empty cue text for id 1/);
  assert.equal(request.text.format.name, "repaired_translated_subtitle_segments");
});

test("builds a source transcript cleanup prompt before translation", () => {
  const request = buildTranscriptCleanupRequest({
    model: "gpt-5.4-mini",
    sourceLanguage: "en",
    contextText: "Post context: Jerry Seinfeld asks for a Free Palestine chant.",
    segments: [{ id: 1, start: 0, end: 1.8, text: "What up, S ten. Can we get a free pasta?" }],
  });
  const text = JSON.stringify(request);

  assert.match(text, /clean the source-language subtitle transcript/);
  assert.match(text, /Do not translate/);
  assert.match(text, /same cue ids and exact timings/);
  assert.match(text, /Free Palestine/);
  assert.match(text, /Jerry Seinfeld/);
  assert.match(text, /isolated repeated fragments/);
  assert.equal(request.temperature, 0);
  assert.equal(request.text.format.name, "cleaned_transcript_segments");
});

test("adds Hebrew-specific cleanup guidance for noisy military phrasing", () => {
  const request = buildTranscriptCleanupRequest({
    model: "gpt-5.4-mini",
    sourceLanguage: "he",
    contextText: "Post context: Israeli Defense Minister Israel Katz speaks about Iran and Hezbollah.",
    segments: [{ id: 1, start: 0, end: 1.8, text: "מניסיוני לקשור בין הזירות" }],
  });
  const text = JSON.stringify(request);

  assert.match(text, /For Hebrew political or military speech/);
  assert.match(text, /מניסיוני לקשור בין הזירות/);
  assert.match(text, /ואת ניסיונותיה לקשור בין הזירות/);
  assert.match(text, /split across adjacent short cues/);
});

test("adds protest chant guidance for repeated names and resignation demands", () => {
  const cleanup = buildTranscriptCleanupRequest({
    model: "gpt-5.4-mini",
    sourceLanguage: "en",
    contextText: "Post context: Protesters chant at Abbas Araghchi and Mohammad Bagher Ghalibaf.",
    segments: [{ id: 1, start: 0.48, end: 15.33, text: "Araghchi, Araghchi, Araghchi, Araghchi" }],
  });
  const translation = buildTranslationRequest({
    model: "gpt-5.4-mini",
    targetLanguage: "fa",
    segments: [{ id: 1, start: 0.48, end: 15.33, text: "Araghchi, resign." }],
  });

  const cleanupText = JSON.stringify(cleanup);
  assert.match(cleanupText, /protest\/crowd chants/);
  assert.match(cleanupText, /repeated official or politician names/);
  assert.match(cleanupText, /resign/);
  assert.match(cleanupText, /Do not add resignation language/);

  const translationText = JSON.stringify(translation);
  assert.match(translationText, /resignation chants/);
  assert.match(translationText, /استعفا بده/);
  assert.match(translationText, /do not output only the repeated name/);
});

test("cleans transcript segments with strict timing validation", async () => {
  const source = [
    { id: 1, start: 0, end: 1.3, text: "What up, S ten." },
    { id: 2, start: 1.4, end: 3.1, text: "Can we get a free pasta?" },
  ];
  const cleaned = [
    { id: 1, start: 0, end: 1.3, text: "What's up, Seinfeld?" },
    { id: 2, start: 1.4, end: 3.1, text: "Can we get a Free Palestine?" },
  ];

  const result = await cleanupTranscriptSegments({
    apiKey: "openai-key",
    model: "gpt-5.4-mini",
    sourceLanguage: "en",
    contextText: "Post context: Jerry Seinfeld and Free Palestine.",
    segments: source,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.model, "gpt-5.4-mini");
      return {
        ok: true,
        text: async () => JSON.stringify({ output_text: JSON.stringify({ segments: cleaned }) }),
      };
    },
  });

  assert.equal(result.model, "gpt-5.4-mini");
  assert.deepEqual(result.segments, cleaned);
});

test("repairs translated segments when the first translation has an empty cue", async () => {
  const source = [
    { id: 1, start: 0, end: 1, text: "המזרח התיכון משתנה." },
    { id: 2, start: 1, end: 2, text: "המערכה רחוקה מלהסתיים." },
  ];
  const draft = [
    { id: 1, start: 0, end: 1, text: "خاورمیانه در حال تغییر است." },
    { id: 2, start: 1, end: 2, text: "" },
  ];
  const repaired = [
    { id: 1, start: 0, end: 1, text: "خاورمیانه در حال تغییر است." },
    { id: 2, start: 1, end: 2, text: "این نبرد هنوز تمام نشده است." },
  ];
  const calls = [];

  const result = await translateSegments({
    apiKey: "openai-key",
    model: "gpt-5.4-mini",
    targetLanguage: "fa",
    segments: source,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body.text.format.name);
      return {
        ok: true,
        text: async () => JSON.stringify({
          output_text: JSON.stringify({ segments: calls.length === 1 ? draft : repaired }),
        }),
      };
    },
  });

  assert.deepEqual(calls, ["translated_subtitle_segments", "repaired_translated_subtitle_segments"]);
  assert.equal(result.repaired, true);
  assert.match(result.repairReason, /empty cue text/);
  assert.deepEqual(result.segments, repaired);
});

test("parses strict OpenAI vision watermark JSON", () => {
  const parsed = parseVisionWatermarkResult(JSON.stringify({
    has_watermark: true,
    confidence: 0.77,
    location: "top_right",
    detected_text_or_logo: "TikTok @source",
    has_subtitles: true,
    should_skip: true,
    should_block: true,
    block_reason: "large watermark",
    needs_specialist_review: false,
    overlays: [{
      text: "@source",
      category: "source_watermark_handle",
      action: "delogo",
      confidence: 0.91,
      box: { x: 0.25, y: 0.65, w: 0.2, h: 0.06 },
      reason: "source handle",
    }],
    existing_subtitles: {
      detected: true,
      confidence: 0.82,
      type: "hard_subtitle",
      action: "mask_subtitle_band",
      box: { x: 0.1, y: 0.72, w: 0.8, h: 0.12 },
      reason: "burned-in translation captions",
    },
    lower_text_region: {
      detected: true,
      confidence: 0.93,
      type: "news_ticker",
      action: "keep",
      box: { x: 0, y: 0.82, w: 1, h: 0.16 },
      reason: "news ticker should stay visible",
    },
    recommended_subtitle_zone: {
      placement: "above_lower_text",
      y: 0.68,
      max_width: 0.86,
      bottom_margin: 0.22,
      confidence: 0.88,
      reason: "place subtitles above ticker",
    },
    render_decision: {
      action: "render_with_delogo",
      confidence: 0.86,
      reason: "one removable source handle",
    },
  }));

  assert.equal(parsed.hasWatermark, true);
  assert.equal(parsed.confidence, 0.77);
  assert.equal(parsed.location, "top_right");
  assert.equal(parsed.detectedTextOrLogo, "TikTok @source");
  assert.equal(parsed.hasSubtitles, true);
  assert.equal(parsed.shouldSkip, true);
  assert.equal(parsed.shouldBlock, true);
  assert.equal(parsed.blockReason, "large watermark");
  assert.deepEqual(parsed.overlays[0], {
    text: "@source",
    category: "source_watermark_handle",
    action: "delogo",
    confidence: 0.91,
    box: { x: 0.25, y: 0.65, w: 0.2, h: 0.06 },
    reason: "source handle",
  });
  assert.equal(parsed.existingSubtitles.detected, true);
  assert.equal(parsed.lowerTextRegion.type, "news_ticker");
  assert.equal(parsed.subtitlePlacement.placement, "above_lower_text");
  assert.equal(parsed.subtitlePlacement.bottomMargin, 0.22);
  assert.equal(parsed.renderDecision.action, "render_with_delogo");
});

test("builds semantic vision preflight request with keep and delogo guidance", () => {
  const request = buildVisionPreflightRequest({
    model: "gpt-5.4-mini",
    imageBase64: "abc",
    frameBase64s: ["def", "ghi", "jkl"],
  });
  const text = JSON.stringify(request);

  assert.match(text, /Images 1-3 are individual source-video frames/);
  assert.match(text, /fully cover the visible handle/);
  assert.match(text, /UNCLASSIFIED/);
  assert.match(text, /CENTCOM/);
  assert.match(text, /lower_text_region/);
  assert.match(text, /bottom_margin/);
  assert.match(text, /action=delogo/);
  assert.match(text, /source_watermark_handle/);
  assert.match(text, /news_chyron_or_ticker/);
  assert.equal(request.input[0].content.filter((part) => part.type === "input_image").length, 4);
});

test("builds one-call watermark-only request with deterministic settings", () => {
  const request = buildRemovableWatermarkRequest({
    model: "gpt-5.4-mini",
    frameBase64s: ["a", "b", "c"],
    inspectionBase64s: ["d", "e", "f"],
    topP: 0.2,
  });
  const text = JSON.stringify(request);

  assert.equal(request.temperature, 0);
  assert.equal(request.top_p, 0.2);
  assert.equal(request.max_output_tokens, 1200);
  assert.match(text, /one narrow task/);
  assert.match(text, /zoomed inspection sheets/);
  assert.match(text, /Never return coordinates from an inspection sheet/);
  assert.match(text, /source-video frame coordinates/);
  assert.match(text, /advisory only/);
  assert.match(text, /local computer-vision recovery/);
  assert.match(text, /do not try to be pixel-perfect/);
  assert.match(text, /third-party watermarks/);
  assert.match(text, /removable watermark by default/);
  assert.match(text, /صواريخ الآن/);
  assert.match(text, /missiles now/);
  assert.match(text, /descriptive phrases/);
  assert.match(text, /unknown @handle/);
  assert.match(text, /Do not target/);
  assert.match(text, /CENTCOM/);
  assert.match(text, /must_keep/);
  assert.match(text, /lower burned-in dialogue subtitles/);
  assert.match(text, /hard_subtitle/);
  assert.match(text, /translated_subtitle/);
  assert.match(text, /placed above them/);
  assert.match(text, /Use decision=uncertain only/);
  assert.match(text, /removable_watermarks/);
  assert.equal(request.input[0].content.filter((part) => part.type === "input_image").length, 6);
  assert.equal(request.input[0].content.filter((part) => part.type === "input_image").every((part) => part.detail === "high"), true);
});

test("parses watermark-only result and marks sentinel boxes invalid", () => {
  const parsed = parseRemovableWatermarkResult(JSON.stringify({
    decision: "render_with_delogo",
    confidence: 0.91,
    reason: "one repost handle",
    removable_watermarks: [{
      text: "@source",
      type: "repost_handle",
      confidence: 0.96,
      box: { x: 1, y: 1, w: 1, h: 1 },
      seen_in_frames: [1, 2, 3],
      safe_to_delogo: true,
      reason: "third-party mark",
    }],
    must_keep: [{ text: "FOX NEWS", type: "broadcaster_branding", reason: "source context" }],
  }));

  assert.equal(parsed.decision, "render_with_delogo");
  assert.equal(parsed.removableWatermarks[0].box.valid, false);
  assert.deepEqual(parsed.removableWatermarks[0].seenInFrames, [1, 2, 3]);
  assert.equal(parsed.mustKeep[0].text, "FOX NEWS");
});

test("protects descriptive lower-third text misclassified as a removable handle", () => {
  const parsed = parseRemovableWatermarkResult(JSON.stringify({
    decision: "render_with_delogo",
    confidence: 0.99,
    reason: "Arabic handle watermark",
    removable_watermarks: [{
      text: "صواريخ الان",
      type: "creator_handle",
      confidence: 0.99,
      box: { x: 0.36, y: 0.84, w: 0.28, h: 0.06 },
      seen_in_frames: [1, 2, 3],
      safe_to_delogo: true,
      reason: "Static Arabic text on a lower-third bar",
    }],
    must_keep: [],
  }));

  assert.equal(parsed.decision, "render");
  assert.equal(parsed.removableWatermarks.length, 0);
  assert.equal(parsed.mustKeep[0].text, "صواريخ الان");
  assert.equal(parsed.shouldBlock, false);
});

test("keeps two-word Latin overlay logos removable when the reason identifies branding", () => {
  const parsed = parseRemovableWatermarkResult(JSON.stringify({
    decision: "render_with_delogo",
    confidence: 0.99,
    reason: "static logo",
    removable_watermarks: [{
      text: "RAPID RESPONSE",
      type: "creator_handle",
      confidence: 0.99,
      box: { x: 1, y: 1, w: 1, h: 1 },
      seen_in_frames: [1, 2, 3],
      safe_to_delogo: true,
      reason: "Static overlaid brand/logo watermark in the upper-left corner.",
    }],
    must_keep: [],
  }));

  assert.equal(parsed.decision, "render_with_delogo");
  assert.equal(parsed.removableWatermarks.length, 1);
  assert.equal(parsed.removableWatermarks[0].text, "RAPID RESPONSE");
  assert.equal(parsed.mustKeep.length, 0);
});

test("protects official source marks misclassified as removable watermarks", () => {
  const parsed = parseRemovableWatermarkResult(JSON.stringify({
    decision: "render_with_delogo",
    confidence: 0.98,
    reason: "GPO third-party watermark",
    removable_watermarks: [{
      text: "GPO",
      type: "third_party_watermark",
      confidence: 0.98,
      box: { x: 1, y: 1, w: 1, h: 1 },
      seen_in_frames: [1, 2, 3],
      safe_to_delogo: true,
      reason: "Small persistent GPO logo in the upper-left corner",
    }],
    must_keep: [],
  }));

  assert.equal(parsed.decision, "render");
  assert.equal(parsed.removableWatermarks.length, 0);
  assert.equal(parsed.mustKeep[0].text, "GPO");
  assert.equal(parsed.mustKeep[0].type, "source_context");
  assert.equal(parsed.shouldBlock, false);
});

test("keeps Telegram channel logo text removable without a literal handle marker", () => {
  const parsed = parseRemovableWatermarkResult(JSON.stringify({
    decision: "render_with_delogo",
    confidence: 0.99,
    reason: "Telegram channel watermark",
    removable_watermarks: [{
      text: "Alibk3",
      type: "creator_handle",
      confidence: 0.99,
      box: { x: 1, y: 1, w: 1, h: 1 },
      seen_in_frames: [1, 2, 3],
      safe_to_delogo: true,
      reason: "Persistent centered Telegram channel watermark/logo",
    }],
    must_keep: [],
  }));

  assert.equal(parsed.decision, "render_with_delogo");
  assert.equal(parsed.removableWatermarks.length, 1);
  assert.equal(parsed.removableWatermarks[0].text, "Alibk3");
  assert.deepEqual(parsed.mustKeep, []);
});

test("specialist vision checks run only for uncertain or complex primary results", () => {
  assert.equal(shouldRunSpecialistVisionChecks({
    confidence: 0.95,
    overlays: [{ action: "delogo", confidence: 0.93 }],
    lowerTextRegion: { detected: false },
    subtitlePlacement: { confidence: 0.9 },
    renderDecision: { action: "render_with_delogo" },
  }), false);

  assert.equal(shouldRunSpecialistVisionChecks({
    confidence: 0.72,
    overlays: [
      { action: "delogo", confidence: 0.8 },
      { action: "delogo", confidence: 0.88 },
    ],
    lowerTextRegion: { detected: true },
    subtitlePlacement: { confidence: 0.4 },
    renderDecision: { action: "manual_review" },
  }), true);
});
