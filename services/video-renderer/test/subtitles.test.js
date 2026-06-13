import assert from "node:assert/strict";
import test from "node:test";
import {
  hasUsableSubtitleText,
  resolveSubtitleMarginV,
  sanitizeSubtitleSegments,
  segmentsToAss,
  segmentsToSrt,
  splitLongSubtitleSegments,
  validateTranslatedSegments,
  wrapCue,
} from "../src/subtitles.js";

test("validates translated Persian segments keep ids and timings", () => {
  const source = [
    { id: 1, start: 0, end: 1.5, text: "Hello world" },
    { id: 2, start: 1.5, end: 3, text: "Second line" },
  ];
  const translated = [
    { id: 1, start: 0, end: 1.5, text: "سلام دنیا" },
    { id: 2, start: 1.5, end: 3, text: "خط دوم" },
  ];

  assert.deepEqual(validateTranslatedSegments(source, translated), translated);
});

test("translated segment timing drift is snapped back to source timing by default", () => {
  const source = [{ id: 1, start: 10.12, end: 12.34, text: "Hello" }];
  const translated = [{ id: 1, start: 9.8, end: 12.9, text: "سلام" }];

  assert.deepEqual(validateTranslatedSegments(source, translated), [
    { id: 1, start: 10.12, end: 12.34, text: "سلام" },
  ]);
  assert.throws(
    () => validateTranslatedSegments(source, translated, { strictTiming: true }),
    /cue timing mismatch/,
  );
});

test("detects punctuation-only subtitles as no usable speech", () => {
  assert.equal(hasUsableSubtitleText([
    { id: 1, start: 0, end: 1, text: "\u200f." },
    { id: 2, start: 1, end: 2, text: "..." },
  ]), false);
  assert.equal(hasUsableSubtitleText([{ id: 1, start: 0, end: 1, text: "*מנגינה*" }]), false);
  assert.equal(hasUsableSubtitleText([{ id: 1, start: 0, end: 1, text: "*موسیقی*" }]), false);
  assert.equal(hasUsableSubtitleText([{ id: 1, start: 0, end: 1, text: "[Music]" }]), false);
  assert.equal(hasUsableSubtitleText([{ id: 1, start: 0, end: 1, text: "سلام" }]), true);
  assert.equal(hasUsableSubtitleText([{ id: 1, start: 0, end: 1, text: "impact confirmed" }]), true);
  assert.equal(hasUsableSubtitleText([{ id: 1, start: 0, end: 1, text: "שלום" }]), true);
});

test("sanitizes overlapping transcript cues and clips to video duration", () => {
  const segments = [
    { id: 5, start: 9.36, end: 13.36, text: "what we do tonight are gonna advance our military" },
    { id: 6, start: 13.049, end: 13.849, text: "interests" },
    { id: 7, start: 13.849, end: 18.329, text: "and also enhance our diplomatic position because it" },
  ];

  const sanitized = sanitizeSubtitleSegments(segments, { durationMs: 17117 });

  assert.equal(sanitized.length, 3);
  assert.equal(sanitized[0].id, 1);
  assert.ok(sanitized[0].end <= sanitized[1].start - 0.019);
  assert.ok(sanitized[2].end <= 17.117);
  assert.ok(sanitized.every((segment) => segment.end > segment.start));

  const srt = segmentsToSrt(segments, { language: "en", durationMs: 17117, splitLongCues: false });
  assert.match(srt, /00:00:09,360 --> 00:00:13,029/);
  assert.match(srt, /00:00:13,049 --> 00:00:13,829/);
  assert.match(srt, /00:00:13,849 --> 00:00:17,117/);
  assert.doesNotMatch(srt, /00:00:18,329/);
});

test("rejects translated segments when cue ids drift", () => {
  const source = [{ id: 1, start: 0, end: 1.5, text: "Hello" }];
  assert.throws(
    () => validateTranslatedSegments(source, [{ id: 2, start: 0, end: 1.5, text: "سلام" }]),
    /cue id mismatch/,
  );
});

test("generates Persian SRT and ASS with two-line cue wrapping", () => {
  const segments = [
    { id: 1, start: 0, end: 2.25, text: "این یک زیرنویس فارسی طولانی برای بررسی شکستن خطوط است" },
  ];

  const srt = segmentsToSrt(segments);
  assert.match(srt, /00:00:00,000 --> 00:00:02,250/);
  assert.match(srt, /این یک زیرنویس فارسی/);

  const ass = segmentsToAss(segments, { width: 1080, height: 1920, splitLongCues: false });
  assert.match(ass, /\[Script Info\]/);
  assert.match(ass, /Style: PersianSubtitle/);
  assert.match(ass, /Dialogue: 0,0:00:00.00,0:00:02.25,PersianSubtitle/);
  assert.match(ass, /\\N/);
});

