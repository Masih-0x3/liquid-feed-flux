import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeepgramListenUrl,
  extractDeepgramKeyterms,
  normalizeDeepgramResponse,
  resolveDeepgramLanguageAttempts,
  transcribeWithDeepgram,
} from "../src/deepgram.js";

test("builds Deepgram prerecorded listen URL with automatic language detection", () => {
  const url = buildDeepgramListenUrl({
    model: "nova-3",
    detectLanguage: true,
    language: "",
    keyterms: ["Free Palestine", "Jerry Seinfeld"],
  });

  assert.equal(url.origin, "https://api.deepgram.com");
  assert.equal(url.pathname, "/v1/listen");
  assert.equal(url.searchParams.get("model"), "nova-3");
  assert.equal(url.searchParams.get("smart_format"), "true");
  assert.equal(url.searchParams.get("punctuate"), "true");
  assert.equal(url.searchParams.get("utterances"), "true");
  assert.equal(url.searchParams.get("paragraphs"), "true");
  assert.equal(url.searchParams.get("detect_language"), "true");
  assert.equal(url.searchParams.has("language"), false);
  assert.deepEqual(url.searchParams.getAll("keyterm"), ["Free Palestine", "Jerry Seinfeld"]);
});

test("allows explicit Deepgram language overrides for multilingual or monolingual runs", () => {
  const url = buildDeepgramListenUrl({ model: "nova-3", language: "multi", detectLanguage: false });

  assert.equal(url.searchParams.get("language"), "multi");
  assert.equal(url.searchParams.has("detect_language"), false);
});

test("extracts Deepgram keyterms from post context", () => {
  assert.deepEqual(
    extractDeepgramKeyterms("Post context: Can we get a 'Free Palestine' from Jerry Seinfeld near CENTCOM?"),
    ["Free Palestine", "Jerry Seinfeld", "CENTCOM"],
  );
});

test("ignores OCR garbage and visual notes when extracting Deepgram keyterms", () => {
  assert.deepEqual(
    extractDeepgramKeyterms([
      "Post context: Reports a 'Missile launch' near CENTCOM.",
      "Visible OCR text: 7 Fy fee) ied w Sa Z",
      "P s : . uf",
      "Visual note: The Arabic text appears to be scene/context text and not a watermark.",
    ].join("\n")),
    ["Missile launch", "CENTCOM"],
  );
});

test("prioritizes multilingual Deepgram mode for Latin post context", () => {
  const attempts = resolveDeepgramLanguageAttempts({
    language: "",
    detectLanguage: true,
    languageFallbacks: ["multi", "en", "fa", "he", "ar"],
    contextText: "Post context: Can we get a 'Free Palestine' from Jerry Seinfeld?",
  });

  assert.deepEqual(attempts.map((attempt) => attempt.language || "auto"), ["multi", "auto", "en", "fa", "he", "ar"]);
  assert.equal(attempts[0].detectLanguage, false);
  assert.equal(attempts[1].detectLanguage, true);
});

test("does not let existing Persian post translation bias Deepgram language attempts", () => {
  const attempts = resolveDeepgramLanguageAttempts({
    language: "",
    detectLanguage: true,
    languageFallbacks: ["multi", "en", "fa", "he", "ar"],
    contextText: [
      "Post context:",
      "Author: osint613",
      "Post: Hezbollah taking advantage and sending suicide drones into Israel",
      "Existing translated post: حزب‌الله لبنان از وضعیت موجود استفاده می‌کند و پهپادهای انتحاری به اسرائیل می‌فرستد.",
      "URL: https://twitter.com/Osint613/status/2066053953842745673",
    ].join("\n"),
  });

  assert.deepEqual(attempts.map((attempt) => attempt.language || "auto"), ["multi", "auto", "en", "fa", "he", "ar"]);
});

test("does not force Farsi from Persian or Arabic-script post copy", () => {
  const attempts = resolveDeepgramLanguageAttempts({
    language: "",
    detectLanguage: true,
    languageFallbacks: ["multi", "en", "fa", "he", "ar"],
    contextText: [
      "Post context:",
      "Author: osint613",
      "Post: لحظه‌ای که ارتش اسرائیل مرکز فرماندهی حزب‌الله را هدف قرار داد.",
      "Existing translated post: لحظه‌ای که ارتش اسرائیل مرکز فرماندهی حزب‌الله را هدف قرار داد.",
      "URL: https://twitter.com/Osint613/status/2066116702878761242",
      "Visual note: No removable third-party watermark is visible.",
    ].join("\n"),
  });

  assert.deepEqual(attempts.map((attempt) => attempt.language || "auto"), ["multi", "auto", "en", "fa", "he", "ar"]);
});

