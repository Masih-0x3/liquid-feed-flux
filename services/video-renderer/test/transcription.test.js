import assert from "node:assert/strict";
import test from "node:test";
import { isLikelyContextMismatchedRepetitiveTranscript, isLikelyNonSpeechDescription, isLikelyRepeatedFillerTranscript, isLikelyRomanizedHebrewTranscript, isSparseContextMismatchedTranscript, isWeakSpeechDetection, shouldRetryWithEnhancedAudio, transcribeAudio } from "../src/transcription.js";
import { transcribeWithEnhancedAudioRetry } from "../src/transcriptionPipeline.js";

function weakDeepgramNoiseResponse() {
  return {
    results: {
      channels: [{
        detected_language: "multi",
        language_confidence: 0,
        alternatives: [{
          transcript: "noise",
          confidence: 0.28,
          words: [{ word: "noise", start: 0.4, end: 0.9, confidence: 0.28 }],
        }],
      }],
      utterances: [{ start: 0.4, end: 0.9, transcript: "noise" }],
    },
  };
}

test("uses Deepgram as the default transcription provider", async () => {
  const calls = [];
  const result = await transcribeAudio({
    audioPath: "/tmp/audio.mp3",
    durationMs: 3000,
    deepgramApiKey: "dg-key",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        text: async () => JSON.stringify({
          results: {
            channels: [{
              detected_language: "en",
              alternatives: [{ transcript: "Free Palestine", confidence: 0.93 }],
            }],
            utterances: [{ start: 0, end: 1.2, transcript: "Free Palestine" }],
          },
        }),
      };
    },
    readFileImpl: async () => Buffer.from("audio"),
  });

  assert.equal(result.provider, "deepgram");
  assert.equal(result.model, "nova-3");
  assert.equal(result.language, "en");
  assert.deepEqual(result.segments, [{ id: 1, start: 0, end: 1.2, text: "Free Palestine" }]);
  assert.equal(calls[0].url.searchParams.get("model"), "nova-3");
});

test("can fall back to OpenAI transcription when explicitly enabled", async () => {
  const result = await transcribeAudio({
    provider: "deepgram",
    fallbackProvider: "openai",
    audioPath: "/tmp/audio.mp3",
    durationMs: 3000,
    deepgramApiKey: "dg-key",
    openaiApiKey: "openai-key",
    fetchImpl: async () => ({ ok: false, status: 429, text: async () => "rate limited" }),
    readFileImpl: async () => Buffer.from("audio"),
    openaiTranscribe: async () => ({
      provider: "openai",
      model: "gpt-4o-transcribe-diarize",
      language: "en",
      segments: [{ id: 1, start: 0, end: 1, text: "fallback" }],
    }),
  });

  assert.equal(result.provider, "openai");
  assert.equal(result.fallback, true);
  assert.match(result.fallbackReason, /Deepgram transcription 429/);
});

test("classifies Deepgram no-transcript responses as no usable speech", async () => {
  const result = await transcribeAudio({
    provider: "deepgram",
    audioPath: "/tmp/audio.mp3",
    durationMs: 3000,
    deepgramApiKey: "dg-key",
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify({
        results: {
          channels: [{ detected_language: "en", alternatives: [{ transcript: "", words: [] }] }],
          utterances: [],
        },
      }),
    }),
    readFileImpl: async () => Buffer.from("audio"),
    openaiTranscribe: async () => {
      throw new Error("should not fall back for no speech");
    },
  });

  assert.equal(result.provider, "deepgram");
  assert.equal(result.model, "nova-3");
  assert.equal(result.noUsableSpeech, true);
  assert.deepEqual(result.segments, []);
  assert.match(result.noUsableSpeechReason, /returned no timed segments/);
});

