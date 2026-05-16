import { assert, assertEquals } from "jsr:@std/assert";
import { buildXPostText, isEnrichmentApprovedForPosting, isEnrichmentBlockingXPost } from "./xPostText.ts";

Deno.test("isEnrichmentApprovedForPosting allows approved and gated completed only", () => {
  assertEquals(isEnrichmentApprovedForPosting("approved", false), true);
  assertEquals(isEnrichmentApprovedForPosting("enriched", false), true);
  assertEquals(isEnrichmentApprovedForPosting("completed", true), true);
  assertEquals(isEnrichmentApprovedForPosting("completed", false), false);
  assertEquals(isEnrichmentApprovedForPosting("awaiting_approval", true), false);
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
  assertEquals(isEnrichmentBlockingXPost("awaiting_approval", false, false), false);
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

  const plain = buildXPostText({ post, cfg, hashtagsValue: "", persianDate: "۱ اردیبهشت ۱۴۰۵", allowCompletedEnrichment: false });
  assert(!plain.includes("تحلیل اختصاصی"));

  const approved = buildXPostText({ post: { ...post, enrich_status: "approved" }, cfg, hashtagsValue: "#Iran", persianDate: "۱ اردیبهشت ۱۴۰۵", allowCompletedEnrichment: false });
  assert(approved.includes("تحلیل اختصاصی"));
  assert(approved.includes("#Iran"));
});
