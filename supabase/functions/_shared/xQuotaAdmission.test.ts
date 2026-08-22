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