test("does not fall back from sparse low-information Deepgram fragments to OpenAI speech", async () => {
  let openaiCalled = false;
  const result = await transcribeAudio({
    provider: "deepgram",
    fallbackProvider: "openai",
    audioPath: "/tmp/audio.mp3",
    durationMs: 22033,
    deepgramApiKey: "dg-key",
    openaiApiKey: "openai-key",
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify({
        results: {
          channels: [{
            detected_language: "es",
            language_confidence: 0.42097387,
            alternatives: [{
              transcript: "BNI. Boon.",
              confidence: 0.87320966,
              words: [
                { word: "BNI", start: 4.72, end: 5.52, confidence: 0.62 },
                { word: "Boon", start: 13.571, end: 14.051, confidence: 0.87 },
              ],
            }],
          }],
          utterances: [
            { start: 4.72, end: 5.52, transcript: "BNI." },
            { start: 13.571, end: 14.051, transcript: "Boon." },
          ],
        },
      }),
    }),
    readFileImpl: async () => Buffer.from("audio"),
    openaiTranscribe: async () => {
      openaiCalled = true;
      return {
        model: "gpt-4o-transcribe-diarize",
        language: "he",
        segments: [
          { id: 1, start: 0, end: 1.8, text: "תבחן בי משאלה הנה" },
          { id: 2, start: 1.8, end: 3.5, text: "איפה איפה היא מקרסקה?" },
        ],
      };
    },
  });

  assert.equal(openaiCalled, false);
  assert.equal(result.provider, "deepgram");
  assert.equal(result.noUsableSpeech, true);
  assert.deepEqual(result.segments, []);
  assert.match(result.noUsableSpeechReason, /weak low-confidence/);
  assert.equal(result.rejectedSegments.length, 2);
});

test("rejects descriptive OpenAI fallback captions instead of burning fake subtitles", async () => {
  const result = await transcribeAudio({
    provider: "deepgram",
    fallbackProvider: "openai",
    audioPath: "/tmp/audio.mp3",
    durationMs: 15335,
    deepgramApiKey: "dg-key",
    openaiApiKey: "openai-key",
    fetchImpl: async () => ({ ok: false, status: 503, text: async () => "temporary outage" }),
    readFileImpl: async () => Buffer.from("audio"),
    openaiTranscribe: async () => ({
      model: "whisper-1",
      language: "en",
      segments: [{
        id: 1,
        start: 0,
        end: 11.86,
        text: "Multiple players chanting the same word, Argentine for the victory.",
      }],
    }),
  });

  assert.equal(result.provider, "openai");
  assert.equal(result.noUsableSpeech, true);
  assert.deepEqual(result.segments, []);
  assert.match(result.noUsableSpeechReason, /OpenAI fallback produced no usable speech/);
  assert.equal(isLikelyNonSpeechDescription({
    segments: [{ id: 1, start: 0, end: 11.86, text: "Multiple players chanting the same word." }],
  }), true);
  assert.equal(isLikelyNonSpeechDescription({
    segments: [{ id: 1, start: 0, end: 14.36, text: "SPEAKERS CHANTING" }],
  }), true);
});

test("rejects repetitive fallback gibberish when it does not match post context", async () => {
  const result = await transcribeAudio({
    provider: "deepgram",
    fallbackProvider: "openai",
    audioPath: "/tmp/audio.mp3",
    durationMs: 15335,
    deepgramApiKey: "dg-key",
    openaiApiKey: "openai-key",
    contextText: "Post context:\nPost: Demonstrators chanted Ghalibaf, Araghchi, resign, resign.",
    fetchImpl: async () => ({ ok: false, status: 503, text: async () => "temporary outage" }),
    readFileImpl: async () => Buffer.from("audio"),
    openaiTranscribe: async () => ({
      model: "gpt-4o-transcribe-diarize",
      language: "en",
      segments: [
        { id: 1, start: 0.25, end: 1.6, text: "HS, HS," },
        { id: 2, start: 1.7, end: 3.25, text: "HS, olivar," },
        { id: 3, start: 3.3, end: 4.7, text: "a la fin, HS," },
        { id: 4, start: 6.3, end: 8.2, text: "olivar, a la fin," },
      ],
    }),
  });

  assert.equal(result.noUsableSpeech, true);
  assert.deepEqual(result.segments, []);
  assert.match(result.noUsableSpeechReason, /OpenAI fallback produced no usable speech/);
  assert.equal(isLikelyContextMismatchedRepetitiveTranscript({
    segments: [
      { id: 1, start: 0, end: 1, text: "HS, HS, olivar, a la fin, HS, olivar, a la fin." },
    ],
  }, "Post: Demonstrators chanted Ghalibaf, Araghchi, resign."), true);
  assert.equal(isLikelyContextMismatchedRepetitiveTranscript({
    segments: [
      { id: 1, start: 0, end: 1, text: "Araghchi, resign. Araghchi, resign. Araghchi, resign." },
    ],
  }, "Post: Demonstrators chanted Ghalibaf, Araghchi, resign."), false);
});