test("does not let raw OCR script alone bias Deepgram spoken-language attempts", () => {
  const attempts = resolveDeepgramLanguageAttempts({
    language: "",
    detectLanguage: true,
    languageFallbacks: ["multi", "en", "fa", "he", "ar"],
    contextText: [
      "Post context:",
      "Author: osint613",
      "Post: Hezbollah taking advantage and sending suicide drones into Israel",
      "Visible OCR text: ‎בطم 4 om! ۳ لخ ران ليتق اک",
      "Visual note: No clear removable third-party watermark is visible.",
    ].join("\n"),
  });

  assert.deepEqual(attempts.map((attempt) => attempt.language || "auto"), ["multi", "auto", "en", "fa", "he", "ar"]);
});

test("prioritizes Farsi when visual context indicates Persian broadcast graphics", () => {
  const attempts = resolveDeepgramLanguageAttempts({
    language: "",
    detectLanguage: true,
    languageFallbacks: ["multi", "en", "fa", "he", "ar"],
    contextText: "Post context: English summary. Visual note: SNN / SNNTV / TV.SNN.IR broadcaster graphics and lower-third.",
  });

  assert.deepEqual(attempts.map((attempt) => attempt.language || "auto"), ["fa", "multi", "auto", "en", "he", "ar"]);
});

test("prioritizes Arabic when visual context identifies Arabic text", () => {
  const attempts = resolveDeepgramLanguageAttempts({
    language: "",
    detectLanguage: true,
    languageFallbacks: ["multi", "en", "fa", "he", "ar"],
    contextText: "Visual note: contextual Arabic lower-third/title; not a removable watermark.",
  });

  assert.deepEqual(attempts.map((attempt) => attempt.language || "auto"), ["ar", "multi", "auto", "en", "fa", "he"]);
});

test("normalizes Deepgram utterances into timed subtitle segments", () => {
  const normalized = normalizeDeepgramResponse({
    results: {
      channels: [{
        detected_language: "en",
        language_confidence: 0.97,
        alternatives: [{ transcript: "Can we get a Free Palestine?", confidence: 0.91 }],
      }],
      utterances: [
        { start: 0.5, end: 2.25, transcript: "Can we get a Free Palestine?" },
        { start: 2.35, end: 3.1, transcript: "It doesn't exist." },
      ],
    },
  }, 4000);

  assert.equal(normalized.language, "en");
  assert.equal(normalized.languageConfidence, 0.97);
  assert.equal(normalized.confidence, 0.91);
  assert.equal(normalized.segmentation, "utterances");
  assert.deepEqual(normalized.segments, [
    { id: 1, start: 0.5, end: 2.25, text: "Can we get a Free Palestine?" },
    { id: 2, start: 2.35, end: 3.1, text: "It doesn't exist." },
  ]);
});

test("prefers Deepgram sentence timings over broad utterances", () => {
  const normalized = normalizeDeepgramResponse({
    results: {
      channels: [{
        detected_language: "en",
        language_confidence: 0.97,
        alternatives: [{
          transcript: "Destroy Lebanon. Why are you bombing Beirut?",
          confidence: 0.91,
          paragraphs: {
            paragraphs: [{
              sentences: [
                { start: 0.0, end: 1.35, text: "Destroy Lebanon." },
                { start: 1.36, end: 2.45, text: "Why are you bombing Beirut?" },
              ],
            }],
          },
        }],
      }],
      utterances: [
        { start: 0.0, end: 2.45, transcript: "Destroy Lebanon. Why are you bombing Beirut?" },
      ],
    },
  }, 3000);

  assert.equal(normalized.segmentation, "sentences");
  assert.deepEqual(normalized.segments, [
    { id: 1, start: 0.0, end: 1.35, text: "Destroy Lebanon." },
    { id: 2, start: 1.36, end: 2.45, text: "Why are you bombing Beirut?" },
  ]);
});

