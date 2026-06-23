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
    learningMode: "applied",
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
    learningMode: "applied",
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
    learningMode: "applied",
    learnedBiases: { author_bias: { source: 5 } },
    authorHandle: "source",
  });

  assertEquals(result.deliveryDecision, "skip");
  assertEquals(result.finalScore, 17);
});

Deno.test("shadow learning records learned score without changing production gate", () => {
  const result = applyLearnedFeedbackBias({
    deliveryDecision: "skip",
    decisionReason: "below_threshold:12<14",
    finalScore: 12,
    filterEnabled: true,
    scoreOnly: false,
    threshold: 14,
    xGateThreshold: 17,
    authorHandle: "firstsquawk",
    tags: ["oil"],
    learnedBiases: {
      author_bias: { firstsquawk: 1.5 },
      tag_bias: { oil: 0.8 },
    },
  });

  assertEquals(result.deliveryDecision, "skip");
  assertEquals(result.decisionReason, "below_threshold:12<14");
  assertEquals(result.finalScore, 12);
  assertEquals(result.baseScore, 12);
  assertEquals(result.learnedScore, 14.3);
  assertEquals(result.learnedDelta, 2.3);
  assertEquals(result.xGateScore, 12);
  assertEquals(result.learningConfidence?.learning_mode, "shadow");
  assertEquals(result.learningConfidence?.applied_to_production, false);
});

Deno.test("negative learning does not silently veto an X-eligible base score without confidence", () => {
  const result = applyLearnedFeedbackBias({
    deliveryDecision: "deliver",
    decisionReason: "scoring_v2:direct_focus:18.9>=12",
    finalScore: 18.9,
    filterEnabled: true,
    scoreOnly: false,
    threshold: 12,
    xGateThreshold: 17,
    learningMode: "applied",
    knnPrior: -2,
    knnPriorDetails: {
      prior: -2,
      neighbor_count: 1,
      negative_count: 1,
      recent_negative_count: 0,
      mean_similarity: 0.76,
      max_similarity: 0.8,
    },
  });

  assertEquals(result.baseScore, 18.9);
  assertEquals(result.learnedScore, 16.9);
  assertEquals(result.learnedDelta, -2);
  assertEquals(result.xGateScore, 18.9);
  assertEquals(
    result.learningConfidence?.negative_learning_veto_allowed,
    false,
  );
  assertEquals(result.scoreBreakdown?.x_gate_score, 18.9);
});

Deno.test("high-confidence negative learning can veto the X gate", () => {
  const result = applyLearnedFeedbackBias({
    deliveryDecision: "deliver",
    decisionReason: "scoring_v2:direct_focus:18.9>=12",
    finalScore: 18.9,
    filterEnabled: true,
    scoreOnly: false,
    threshold: 12,
    xGateThreshold: 17,
    learningMode: "applied",
    knnPrior: -2,
    knnPriorDetails: {
      prior: -2,
      neighbor_count: 4,
      negative_count: 3,
      recent_negative_count: 2,
      mean_similarity: 0.85,
      max_similarity: 0.91,
    },
  });

  assertEquals(result.baseScore, 18.9);
  assertEquals(result.learnedScore, 16.9);
  assertEquals(result.xGateScore, 16.9);
  assertEquals(
    result.learningConfidence?.negative_learning_veto_allowed,
    true,
  );
});