test("rejects sparse fallback phrases that do not match post context", async () => {
  const result = await transcribeAudio({
    provider: "deepgram",
    fallbackProvider: "openai",
    audioPath: "/tmp/audio.mp3",
    durationMs: 15335,
    deepgramApiKey: "dg-key",
    openaiApiKey: "openai-key",
    contextText: "Post context:\nPost: Demonstrators chanted Ghalibaf, Araghchi, resign, resign.",
    fetchImpl: async () => ({ ok: false, status: 503, text: async () => "temporary outage" }),
    readFileImpl: async () => Buffer.from("audio"),
    openaiTranscribe: async () => ({
      model: "gpt-4o-transcribe-diarize",
      language: "en",
      segments: [{ id: 1, start: 0, end: 2.2, text: "Este é o nosso..." }],
    }),
  });

  assert.equal(result.noUsableSpeech, true);
  assert.deepEqual(result.segments, []);
  assert.equal(isSparseContextMismatchedTranscript({
    segments: [{ id: 1, start: 0, end: 2.2, text: "Este é o nosso..." }],
  }, {
    durationMs: 15335,
    contextText: "Post: Demonstrators chanted Ghalibaf, Araghchi, resign.",
  }), true);
  assert.equal(isSparseContextMismatchedTranscript({
    segments: [{ id: 1, start: 0, end: 4.1, text: "Et c'est pas, et c'est pas, sans arriver, à la fille." }],
  }, {
    durationMs: 15335,
    contextText: "Post: Demonstrators chanted Ghalibaf, Araghchi, resign.",
  }), true);
  assert.equal(isSparseContextMismatchedTranscript({
    segments: [{ id: 1, start: 0, end: 1.1, text: "uh huh" }],
  }, {
    durationMs: 12000,
    contextText: "Post: Unrelated context.",
  }), false);
});

test("rejects generic OpenAI outro captions after Deepgram API failure", async () => {
  const result = await transcribeAudio({
    provider: "deepgram",
    fallbackProvider: "openai",
    audioPath: "/tmp/audio.mp3",
    durationMs: 27567,
    deepgramApiKey: "dg-key",
    openaiApiKey: "openai-key",
    contextText: "Post context:\nPost: Security camera footage from Gaza.",
    fetchImpl: async () => ({ ok: false, status: 503, text: async () => "temporary outage" }),
    readFileImpl: async () => Buffer.from("audio"),
    openaiTranscribe: async () => ({
      model: "whisper-1",
      language: "en",
      segments: [{ id: 1, start: 0, end: 27.56, text: "Thank you for watching!" }],
    }),
  });

  assert.equal(result.noUsableSpeech, true);
  assert.deepEqual(result.segments, []);
  assert.match(result.noUsableSpeechReason, /OpenAI fallback produced no usable speech/);
});

