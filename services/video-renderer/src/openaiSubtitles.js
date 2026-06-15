import { validateTranslatedSegments } from "./subtitles.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export function normalizedLanguage(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (["fa", "fas", "per", "farsi", "persian", "فارسی"].includes(raw)) return "fa";
  if (["he", "heb", "hebrew", "עברית"].includes(raw)) return "he";
  if (["ar", "ara", "arabic", "العربية"].includes(raw)) return "ar";
  if (["en", "eng", "english"].includes(raw)) return "en";
  return raw.slice(0, 12);
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part.text === "string") return part.text;
      if (typeof part?.text === "string") return part.text;
    }
  }
  return "";
}

function targetLanguageName(targetLanguage) {
  return targetLanguage === "en" ? "English" : "Persian";
}

function sourceLanguageName(sourceLanguage) {
  const normalized = normalizedLanguage(sourceLanguage) || "und";
  if (normalized === "fa") return "Persian";
  if (normalized === "he") return "Hebrew";
  if (normalized === "ar") return "Arabic";
  if (normalized === "en") return "English";
  return "the source language";
}

function compactContextText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 1600);
}

function subtitleSegmentsJsonSchema(name) {
  return {
    type: "json_schema",
    name,
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        segments: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "number" },
              start: { type: "number" },
              end: { type: "number" },
              text: { type: "string" },
            },
            required: ["id", "start", "end", "text"],
          },
        },
      },
      required: ["segments"],
    },
  };
}

export function buildTranscriptCleanupRequest({ model, segments, sourceLanguage = "und", contextText = "" }) {
  const normalizedSource = normalizedLanguage(sourceLanguage) || "und";
  const languageName = sourceLanguageName(normalizedSource);
  const context = compactContextText(contextText);
  return {
    model,
    temperature: 0,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              `You clean the source-language subtitle transcript in ${languageName}.`,
              "Return strict JSON only.",
              "Do not translate.",
              "Keep the same cue ids and exact timings.",
              "Fix only obvious speech-to-text mistakes, broken punctuation, casing, names, slogans, chants, and quoted phrases.",
              "Use the provided context to correct noisy recognition, but do not add anything that was not spoken.",
              "If context or audio text points to \"Free Palestine\", never rewrite it as a near-sounding phrase like \"free pasta\" or \"free concert\".",
              "If context points to Jerry Seinfeld, correct obvious variants such as \"S ten\" or \"S10\" only when the cue clearly refers to that name.",
              "For protest/crowd chants, repeated official or politician names may be followed by a short demand such as \"resign\". If the cue is a protest chant and the recognized text has collapsed the demand into repeated names, restore the spoken demand, e.g. \"Araghchi, resign\" instead of a bare name loop. Do not add resignation language unless the source cue is a protest chant and the audio/context clearly supports that demand.",
              normalizedSource === "he" ? "For Hebrew political or military speech, fix obvious near-sounding recognition errors only when grammar and context make the intended phrase clear; for example צהל or פסל can be צה\"ל, מלאכה תמא can be מלאכה תמה, and מניסיוני לקשור בין הזירות can be ואת ניסיונותיה לקשור בין הזירות when discussing Iran linking fronts." : "",
              normalizedSource === "he" ? "Apply those Hebrew fixes even when the misrecognized phrase is split across adjacent short cues; preserve cue boundaries by correcting the cue text in place, e.g. a standalone מניסיוני followed by לקשור בין הזירות should become ואת ניסיונותיה followed by לקשור בין הזירות." : "",
              "Remove isolated repeated fragments only when they are clearly duplicated from a neighboring cue, such as a standalone \"Up?\" immediately after \"What up\".",
              "Keep each cue short enough for subtitles; do not merge or split cues.",
            ].filter(Boolean).join(" "),
          },
        ],
      },
      {
        role: "user",
        content: [{
          type: "input_text",
          text: JSON.stringify({ source_language: normalizedSource, context_text: context, segments }),
        }],
      },
    ],
    text: {
      format: subtitleSegmentsJsonSchema("cleaned_transcript_segments"),
    },
  };
}

