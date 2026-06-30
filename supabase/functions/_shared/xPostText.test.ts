import { assert, assertEquals } from "jsr:@std/assert";
import {
  buildXPostText,
  enforceRtlXPostText,
  isEnrichmentApprovedForPosting,
  isEnrichmentBlockingXPost,
  PDI,
  RLI,
  RLM,
} from "./xPostText.ts";

Deno.test("isEnrichmentApprovedForPosting allows approved and gated completed only", () => {
  assertEquals(isEnrichmentApprovedForPosting("approved", false), true);
  assertEquals(isEnrichmentApprovedForPosting("enriched", false), true);
  assertEquals(isEnrichmentApprovedForPosting("completed", true), true);
  assertEquals(isEnrichmentApprovedForPosting("completed", false), false);
  assertEquals(
    isEnrichmentApprovedForPosting("awaiting_approval", true),
    false,
  );
  assertEquals(isEnrichmentApprovedForPosting("rejected", true), false);
});

Deno.test("isEnrichmentBlockingXPost blocks review and rejected drafts", () => {
  assertEquals(isEnrichmentBlockingXPost(null, false), false);
  assertEquals(isEnrichmentBlockingXPost("skipped", false), false);
  assertEquals(isEnrichmentBlockingXPost("approved", false), false);
  assertEquals(isEnrichmentBlockingXPost("awaiting_approval", false), true);
  assertEquals(isEnrichmentBlockingXPost("rejected", true), true);
  assertEquals(isEnrichmentBlockingXPost("completed", false), true);
  assertEquals(isEnrichmentBlockingXPost("completed", true), false);
  assertEquals(isEnrichmentBlockingXPost("pending", false, false), false);
  assertEquals(
    isEnrichmentBlockingXPost("awaiting_approval", false, false),
    false,
  );
});

Deno.test("buildXPostText uses final_x_text only after approval", () => {
  const cfg = {
    post_template: "{leading_emoji} {translated_text}",
    leading_emoji: "News",
    max_chars: 280,
  };
  const post = {
    text_translated: "ترجمه خبر",
    final_x_text: "تحلیل اختصاصی\n\nترجمه خبر",
    enrich_status: "awaiting_approval",
  };

  const plain = buildXPostText({
    post,
    cfg,
    hashtagsValue: "",
    persianDate: "۱ اردیبهشت ۱۴۰۵",
    allowCompletedEnrichment: false,
  });
  assert(!plain.includes("تحلیل اختصاصی"));

  const approved = buildXPostText({
    post: { ...post, enrich_status: "approved" },
    cfg,
    hashtagsValue: "#Iran",
    persianDate: "۱ اردیبهشت ۱۴۰۵",
    allowCompletedEnrichment: false,
  });
  assert(approved.includes("تحلیل اختصاصی"));
  assert(approved.includes("#Iran"));
});

Deno.test("buildXPostText wraps template posts in an RTL isolate", () => {
  const cfg = {
    post_template: "{leading_emoji} {translated_text}\n\n{hashtags}",
    leading_emoji: "📰",
    max_chars: 280,
  };
  const text = buildXPostText({
    post: { text_translated: "CNBC: بهای نفت بالا رفت" },
    cfg,
    hashtagsValue: "#Iran",
    persianDate: "۱ اردیبهشت ۱۴۰۵",
    allowCompletedEnrichment: false,
  });

  assert(text.startsWith(`${RLI}${RLM}`));
  assert(text.endsWith(PDI));
  assert(text.includes(`${RLM}📰 CNBC`));
  assert(text.includes(`\n\n${RLM}#Iran`));
  assert(text.length <= cfg.max_chars);
});

Deno.test("buildXPostText wraps approved final text and hashtag lines", () => {
  const cfg = {
    post_template: "{leading_emoji} {translated_text}",
    leading_emoji: "📰",
    max_chars: 280,
  };
  const text = buildXPostText({
    post: {
      text_translated: "ترجمه خبر",
      final_x_text: "i24 News مدعی شد اسرائیل آماده است",
      enrich_status: "approved",
    },
    cfg,
    hashtagsValue: "#KingRezaPahlavi‌ForIran",
    persianDate: "۱ اردیبهشت ۱۴۰۵",
    allowCompletedEnrichment: false,
  });

  assert(text.startsWith(`${RLI}${RLM}`));
  assert(text.endsWith(PDI));
  assert(text.includes(`${RLM}i24 News`));
  assert(text.includes(`\n\n${RLM}#KingRezaPahlavi‌ForIran`));
  assert(text.length <= cfg.max_chars);
});

Deno.test("enforceRtlXPostText avoids nested outer bidi wrappers", () => {
  const once = enforceRtlXPostText("CNBC: خبر فارسی", 280);
  const twice = enforceRtlXPostText(once, 280);

  assertEquals(twice, once);
  assertEquals([...twice].filter((ch) => ch === RLI).length, 1);
  assertEquals([...twice].filter((ch) => ch === PDI).length, 1);
});

Deno.test("enforceRtlXPostText keeps truncation inside the isolate budget", () => {
  const text = enforceRtlXPostText("CNBC: " + "خبر ".repeat(40), 32, true);

  assert(text.startsWith(`${RLI}${RLM}`));
  assert(text.endsWith(PDI));
  assert(text.includes("…"));
  assert(text.length <= 32);
});