test("does not invoke OpenAI fallback after Deepgram finds no timed speech", async () => {
  const result = await transcribeAudio({
    provider: "deepgram",
    fallbackProvider: "openai",
    audioPath: "/tmp/audio.mp3",
    durationMs: 88345,
    deepgramApiKey: "dg-key",
    openaiApiKey: "openai-key",
    contextText: "Post context:\nPost: convoy driving on a road near a town.",
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify({
        results: {
          channels: [{ detected_language: "und", alternatives: [{ transcript: "", words: [] }] }],
          utterances: [],
        },
      }),
    }),
    readFileImpl: async () => Buffer.from("audio"),
    openaiTranscribe: async () => {
      throw new Error("OpenAI fallback should not run after Deepgram finds no timed speech");
    },
  });

  assert.equal(result.provider, "deepgram");
  assert.equal(result.noUsableSpeech, true);
  assert.deepEqual(result.segments, []);
  assert.match(result.noUsableSpeechReason, /returned no timed segments/);
});

test("enhanced audio retry fires only after empty or weak Deepgram output", async () => {
  assert.equal(shouldRetryWithEnhancedAudio({
    provider: "deepgram",
    noUsableSpeech: true,
    noUsableSpeechReason: "Deepgram transcription returned no timed segments",
    segments: [],
  }), true);
  assert.equal(shouldRetryWithEnhancedAudio({
    provider: "deepgram",
    language: "en",
    segments: [{ id: 1, start: 0, end: 1, text: "How are you?" }],
  }), false);

  const extracted = [];
  const calls = [];
  const result = await transcribeWithEnhancedAudioRetry({
    inputPath: "/tmp/source.mp4",
    audioPath: "/tmp/audio.mp3",
    enhancedAudioPath: "/tmp/audio.enhanced.mp3",
    runEnhancedAudioExtract: async (command) => extracted.push(command.args.at(-1)),
    runTranscription: async (options, label) => {
      calls.push({ audioPath: options.audioPath, label });
      if (label === "transcription") {
        return {
          provider: "deepgram",
          noUsableSpeech: true,
          noUsableSpeechReason: "Deepgram transcription returned no timed segments",
          segments: [],
        };
      }
      return {
        provider: "deepgram",
        model: "nova-3",
        language: "multi",
        confidence: 0.98,
        segments: [{ id: 1, start: 12.4, end: 13.44, text: "How are" }],
      };
    },
  });

  assert.deepEqual(extracted, ["/tmp/audio.enhanced.mp3"]);
  assert.deepEqual(calls.map((call) => call.label), ["transcription", "transcription_enhanced"]);
  assert.equal(result.enhancedAudioRetry, true);
  assert.match(result.enhancedAudioRetryReason, /returned no timed segments/);
  assert.deepEqual(result.segments, [{ id: 1, start: 12.4, end: 13.44, text: "How are" }]);
});

test("enhanced audio retry after no timed speech does not reuse OpenAI fallback", async () => {
  const calls = [];
  const result = await transcribeWithEnhancedAudioRetry({
    inputPath: "/tmp/source.mp4",
    audioPath: "/tmp/audio.mp3",
    enhancedAudioPath: "/tmp/audio.enhanced.mp3",
    runEnhancedAudioExtract: async () => {},
    runTranscription: async (options, label) => {
      calls.push({ label, fallbackProvider: options.fallbackProvider });
      return {
        provider: "deepgram",
        model: "nova-3",
        noUsableSpeech: true,
        noUsableSpeechReason: "Deepgram transcription returned no timed segments",
        segments: [],
      };
    },
    transcriptionOptions: {
      provider: "deepgram",
      fallbackProvider: "openai",
    },
  });

  assert.deepEqual(calls, [
    { label: "transcription", fallbackProvider: "openai" },
    { label: "transcription_enhanced", fallbackProvider: "" },
  ]);
  assert.equal(result.noUsableSpeech, true);
  assert.deepEqual(result.segments, []);
});

