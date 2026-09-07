import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert";
import {
  applyProfileDecision,
  computeFinalScore,
  type EditorialProfile,
  type ScoreAxes,
  type ScoreAxisKey,
} from "./scoring.ts";

const iranWarProfile: EditorialProfile = {
  id: "iran-war-default",
  name: "Iran War Default",
  threshold: 14,
  weights: {
    iran_relevance: 4,
    severity: 3,
    novelty: 2,
    credibility: 2,
    actionability: 1,
    noise: 4,
  },
  must_include_keywords: [],
  must_exclude_keywords: [],
  required_tags_any: [],
  blocked_tags: [],
  author_overrides: {},
};

Deno.test("Iran-first profile floors credible direct leadership coordination into X-review range", () => {
  const result = applyProfileDecision({
    profile: iranWarProfile,
    axes: axes({
      iran_relevance: 6,
      severity: 3,
      novelty: 3,
      credibility: 8,
      actionability: 4,
      noise: 2,
    }),
    legacyScore: 12.6,
    tags: ["Iran", "Trump", "Netanyahu"],
    text: "Trump and Netanyahu are on the same page on Iran.",
    authorHandle: "clashreport",
  });

  assertEquals(result.decision, "deliver");
  assertEquals(result.finalScore >= 17, true);
  assertEquals(result.reason.includes("iran_high_signal_floor"), true);
});

Deno.test("Iran-first profile treats military posture around Qeshm and Hormuz as very high impact", () => {
  const result = applyProfileDecision({
    profile: iranWarProfile,
    axes: axes({
      iran_relevance: 9,
      severity: 5,
      novelty: 5,
      credibility: 7,
      actionability: 6,
      noise: 1,
    }),
    legacyScore: 15.2,
    tags: ["Iran", "Qeshm", "air defense"],
    text: "Air defense activity reported near Qeshm and the Strait of Hormuz after drone activity.",
    authorHandle: "osint613",
  });

  assertEquals(result.decision, "deliver");
  assertEquals(result.finalScore >= 18, true);
  assertEquals(result.reason.includes("iran_very_high_signal_floor"), true);
});

Deno.test("Iran-first profile keeps direct but non-kinetic diplomacy in the high band", () => {
  const result = applyProfileDecision({
    profile: iranWarProfile,
    axes: axes({
      iran_relevance: 8,
      severity: 3,
      novelty: 4,
      credibility: 8,
      actionability: 4,
      noise: 1,
    }),
    legacyScore: 15.4,
    tags: ["Iran", "Pakistan", "Tehran"],
    text: "Pakistan Army Chief visits Tehran and reaches a final draft agreement with Iranian officials.",
    authorHandle: "firstsquawk",
  });

  assertEquals(result.decision, "deliver");
  assertEquals(result.finalScore, 17);
});

Deno.test("Iran-first profile does not inflate unrelated Taiwan news", () => {
  const result = applyProfileDecision({
    profile: iranWarProfile,
    axes: axes({
      iran_relevance: 0,
      severity: 2,
      novelty: 2,
      credibility: 6,
      actionability: 1,
      noise: 3,
    }),
    legacyScore: 5,
    tags: ["Taiwan"],
    text: "Taiwan thanks the United States for support.",
    authorHandle: "firstsquawk",
  });

  assertEquals(result.decision, "skip");
  assertEquals(result.finalScore, 5);
});

function weightedAxesProvider() {
  const a: Required<ScoreAxes> = {
    iran_relevance: 8,
    severity: 7,
    novelty: 5,
    credibility: 6,
    actionability: 4,
    noise: 5,
  };
  const w = (noise: number): Record<ScoreAxisKey, number> => ({
    iran_relevance: 1,
    severity: 1,
    novelty: 1,
    credibility: 0.5,
    actionability: 1,
    noise,
  });
  return { a, w };
}

Deno.test("computeFinalScore penalizes noise proportionally to the noise weight", () => {
  const { a, w } = weightedAxesProvider();
  assertNotEquals(computeFinalScore(a, w(1)), computeFinalScore(a, w(4)));
  assertNotEquals(computeFinalScore(a, w(1)), computeFinalScore(a, w(0.5)));
});

Deno.test("computeFinalScore noise weight 0 disables the penalty entirely", () => {
  const { w } = weightedAxesProvider();
  const base = { iran_relevance: 8, severity: 7, novelty: 5, credibility: 6, actionability: 4 };
  assertEquals(computeFinalScore({ ...base, noise: 0 }, w(0)), computeFinalScore({ ...base, noise: 7 }, w(0)));
  assertEquals(computeFinalScore({ ...base, noise: 0 }, w(0)), computeFinalScore({ ...base, noise: 10 }, w(0)));
  assertEquals(computeFinalScore({ ...base, noise: 10 }, w(0)), 12);
});

Deno.test("computeFinalScore default-weights path is unchanged by the noise fix", () => {
  const { a } = weightedAxesProvider();
  const explicitDefault: Record<ScoreAxisKey, number> = {
    iran_relevance: 1,
    severity: 1,
    novelty: 1,
    credibility: 0.5,
    actionability: 1,
    noise: 1,
  };
  assertEquals(computeFinalScore(a), computeFinalScore(a, explicitDefault));
  assertEquals(computeFinalScore(a), 8);
});

Deno.test("applyProfileDecision skips high-noise items the cancelled weight would have delivered", () => {
  const profile: EditorialProfile = {
    ...iranWarProfile,
    threshold: 2,
  };
  const result = applyProfileDecision({
    profile,
    axes: axes({
      iran_relevance: 4,
      severity: 5,
      novelty: 4,
      credibility: 7,
      actionability: 3,
      noise: 8,
    }),
    legacyScore: 0,
    tags: [],
    text: "Spammy crypto giveaway promotion, click the link to claim your prize.",
    authorHandle: null,
  });

  assertEquals(result.finalScore, 0);
  assertEquals(result.decision, "skip");
  assert(result.reason.startsWith("below_threshold"));
});

function axes(values: Required<ScoreAxes>): ScoreAxes {
  return values;
}