test("prefers word-derived timings over broad utterances when sentences are unavailable", () => {
  const normalized = normalizeDeepgramResponse({
    results: {
      channels: [{
        detected_language: "en",
        alternatives: [{
          transcript: "Destroy Lebanon for unclear reasons. Bomb Beirut.",
          words: [
            { start: 0, end: 0.2, word: "Destroy", punctuated_word: "Destroy" },
            { start: 0.2, end: 0.55, word: "Lebanon", punctuated_word: "Lebanon" },
            { start: 0.55, end: 0.8, word: "for", punctuated_word: "for" },
            { start: 0.8, end: 1.2, word: "unclear", punctuated_word: "unclear" },
            { start: 1.2, end: 1.55, word: "reasons", punctuated_word: "reasons." },
            { start: 1.6, end: 1.9, word: "Bomb", punctuated_word: "Bomb" },
            { start: 1.9, end: 2.25, word: "Beirut", punctuated_word: "Beirut." },
          ],
        }],
      }],
      utterances: [
        { start: 0, end: 6.2, transcript: "Destroy Lebanon for unclear reasons. Bomb Beirut." },
      ],
    },
  }, 7000);

  assert.equal(normalized.segmentation, "words");
  assert.deepEqual(normalized.segments, [
    { id: 1, start: 0, end: 2.25, text: "Destroy Lebanon for unclear reasons. Bomb Beirut." },
  ]);
});

test("falls back to Deepgram word timings when utterances are absent", () => {
  const normalized = normalizeDeepgramResponse({
    metadata: { duration: 3 },
    results: {
      channels: [{
        detected_language: "fa",
        alternatives: [{
          transcript: "سلام دنیا",
          confidence: 0.88,
          words: [
            { start: 0, end: 0.4, word: "سلام", punctuated_word: "سلام" },
            { start: 0.45, end: 1, word: "دنیا", punctuated_word: "دنیا" },
          ],
        }],
      }],
    },
  }, 3000);

  assert.equal(normalized.language, "fa");
  assert.equal(normalized.segmentation, "words");
  assert.deepEqual(normalized.segments, [
    { id: 1, start: 0, end: 1, text: "سلام دنیا" },
  ]);
});

test("retries Deepgram with fallback languages when auto-detection returns no transcript", async () => {
  const attemptedLanguages = [];
  const result = await transcribeWithDeepgram({
    apiKey: "dg-key",
    audioPath: "/tmp/audio.mp3",
    model: "nova-3",
    languageFallbacks: ["multi", "en"],
    readFileImpl: async () => Buffer.from("audio"),
    fetchImpl: async (url) => {
      attemptedLanguages.push(url.searchParams.get("language") || "auto");
      if (url.searchParams.get("language") !== "multi") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            results: {
              channels: [{ detected_language: "id", language_confidence: 0.36, alternatives: [{ transcript: "", words: [] }] }],
              utterances: [],
            },
          }),
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({
          results: {
            channels: [{ alternatives: [{ transcript: "Can we get a Free Palestine?", confidence: 0.93 }] }],
            utterances: [{ start: 0, end: 1.2, transcript: "Can we get a Free Palestine?" }],
          },
        }),
      };
    },
  });

  assert.deepEqual(attemptedLanguages, ["auto", "multi"]);
  assert.equal(result.language, "multi");
  assert.equal(result.segments[0].text, "Can we get a Free Palestine?");
});

test("does not send Latin post keyterms to forced Arabic attempts", async () => {
  let requestKeyterms = null;
  const result = await transcribeWithDeepgram({
    apiKey: "dg-key",
    audioPath: "/tmp/audio.mp3",
    model: "nova-3",
    language: "ar",
    detectLanguage: false,
    contextText: [
      "Post context: Israeli IAI Heron drone shot down near Lebanon.",
      "Visual note: The Arabic text appears to be scene/context text and not a watermark.",
    ].join("\n"),
    readFileImpl: async () => Buffer.from("audio"),
    fetchImpl: async (url) => {
      requestKeyterms = url.searchParams.getAll("keyterm");
      return {
        ok: true,
        text: async () => JSON.stringify({
          results: {
            channels: [{
              detected_language: "ar",
              alternatives: [{
                transcript: "تعالوا شوفوا.",
                confidence: 0.96,
                words: [
                  { word: "تعالوا", start: 2.16, end: 2.9, confidence: 0.96 },
                  { word: "شوفوا", start: 2.9, end: 3.5, confidence: 0.96 },
                ],
              }],
            }],
            utterances: [{ start: 2.16, end: 3.5, transcript: "تعالوا شوفوا." }],
          },
        }),
      };
    },
  });

  assert.deepEqual(requestKeyterms, []);
  assert.equal(result.language, "ar");
  assert.equal(result.segments[0].text, "تعالوا شوفوا.");
});