test("early transcript rescue prepends missed opening speech before a late first cue", async () => {
  const extracted = [];
  const calls = [];
  const result = await transcribeWithEnhancedAudioRetry({
    inputPath: "/tmp/source.mp4",
    audioPath: "/tmp/audio.mp3",
    earlyAudioPath: "/tmp/audio.early.mp3",
    earlyTranscriptMinFirstCueStartSeconds: 8,
    earlyTranscriptWindowSeconds: 14,
    runEarlyAudioExtract: async (command) => extracted.push(command.args),
    runTranscription: async (options, label) => {
      calls.push({ audioPath: options.audioPath, label, language: options.deepgramLanguage });
      if (label === "transcription") {
        return {
          provider: "deepgram",
          model: "nova-3",
          language: "en",
          confidence: 0.98,
          segments: [
            { id: 1, start: 13.5, end: 14.1, text: "Yes." },
            { id: 2, start: 15.6, end: 18.5, text: "They were." },
          ],
        };
      }
      return {
        provider: "deepgram",
        model: "nova-3",
        language: "en",
        confidence: 0.99,
        segments: [{
          id: 1,
          start: 0.32,
          end: 12.64,
          text: "Depends on whether you care what happens to the Palestinians.",
        }],
      };
    },
    transcriptionOptions: {
      provider: "deepgram",
      deepgramLanguageFallbacks: ["multi", "en", "fa"],
    },
  });

  assert.equal(extracted.length, 1);
  assert.ok(extracted[0].includes("/tmp/audio.early.mp3"));
  assert.deepEqual(calls.map((call) => call.label), ["transcription", "transcription_early"]);
  assert.equal(calls[1].language, "en");
  assert.equal(result.earlyTranscriptRescue, true);
  assert.equal(result.earlyTranscriptRescueSegmentCount, 1);
  assert.equal(result.segments.length, 3);
  assert.deepEqual(result.segments.map((segment) => segment.id), [1, 2, 3]);
  assert.equal(result.segments[0].start, 0.32);
  assert.match(result.segments[0].text, /Palestinians/);
});

test("early transcript rescue is skipped when the first cue is already near the beginning", async () => {
  let extracted = false;
  const result = await transcribeWithEnhancedAudioRetry({
    inputPath: "/tmp/source.mp4",
    audioPath: "/tmp/audio.mp3",
    earlyAudioPath: "/tmp/audio.early.mp3",
    runEarlyAudioExtract: async () => { extracted = true; },
    runTranscription: async () => ({
      provider: "deepgram",
      model: "nova-3",
      language: "en",
      confidence: 0.98,
      segments: [{ id: 1, start: 1.2, end: 3.4, text: "Already covered." }],
    }),
  });

  assert.equal(extracted, false);
  assert.equal(result.earlyTranscriptRescue, undefined);
  assert.deepEqual(result.segments, [{ id: 1, start: 1.2, end: 3.4, text: "Already covered." }]);
});

test("rejects short low-confidence multilingual noise as no usable speech", async () => {
  const result = await transcribeAudio({
    provider: "deepgram",
    audioPath: "/tmp/audio.mp3",
    durationMs: 12567,
    deepgramApiKey: "dg-key",
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify({
        results: {
          channels: [{
            detected_language: "multi",
            language_confidence: 0,
            alternatives: [{
              transcript: "Skillers de pois, no.",
              confidence: 0.54833984,
              words: [
                { word: "skillers", start: 6.4, end: 7.04, confidence: 0.38643393 },
                { word: "de", start: 7.04, end: 7.28, confidence: 0.54833984 },
                { word: "pois", start: 7.28, end: 7.68, confidence: 0.14581299 },
                { word: "no", start: 7.68, end: 8.08, confidence: 0.6119385 },
              ],
            }],
          }],
          utterances: [{ start: 6.4, end: 8.08, transcript: "Skillers de pois, no." }],
        },
      }),
    }),
    readFileImpl: async () => Buffer.from("audio"),
  });

  assert.equal(result.provider, "deepgram");
  assert.equal(result.noUsableSpeech, true);
  assert.deepEqual(result.segments, []);
  assert.deepEqual(result.rejectedSegments, [{ id: 1, start: 6.4, end: 8.08, text: "Skillers de pois, no." }]);
  assert.match(result.noUsableSpeechReason, /weak low-confidence/);
});

