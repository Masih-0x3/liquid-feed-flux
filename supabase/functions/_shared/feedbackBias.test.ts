import { assertEquals } from "jsr:@std/assert";
import { applyLearnedFeedbackBias } from "./feedbackBias.ts";

Deno.test("feedback boost can promote below-threshold items before translation gating", () => {
  const result = applyLearnedFeedbackBias({
    deliveryDecision: "skip",
    decisionReason: "below_threshold:12<14",
    finalScore: 12,
    filterEnabled: true,
    scoreOnly: false,
    threshold: 14,
    authorHandle: "firstsquawk",
    tags: ["oil"],
    learnedBiases: {
      author_bias: { firstsquawk: 1.5 },
      tag_bias: { oil: 0.8 },
    },
  });

  assertEquals(result.deliveryDecision, "deliver");
  assertEquals(result.decisionReason, "feedback_boost:12.0+2.3>=14");
  assertEquals(result.finalScore, 14.3);
  assertEquals(result.scoreBreakdown?.author_bias, 1.5);
  assertEquals(result.scoreBreakdown?.tag_bias, 0.8);
});

Deno.test("feedback reduction can demote marginal pass decisions", () => {
  const result = applyLearnedFeedbackBias({
    deliveryDecision: "deliver",
    decisionReason: "score_pass:14>=14",
    finalScore: 14,
    filterEnabled: true,
    scoreOnly: false,
    threshold: 14,
    tags: ["routine"],
    learnedBiases: { tag_bias: { routine: -1.5 } },
  });

  assertEquals(result.deliveryDecision, "skip");
  assertEquals(result.decisionReason, "feedback_reduce:14.0+-1.5<14");
  assertEquals(result.finalScore, 12.5);
});

Deno.test("score-only mode records bias without changing the delivery decision", () => {
  const result = applyLearnedFeedbackBias({
    deliveryDecision: "skip",
    decisionReason: "below_threshold:12<14",
    finalScore: 12,
    filterEnabled: true,
    scoreOnly: true,
    threshold: 14,
    learnedBiases: { author_bias: { source: 5 } },
    authorHandle: "source",
  });

  assertEquals(result.deliveryDecision, "skip");
  assertEquals(result.finalScore, 17);
});