test("visual Arabic hints do not override stronger non-Arabic speech candidates", async () => {
  const attemptedLanguages = [];
  const result = await transcribeWithDeepgram({
    apiKey: "dg-key",
    audioPath: "/tmp/audio.mp3",
    model: "nova-3",
    languageFallbacks: ["multi", "en", "fa", "he", "ar"],
    contextText: [
      "Post context: English field report from Lebanon.",
      "Visual note: The Arabic text appears to be scene/context text and not a watermark.",
    ].join("\n"),
    readFileImpl: async () => Buffer.from("audio"),
    fetchImpl: async (url) => {
      const language = url.searchParams.get("language") || "auto";
      attemptedLanguages.push(language);
      if (language === "ar") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            results: {
              channels: [{
                detected_language: "ar",
                alternatives: [{
                  transcript: "مرحبا مرحبا",
                  confidence: 0.71,
                  words: [
                    { word: "مرحبا", start: 0, end: 0.4, confidence: 0.71 },
                    { word: "مرحبا", start: 0.4, end: 0.8, confidence: 0.71 },
                  ],
                }],
              }],
              utterances: [{ start: 0, end: 0.8, transcript: "مرحبا مرحبا" }],
            },
          }),
        };
      }
      if (language === "multi" || language === "auto") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            results: {
              channels: [{
                detected_language: "en",
                language_confidence: 0.92,
                alternatives: [{
                  transcript: "Look at that drone.",
                  confidence: language === "multi" ? 0.94 : 0.93,
                  words: [
                    { word: "Look", start: 0, end: 0.2, confidence: 0.94 },
                    { word: "at", start: 0.2, end: 0.3, confidence: 0.94 },
                    { word: "that", start: 0.3, end: 0.5, confidence: 0.94 },
                    { word: "drone", start: 0.5, end: 0.9, confidence: 0.94 },
                  ],
                }],
              }],
              utterances: [{ start: 0, end: 0.9, transcript: "Look at that drone." }],
            },
          }),
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({
          results: {
            channels: [{ detected_language: language, alternatives: [{ transcript: "", words: [] }] }],
            utterances: [],
          },
        }),
      };
    },
  });

  assert.deepEqual(attemptedLanguages, ["ar", "multi", "auto", "en", "fa", "he"]);
  assert.equal(result.language, "en");
  assert.equal(result.selectedFromFallbackCandidates, true);
  assert.equal(result.segments[0].text, "Look at that drone.");
});

test("visual Arabic hints still select Arabic when Arabic audio is strongest", async () => {
  const result = await transcribeWithDeepgram({
    apiKey: "dg-key",
    audioPath: "/tmp/audio.mp3",
    model: "nova-3",
    languageFallbacks: ["multi", "en", "fa", "he", "ar"],
    contextText: "Visual note: The Arabic text appears to be scene/context text and not a watermark.",
    readFileImpl: async () => Buffer.from("audio"),
    fetchImpl: async (url) => {
      const language = url.searchParams.get("language") || "auto";
      if (language === "ar") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            results: {
              channels: [{
                detected_language: "ar",
                alternatives: [{
                  transcript: "تعالوا شوفوا.",
                  confidence: 0.99,
                  words: [
                    { word: "تعالوا", start: 0, end: 0.5, confidence: 0.99 },
                    { word: "شوفوا", start: 0.5, end: 1, confidence: 0.99 },
                  ],
                }],
              }],
              utterances: [{ start: 0, end: 1, transcript: "تعالوا شوفوا." }],
            },
          }),
        };
      }
      if (language === "multi") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            results: {
              channels: [{
                detected_language: "en",
                alternatives: [{
                  transcript: "Hi, down, down.",
                  confidence: 0.82,
                  words: [
                    { word: "Hi", start: 0, end: 0.2, confidence: 0.82 },
                    { word: "down", start: 0.2, end: 0.5, confidence: 0.82 },
                    { word: "down", start: 0.5, end: 0.8, confidence: 0.82 },
                  ],
                }],
              }],
              utterances: [{ start: 0, end: 0.8, transcript: "Hi, down, down." }],
            },
          }),
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: "", words: [] }] }] } }),
      };
    },
  });

  assert.equal(result.language, "ar");
  assert.equal(result.selectedFromFallbackCandidates, true);
  assert.equal(result.segments[0].text, "تعالوا شوفوا.");
});