test("continues after weak multilingual noise and selects stronger Persian fallback", async () => {
  const attemptedLanguages = [];
  const result = await transcribeAudio({
    provider: "deepgram",
    audioPath: "/tmp/audio.mp3",
    durationMs: 12567,
    deepgramApiKey: "dg-key",
    deepgramLanguageFallbacks: ["multi", "en", "fa"],
    fetchImpl: async (url) => {
      const language = url.searchParams.get("language") || "auto";
      attemptedLanguages.push(language);
      if (language === "auto") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            results: {
              channels: [{ detected_language: "und", alternatives: [{ transcript: "", words: [] }] }],
              utterances: [],
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
                detected_language: "multi",
                language_confidence: 0,
                alternatives: [{
                  transcript: "Skillers de pois, no.",
                  confidence: 0.54833984,
                  words: [
                    { word: "skillers", start: 6.4, end: 7.04, confidence: 0.38643393 },
                    { word: "de", start: 7.04, end: 7.28, confidence: 0.54833984 },
                    { word: "pois", start: 7.28, end: 7.68, confidence: 0.14581299 },
                    { word: "no", start: 7.68, end: 8.08, confidence: 0.6119385 },
                  ],
                }],
              }],
              utterances: [{ start: 6.4, end: 8.08, transcript: "Skillers de pois, no." }],
            },
          }),
        };
      }
      if (language === "en") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            results: {
              channels: [{
                detected_language: "en",
                language_confidence: 0,
                alternatives: [{
                  transcript: "Can you hear the voice mail?",
                  confidence: 0.78271484,
                  words: [
                    { word: "can", start: 6.32, end: 6.64, confidence: 0.73339844 },
                    { word: "you", start: 6.64, end: 6.8, confidence: 0.8647461 },
                    { word: "hear", start: 6.8, end: 7.04, confidence: 0.75634766 },
                    { word: "the", start: 7.04, end: 7.28, confidence: 0.9707031 },
                    { word: "voice", start: 7.28, end: 7.6, confidence: 0.78271484 },
                    { word: "mail", start: 7.6, end: 7.84, confidence: 0.5891113 },
                  ],
                }],
              }],
              utterances: [{ start: 6.32, end: 7.84, transcript: "Can you hear the voice mail?" }],
            },
          }),
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({
          results: {
            channels: [{
              detected_language: "fa",
              language_confidence: 0,
              alternatives: [{
                transcript: "خیلی ارتفاعش پایینه ها.",
                confidence: 0.98828125,
                words: [
                  { word: "خیلی", start: 6.48, end: 6.8, confidence: 0.98828125 },
                  { word: "ارتفاعش", start: 6.8, end: 7.44, confidence: 0.99121094 },
                  { word: "پایینه", start: 7.44, end: 8.08, confidence: 0.78222656 },
                  { word: "ها", start: 8.08, end: 8.32, confidence: 0.7314453 },
                ],
              }],
            }],
            utterances: [{ start: 6.48, end: 8.32, transcript: "خیلی ارتفاعش پایینه ها." }],
          },
        }),
      };
    },
    readFileImpl: async () => Buffer.from("audio"),
  });

  assert.deepEqual(attemptedLanguages, ["auto", "multi", "en", "fa"]);
  assert.equal(result.language, "fa");
  assert.equal(result.selectedFromFallbackCandidates, true);
  assert.equal(result.targetLanguage, undefined);
  assert.deepEqual(result.segments, [{ id: 1, start: 6.48, end: 8.32, text: "خیلی ارتفاعش پایینه ها." }]);
});