export function buildTranslationRequest({ model, segments, targetLanguage = "fa", contextText = "" }) {
  const normalizedTarget = targetLanguage === "en" ? "en" : "fa";
  const targetName = targetLanguageName(normalizedTarget);
  const context = compactContextText(contextText);
  return {
    model,
    temperature: 0,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              `Translate subtitle cues into natural ${targetName}.`,
              "Return strict JSON only.",
              "Keep the same cue ids and exact timings.",
              "Translate each cue independently: cue N must contain only meaning from source cue N.",
              "Never move a sentence, phrase, or idea into an adjacent cue, even if that would read more smoothly.",
              `Each cue must be readable, at most two ${targetName} subtitle lines.`,
              "Preserve the meaning of quoted slogans, political phrases, named people, places, organizations, and common chants; do not substitute unrelated near-sounding words.",
              "Use provided source context only to correct obvious noisy-transcription mistakes in names, slogans, or quoted phrases; do not add context that was not spoken.",
              "Example: if source context says \"Free Palestine\", do not translate a noisy cue as \"free concert\".",
              normalizedTarget === "fa" ? "Use concise, spoken Persian fit for burned-in subtitles; avoid stiff literal Persian and do not over-explain." : "",
              normalizedTarget === "fa" ? "Make the Persian flow as natural subtitles, not word-for-word fragments; do not start a cue with a comma, punctuation mark, or awkward dangling connector when the idea can be phrased cleanly." : "",
              normalizedTarget === "fa" ? "For Persian output, translate English slogans semantically instead of transliterating them; render \"Free Palestine\" as \"فلسطین آزاد\" or \"فلسطین را آزاد کنید\", never \"فری فلسطین\"." : "",
              normalizedTarget === "fa" ? "For a cue like \"Can we get a Free Palestine?\", prefer a natural subtitle such as \"یه «فلسطین آزاد» می‌گی؟\" over a literal phrasing like \"می‌تونیم یه فلسطین آزاد داشته باشیم؟\"." : "",
              normalizedTarget === "fa" ? "For an English cue like \"Give me one Free Palestine\", treat \"give me one\" as asking someone to say or chant the slogan; prefer \"یه «فلسطین آزاد» بگو\" over \"بده\"." : "",
              normalizedTarget === "fa" ? "For resignation chants like \"Araghchi, resign\" or \"Ghalibaf, resign\", use short natural Persian chant wording such as \"عراقچی، استعفا\". For repeated chants like \"Araghchi, resign, resign\", prefer \"عراقچی، استعفا، استعفا\" over longer phrases like \"استعفا بده\" so narrow videos stay readable; do not output only the repeated name." : "",
              normalizedTarget === "fa" ? "Do not invent greetings such as \"سلام\"; translate \"what up\" or \"what's up\" as \"چه خبر\" or \"چطوری\" only when that greeting is actually in the source cue." : "",
              "Do not add source-language text.",
            ].filter(Boolean).join(" "),
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify({ target_language: normalizedTarget, context_text: context, segments }) }],
      },
    ],
    text: {
      format: subtitleSegmentsJsonSchema("translated_subtitle_segments"),
    },
  };
}

export function buildTranslationRepairRequest({
  model,
  sourceSegments,
  draftSegments,
  targetLanguage = "fa",
  contextText = "",
  errorMessage = "",
}) {
  const normalizedTarget = targetLanguage === "en" ? "en" : "fa";
  const targetName = targetLanguageName(normalizedTarget);
  const context = compactContextText(contextText);
  return {
    model,
    temperature: 0,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              `Repair an invalid ${targetName} subtitle translation.`,
              "Return strict JSON only.",
              "Use the source cues to fill any empty, punctuation-only, or malformed translated cue.",
              "Keep the same cue ids and exact timings from source_segments.",
              "Do not merge, split, drop, or reorder cues.",
              "Every output text must be non-empty and readable.",
              normalizedTarget === "fa" ? "For Persian, make short natural subtitle phrases and do not start a cue with punctuation." : "",
            ].filter(Boolean).join(" "),
          },
        ],
      },
      {
        role: "user",
        content: [{
          type: "input_text",
          text: JSON.stringify({
            target_language: normalizedTarget,
            context_text: context,
            validation_error: String(errorMessage ?? ""),
            source_segments: sourceSegments,
            draft_translated_segments: draftSegments,
          }),
        }],
      },
    ],
    text: {
      format: subtitleSegmentsJsonSchema("repaired_translated_subtitle_segments"),
    },
  };
}

function parseSubtitleSegmentsResponse(payload, label) {
  const outputText = extractOutputText(payload);
  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new Error(`${label} JSON parse failed: ${error.message}; output=${outputText.slice(0, 300)}`);
  }
  return parsed;
}

async function readJsonResponse(response, fallbackKey = "output_text") {
  const rawText = await response.text();
  try {
    return { rawText, payload: JSON.parse(rawText) };
  } catch {
    return { rawText, payload: { [fallbackKey]: rawText } };
  }
}

export async function cleanupTranscriptSegments({
  apiKey,
  model,
  segments,
  sourceLanguage = "und",
  contextText = "",
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildTranscriptCleanupRequest({ model, segments, sourceLanguage, contextText })),
  });

  const { rawText, payload } = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`OpenAI transcript cleanup ${response.status}: ${rawText.slice(0, 500)}`);
  }

  const parsed = parseSubtitleSegmentsResponse(payload, "transcript cleanup");
  const cleaned = validateTranslatedSegments(segments, parsed.segments);
  return { model, raw: payload, segments: cleaned };
}

export async function translateSegments({ apiKey, model, segments, targetLanguage = "fa", contextText = "", fetchImpl = fetch }) {
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildTranslationRequest({ model, segments, targetLanguage, contextText })),
  });

  const { rawText, payload } = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`OpenAI translation ${response.status}: ${rawText.slice(0, 500)}`);
  }

  const parsed = parseSubtitleSegmentsResponse(payload, "translation");
  try {
    const translated = validateTranslatedSegments(segments, parsed.segments);
    return { model, raw: payload, segments: translated };
  } catch (error) {
    const repairResponse = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildTranslationRepairRequest({
        model,
        sourceSegments: segments,
        draftSegments: parsed.segments,
        targetLanguage,
        contextText,
        errorMessage: error instanceof Error ? error.message : String(error),
      })),
    });
    const { rawText: repairRawText, payload: repairPayload } = await readJsonResponse(repairResponse);
    if (!repairResponse.ok) {
      throw new Error(`OpenAI translation repair ${repairResponse.status}: ${repairRawText.slice(0, 500)}`);
    }
    const repairedParsed = parseSubtitleSegmentsResponse(repairPayload, "translation repair");
    const repaired = validateTranslatedSegments(segments, repairedParsed.segments);
    return {
      model,
      raw: { initial: payload, repair: repairPayload },
      segments: repaired,
      repaired: true,
      repairReason: error instanceof Error ? error.message : String(error),
    };
  }
}