test("splits overlong translated cues into shorter readable timings", () => {
  const segments = [
    {
      id: 1,
      start: 0.24,
      end: 20.775,
      text: "بله، لورا. شب بخیر. همین الان با رئیس‌جمهور ترامپ صحبت کردم که الان در اتاق وضعیت است با معاون‌اول جی‌دی ونس و فرستاده‌های ویژه کوشنر و ویتکاف.",
    },
  ];

  const split = splitLongSubtitleSegments(segments, { language: "fa", width: 1280, height: 720 });
  assert.ok(split.length > 1);
  assert.equal(split[0].start, 0.24);
  assert.equal(split.at(-1).end, 20.775);
  assert.equal(split.every((segment) => segment.text.length <= 90), true);
  assert.equal(split.every((segment) => segment.end - segment.start <= 12.4), true);
  assert.equal(split.every((segment, index) => segment.id === index + 1), true);

  const ass = segmentsToAss(segments, { language: "fa", width: 1280, height: 720 });
  assert.equal((ass.match(/^Dialogue:/gm) ?? []).length, split.length);
  assert.doesNotMatch(ass, /اتاق وضعیت است با معاون‌اول جی‌دی ونس و فرستاده‌های ویژه کوشنر و ویتکاف\\N/);
});

test("splitting long cues merges tiny trailing word chunks", () => {
  const split = splitLongSubtitleSegments([{
    id: 1,
    start: 0,
    end: 3.7,
    text: "تازه با رئیس‌جمهور ترامپ تلفنی صحبت کردم. او به فاکس",
  }], { language: "fa", maxCueChars: 52 });

  assert.equal(split.some((segment) => segment.text.length < 8), false);
  assert.equal(split.at(-1).end, 3.7);
});

test("splitting subtitle segments merges adjacent micro-cues", () => {
  const split = splitLongSubtitleSegments([
    { id: 1, start: 53.675, end: 54.395, text: "This" },
    { id: 2, start: 55.115, end: 55.835, text: "too" },
    { id: 3, start: 56.38, end: 59.34, text: "requires the cooperation and support of all groups," },
  ], { language: "en", maxCueChars: 84 });

  assert.equal(split.length, 1);
  assert.equal(split[0].text, "This too requires the cooperation and support of all groups,");
  assert.equal(split[0].start, 53.675);
  assert.equal(split[0].end, 59.34);
});

test("splitting subtitle segments keeps open-ended sentence fragments together when they fit", () => {
  const split = splitLongSubtitleSegments([
    { id: 1, start: 11.84, end: 15.6, text: "But not like this either. If they want to" },
    { id: 2, start: 16.33, end: 19.11, text: "violate our dignity, our land, and our territory" },
    { id: 3, start: 19.13, end: 22.90, text: "will we surrender or back down?" },
  ], { language: "en", width: 640, height: 360 });

  assert.equal(split.length, 1);
  assert.equal(split[0].text, "But not like this either. If they want to violate our dignity, our land, and our territory will we surrender or back down?");
  assert.equal(split[0].start, 11.84);
  assert.equal(split[0].end, 22.9);
});

test("splitting long text prefers sentence boundaries over mid-sentence cuts", () => {
  const split = splitLongSubtitleSegments([{
    id: 1,
    start: 0,
    end: 8.5,
    text: "تازه با رئیس‌جمهور ترامپ تلفنی صحبت کردم. او به فاکس گفت که وضعیت را دنبال می‌کند.",
  }], { language: "fa", width: 1280, height: 720 });

  assert.equal(split.length <= 2, true);
  if (split.length === 2) {
    assert.match(split[0].text, /صحبت کردم\.$/);
    assert.match(split[1].text, /^او به فاکس/);
  } else {
    assert.match(split[0].text, /صحبت کردم\. او به فاکس/);
  }
});

test("ASS subtitles use a large readable font on 1080p-class videos", () => {
  const ass = segmentsToAss([
    { id: 1, start: 0, end: 2, text: "می‌شه یه «فلسطین آزاد» بگی؟" },
  ], {
    width: 1920,
    height: 1078,
  });

  assert.match(ass, /Style: PersianSubtitle,Vazirmatn,84,/);
});

test("ASS subtitles keep a larger cap for vertical videos", () => {
  const ass = segmentsToAss([
    { id: 1, start: 0, end: 2, text: "زیرنویس فارسی خوانا" },
  ], {
    width: 1080,
    height: 1920,
  });

  assert.match(ass, /Style: PersianSubtitle,Vazirmatn,112,/);
});