test("continues after romanized Hebrew and selects explicit Hebrew fallback", async () => {
  const attemptedLanguages = [];
  const result = await transcribeAudio({
    provider: "deepgram",
    audioPath: "/tmp/audio.mp3",
    durationMs: 79784,
    deepgramApiKey: "dg-key",
    deepgramLanguageFallbacks: ["multi", "en", "he"],
    contextText: "Post context: Defense Minister, Israel Katz speaks about Iran and the IDF.",
    fetchImpl: async (url) => {
      const language = url.searchParams.get("language") || "auto";
      attemptedLanguages.push(language);
      if (language === "he") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            results: {
              channels: [{
                detected_language: "he",
                alternatives: [{
                  transcript: "המזרח התיכון משתנה לנגד עינינו.",
                  confidence: 0.97998047,
                  words: [
                    { word: "המזרח", start: 0.88, end: 1.2, confidence: 0.98 },
                    { word: "התיכון", start: 1.2, end: 1.6, confidence: 0.97 },
                  ],
                }],
              }],
              utterances: [{ start: 0.88, end: 4.32, transcript: "המזרח התיכון משתנה לנגד עינינו." }],
            },
          }),
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({
          results: {
            channels: [{
              detected_language: language === "auto" ? "en" : language,
              alternatives: [{
                transcript: "Biahmi melo mama sha nak nu rohim, begavar aba, neged irguna terrokh Hizbullah shepuel bislihut ha-mishtara ha-irani.",
                confidence: 0.77,
              }],
            }],
            utterances: [{
              start: 4.16,
              end: 17.685,
              transcript: "Biahmi melo mama sha nak nu rohim, begavar aba, neged irguna terrokh Hizbullah shepuel bislihut ha-mishtara ha-irani.",
            }],
          },
        }),
      };
    },
    readFileImpl: async () => Buffer.from("audio"),
  });

  assert.deepEqual(attemptedLanguages, ["multi", "auto", "en", "he"]);
  assert.equal(result.language, "he");
  assert.equal(result.selectedFromFallbackCandidates, true);
  assert.deepEqual(result.segments, [{ id: 1, start: 0.88, end: 4.32, text: "המזרח התיכון משתנה לנגד עינינו." }]);
});

test("rejects repeated filler transcript and selects Arabic fallback", async () => {
  const attemptedLanguages = [];
  const result = await transcribeAudio({
    provider: "deepgram",
    audioPath: "/tmp/audio.mp3",
    durationMs: 5072,
    deepgramApiKey: "dg-key",
    deepgramLanguageFallbacks: ["multi", "en", "fa", "he", "ar"],
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
                  transcript: "تم إسقاط الطائرة.",
                  confidence: 0.92,
                  words: [
                    { word: "تم", start: 1.1, end: 1.3, confidence: 0.91 },
                    { word: "إسقاط", start: 1.3, end: 1.8, confidence: 0.92 },
                    { word: "الطائرة", start: 1.8, end: 2.4, confidence: 0.93 },
                  ],
                }],
              }],
              utterances: [{ start: 1.1, end: 2.4, transcript: "تم إسقاط الطائرة." }],
            },
          }),
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({
          results: {
            channels: [{
              detected_language: "fa",
              alternatives: [{
                transcript: "و هی هی هی هی هی هی",
                confidence: 0.97,
                words: [
                  { word: "و", start: 2.08, end: 2.18, confidence: 0.9 },
                  { word: "هی", start: 2.18, end: 2.5, confidence: 0.9 },
                  { word: "هی", start: 2.5, end: 2.8, confidence: 0.9 },
                  { word: "هی", start: 2.8, end: 3.1, confidence: 0.9 },
                  { word: "هی", start: 3.1, end: 3.4, confidence: 0.9 },
                  { word: "هی", start: 3.4, end: 3.7, confidence: 0.9 },
                ],
              }],
            }],
            utterances: [{ start: 2.08, end: 3.7, transcript: "و هی هی هی هی هی هی" }],
          },
        }),
      };
    },
    readFileImpl: async () => Buffer.from("audio"),
  });

  assert.deepEqual(attemptedLanguages, ["auto", "multi", "en", "fa", "he", "ar"]);
  assert.equal(result.language, "ar");
  assert.equal(result.selectedFromFallbackCandidates, true);
  assert.deepEqual(result.segments, [{ id: 1, start: 1.1, end: 2.4, text: "تم إسقاط الطائرة." }]);
  assert.equal(isLikelyRepeatedFillerTranscript({
    language: "fa",
    segments: [{ id: 1, start: 2.08, end: 5.33, text: "و هی هی هی هی هی هی" }],
  }), true);
});

