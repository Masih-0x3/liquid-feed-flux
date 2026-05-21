import { assertEquals } from "jsr:@std/assert";
import { applyProfileDecision, type EditorialProfile, type ScoreAxes } from "./scoring.ts";

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

function axes(values: Required<ScoreAxes>): ScoreAxes {
  return values;
}
