import { assertEquals } from "jsr:@std/assert";
import { getXQuotaBlockReason } from "./xQuotaAdmission.ts";

const valid = {
  available: true,
  nowMs: 1_000_000,
  limits: {
    posts_per_hour: 2,
    posts_per_day: 3,
    monthly_post_budget: 4,
    media_uploads_per_day: 5,
  },
  config: { daily_budget: 0, min_spacing_minutes: 0 },
  snapshot: {
    posts1h: 1,
    posts24h: 2,
    posts30d: 3,
    mediaUploads24h: 4,
    lastPostTimeMs: 0,
  },
};

Deno.test("X quota admission accepts only typed available quota snapshots", () => {
  assertEquals(getXQuotaBlockReason(valid), null);
  assertEquals(
    getXQuotaBlockReason({ ...valid, available: false }),
    "quota_unavailable",
  );
  assertEquals(
    getXQuotaBlockReason({
      ...valid,
      limits: { ...valid.limits, posts_per_hour: "2" },
    }),
    "quota_unavailable",
  );
  assertEquals(
    getXQuotaBlockReason({
      ...valid,
      limits: { ...valid.limits, posts_per_hour: 1_001 },
    }),
    "quota_unavailable",
  );
  assertEquals(
    getXQuotaBlockReason({
      ...valid,
      config: { daily_budget: null, min_spacing_minutes: 0 },
    }),
    "quota_unavailable",
  );
  assertEquals(
    getXQuotaBlockReason({
      ...valid,
      snapshot: { ...valid.snapshot, lastPostTimeMs: Number.NaN },
    }),
    "quota_unavailable",
  );
});

Deno.test("X quota admission returns the correct window and same-run boundaries", () => {
  assertEquals(
    getXQuotaBlockReason({
      ...valid,
      snapshot: { ...valid.snapshot, posts1h: 2 },
    }),
    "rate_limit_hour",
  );
  assertEquals(
    getXQuotaBlockReason({
      ...valid,
      snapshot: { ...valid.snapshot, posts24h: 3 },
    }),
    "rate_limit_day",
  );
  assertEquals(
    getXQuotaBlockReason({
      ...valid,
      snapshot: { ...valid.snapshot, posts30d: 4 },
    }),
    "rate_limit_month",
  );
  assertEquals(
    getXQuotaBlockReason({
      ...valid,
      snapshot: { ...valid.snapshot, mediaUploads24h: 5 },
    }),
    "rate_limit_media",
  );
  assertEquals(
    getXQuotaBlockReason({
      ...valid,
      config: { daily_budget: 2, min_spacing_minutes: 0 },
    }),
    "daily_budget_reached",
  );
  assertEquals(
    getXQuotaBlockReason({
      ...valid,
      config: { daily_budget: 0, min_spacing_minutes: 1 },
      snapshot: { ...valid.snapshot, lastPostTimeMs: 999_999 },
    }),
    "min_spacing",
  );
});

Deno.test("X quota admission media cap follows the per-media-item unit", () => {
  // The in-run counter in x-poster/index.ts increments once per uploadImage
  // and the 24h DB baseline sums x_deliveries.media_count, so the snapshot
  // value is the count of individual media items uploaded in the last 24h.
  // The admission gate must trip exactly when that count reaches
  // media_uploads_per_day, regardless of whether the count was reached by
  // many single-image posts or few multi-image posts. This loop models the
  // counter advancing one media item at a time, asserting that admission
  // stays open up to (cap - 1) and switches to rate_limit_media at the cap
  // — the guarantee the per-image upload loop in x-poster depends on.
  const cap = 5;
  const atCount = (n: number) =>
    getXQuotaBlockReason({
      ...valid,
      limits: { ...valid.limits, media_uploads_per_day: cap },
      snapshot: { ...valid.snapshot, mediaUploads24h: n },
    });
  assertEquals(atCount(0), null, "an empty 24h media history must admit");
  assertEquals(atCount(cap - 2), null, "two slots below the cap must admit");
  assertEquals(atCount(cap - 1), null, "one slot below the cap must admit");
  assertEquals(atCount(cap), "rate_limit_media", "the cap itself must block");
  assertEquals(
    atCount(cap + 1),
    "rate_limit_media",
    "any post-cap value (overshoot) must still block",
  );
  assertEquals(
    atCount(cap + 3),
    "rate_limit_media",
    "the prior worst-case +3 overshoot (a 4-image iteration that started at cap - 1) must still block",
  );
  // The operator-intent check: setting media_uploads_per_day=50 must trip at
  // 50 media items, not at 50 image-posts (which could carry up to 200 real
  // media uploads under the old per-post baseline).
  assertEquals(
    getXQuotaBlockReason({
      ...valid,
      limits: { ...valid.limits, media_uploads_per_day: 50 },
      snapshot: { ...valid.snapshot, mediaUploads24h: 50 },
    }),
    "rate_limit_media",
    "an operator lowering the cap to 50 must trip at 50 media items, not at 50 image-posts",
  );
  assertEquals(
    getXQuotaBlockReason({
      ...valid,
      limits: { ...valid.limits, media_uploads_per_day: 50 },
      snapshot: { ...valid.snapshot, mediaUploads24h: 49 },
    }),
    null,
    "the 50th media upload in 24h must still be admissible (cap is the cap, not cap-1)",
  );
});