test("rejects non-speech music captions while searching fallbacks", async () => {
  const attemptedLanguages = [];
  const result = await transcribeAudio({
    provider: "deepgram",
    audioPath: "/tmp/audio.mp3",
    durationMs: 5387,
    deepgramApiKey: "dg-key",
    deepgramLanguageFallbacks: ["multi", "en", "fa", "he", "ar"],
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
      }
      if (language === "he") {
        return {
          ok: true,
          text: async () => JSON.stringify({
            results: {
              channels: [{
                detected_language: "he",
                alternatives: [{
                  transcript: "*מנגינה*",
                  confidence: 0.66,
                  words: [{ word: "מנגינה", start: 2.16, end: 5.3, confidence: 0.66 }],
                }],
              }],
              utterances: [{ start: 2.16, end: 5.3, transcript: "*מנגינה*" }],
            },
          }),
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: "", confidence: 0 }] }] } }),
      };
    },
    readFileImpl: async () => Buffer.from("audio"),
  });

  assert.deepEqual(attemptedLanguages, ["auto", "multi", "en", "fa", "he", "ar"]);
  assert.equal(result.language, "ar");
  assert.equal(result.selectedFromFallbackCandidates, true);
  assert.deepEqual(result.segments, [{ id: 1, start: 2.16, end: 3.5, text: "تعالوا شوفوا." }]);
});

test("detects romanized Hebrew transcripts only when Hebrew fallback is available", () => {
  const candidate = {
    language: "en",
    segments: [{
      id: 1,
      start: 0,
      end: 4,
      text: "Biahmi melo mama sha nak nu rohim, neged irguna terrokh Hizbullah shepuel bislihut ha-mishtara ha-irani.",
    }],
  };

  assert.equal(isLikelyRomanizedHebrewTranscript(candidate, {
    deepgramLanguageFallbacks: ["multi", "en", "he"],
    contextText: "Defense Minister, Israel Katz speaks.",
  }), true);
  assert.equal(isLikelyRomanizedHebrewTranscript(candidate, {
    deepgramLanguageFallbacks: ["multi", "en"],
    contextText: "Defense Minister, Israel Katz speaks.",
  }), false);
  assert.equal(isLikelyRomanizedHebrewTranscript({
    language: "en",
    segments: [{ id: 1, start: 0, end: 4, text: "The IDF is prepared to strike Iran with great force." }],
  }, {
    deepgramLanguageFallbacks: ["multi", "en", "he"],
    contextText: "Defense Minister, Israel Katz speaks.",
  }), false);
});

test("keeps short confident utterances so tiny real speech still gets subtitles", () => {
  assert.equal(isLikelyRepeatedFillerTranscript({
    language: "en",
    segments: [{ id: 1, start: 4.2, end: 5.1, text: "uh huh" }],
  }), false);
  assert.equal(isWeakSpeechDetection({
    language: "en",
    languageConfidence: 0.98,
    confidence: 0.94,
    raw: {
      results: {
        channels: [{
          alternatives: [{
            words: [
              { word: "uh", confidence: 0.93 },
              { word: "huh", confidence: 0.95 },
            ],
          }],
        }],
      },
    },
    segments: [{ id: 1, start: 4.2, end: 5.1, text: "uh huh" }],
  }, { durationMs: 12000 }), false);
});