test("generates English subtitle files without RTL marks", () => {
  const segments = [
    { id: 1, start: 0, end: 2.25, text: "This is a readable English subtitle line" },
  ];

  const srt = segmentsToSrt(segments, { language: "en" });
  assert.match(srt, /This is a readable English/);
  assert.doesNotMatch(srt, /\u200f/);
  assert.equal(wrapCue("Hello world", { language: "en" }), "Hello world");

  const ass = segmentsToAss(segments, { width: 1080, height: 1920, language: "en" });
  assert.match(ass, /Style: TargetSubtitle,Arial/);
  assert.match(ass, /Dialogue: 0,0:00:00.00,0:00:02.25,TargetSubtitle/);
});

test("English ASS subtitles are smaller and use near-full-width dynamic margins", () => {
  const english = segmentsToAss([
    { id: 1, start: 0, end: 2, text: "This subtitle should fit a fuller thought" },
  ], {
    width: 640,
    height: 360,
    language: "en",
  });
  const persian = segmentsToAss([
    { id: 1, start: 0, end: 2, text: "این زیرنویس خوانا می‌ماند" },
  ], {
    width: 640,
    height: 360,
    language: "fa",
  });

  assert.match(english, /Style: TargetSubtitle,Arial,23,/);
  assert.match(persian, /Style: PersianSubtitle,Vazirmatn,42,/);
  assert.match(english, /,2,26,26,22,1/);
  assert.doesNotMatch(english, /,2,80,80,56,1/);
});

test("ASS subtitles split long Persian cues instead of rendering three lines", () => {
  const ass = segmentsToAss([
    {
      id: 1,
      start: 16.471,
      end: 25.095,
      text: "سی‌ان‌ان و اون ام‌اس‌ان‌بی‌سی یا هرچی الان صداش می‌کنن، ان‌بی‌سی مجبور شد ازش خلاص بشه چون به اعتبارشون لطمه می‌زد.",
    },
  ], {
    language: "fa",
    width: 720,
    height: 406,
  });
  const dialogueLines = ass.split("\n").filter((line) => line.startsWith("Dialogue:"));

  assert.equal(dialogueLines.length > 1, true);
  assert.equal(dialogueLines.every((line) => (line.match(/\\N/g) ?? []).length <= 1), true);
});

test("ASS subtitles use yellow text with a black boxed background by default", () => {
  const ass = segmentsToAss([
    { id: 1, start: 0, end: 2, text: "این یک زیرنویس آزمایشی است." },
  ], {
    language: "fa",
    width: 1280,
    height: 720,
  });

  assert.match(ass, /Style: PersianSubtitle,Vazirmatn,56,&H0000FFFF,&H000000FF,&H00000000,&H40000000,-1,0,0,0,100,100,0,0,3,6,0,2,/);
});

test("ASS subtitles can still use white outline style explicitly", () => {
  const ass = segmentsToAss([
    { id: 1, start: 0, end: 2, text: "این یک زیرنویس آزمایشی است." },
  ], {
    language: "fa",
    width: 1280,
    height: 720,
    subtitleStyle: "white_outline",
  });

  assert.match(ass, /Style: PersianSubtitle,Vazirmatn,56,&H00FFFFFF,&H000000FF,&HCC000000,&H88000000,-1,0,0,0,100,100,0,0,1,2,1,2,/);
});

test("normalizes Persian subtitle punctuation", () => {
  const srt = segmentsToSrt([
    { id: 1, start: 0, end: 2, text: "کار را تمام کنیم, تمام شد?" },
  ]);

  assert.match(srt, /تمام کنیم، تمام شد؟/);
  assert.doesNotMatch(srt, /تمام کنیم, تمام شد\\?/);
});

test("wraps Persian cue lines with explicit RTL isolation so final punctuation stays left", () => {
  const wrapped = wrapCue("این جمله تمام شد.", { language: "fa" });
  assert.equal(wrapped, "\u202bاین جمله تمام شد.\u200f\u202c");

  const ass = segmentsToAss([
    { id: 1, start: 0, end: 2, text: "تمام شد." },
  ], {
    language: "fa",
    width: 1280,
    height: 720,
    splitLongCues: false,
  });
  assert.match(ass, /\u202bتمام شد\.\u200f\u202c/);
});

test("removes leading punctuation from Persian cues", () => {
  const srt = segmentsToSrt([
    { id: 1, start: 0, end: 2, text: "، و این کار ادامه دارد" },
  ]);

  assert.match(srt, /و این کار ادامه دارد/);
  assert.doesNotMatch(srt, /\n‏،/);
});

test("ASS subtitle margin can be raised above lower text regions", () => {
  assert.equal(resolveSubtitleMarginV({ bottomMargin: 0.22 }, 1000), 220);

  const ass = segmentsToAss([
    { id: 1, start: 0, end: 2, text: "زیرنویس بالا می‌آید" },
  ], {
    width: 1280,
    height: 1000,
    subtitlePlacement: { bottomMargin: 0.22 },
  });

  assert.match(ass, /Style: PersianSubtitle,[^\n]+,220,1/);
});
