export type LearnedBiases = {
  author_bias?: Record<string, number>;
  tag_bias?: Record<string, number>;
};

export type FeedbackBiasInput = {
  deliveryDecision: string;
  decisionReason: string | null;
  finalScore: number | null;
  filterEnabled: boolean;
  scoreOnly: boolean;
  threshold: number;
  authorHandle?: string | null;
  tags?: unknown[] | null;
  learnedBiases?: LearnedBiases | null;
  knnPrior?: number | null;
  scoringV2?: Record<string, unknown> | null;
};

export type FeedbackBiasResult = {
  deliveryDecision: string;
  decisionReason: string | null;
  finalScore: number | null;
  scoreBreakdown: Record<string, unknown> | null;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function applyLearnedFeedbackBias(input: FeedbackBiasInput): FeedbackBiasResult {
  let deliveryDecision = input.deliveryDecision;
  let decisionReason = input.decisionReason;
  let finalScore = input.finalScore;

  if (finalScore === null) {
    return { deliveryDecision, decisionReason, finalScore, scoreBreakdown: null };
  }

  const biases = input.learnedBiases ?? {};
  const authorKey = input.authorHandle ? input.authorHandle.toLowerCase() : "";
  const authorDelta = authorKey ? (biases.author_bias?.[authorKey] ?? 0) : 0;
  let tagDelta = 0;
  for (const tag of input.tags ?? []) {
    tagDelta += biases.tag_bias?.[String(tag).toLowerCase()] ?? 0;
  }
  tagDelta = clamp(tagDelta, -2, 2);

  const knnPrior = typeof input.knnPrior === "number" && Number.isFinite(input.knnPrior)
    ? input.knnPrior
    : 0;
  const totalBias = clamp(authorDelta + tagDelta + knnPrior, -5, 5);
  const aiFinal = finalScore;

  if (totalBias !== 0) {
    finalScore = clamp(round1(finalScore + totalBias), 1, 20);
    if (input.filterEnabled && !input.scoreOnly) {
      if (
        finalScore >= input.threshold
        && deliveryDecision === "skip"
        && (decisionReason ?? "").startsWith("below_threshold")
      ) {
        deliveryDecision = "deliver";
        decisionReason = `feedback_boost:${aiFinal.toFixed(1)}+${totalBias.toFixed(1)}>=${input.threshold}`;
      } else if (
        finalScore < input.threshold
        && deliveryDecision === "deliver"
        && (decisionReason ?? "").startsWith("score_pass")
      ) {
        deliveryDecision = "skip";
        decisionReason = `feedback_reduce:${aiFinal.toFixed(1)}+${totalBias.toFixed(1)}<${input.threshold}`;
      }
    }
  }

  return {
    deliveryDecision,
    decisionReason,
    finalScore,
    scoreBreakdown: {
      ai: round1(aiFinal),
      ...(authorDelta ? { author_bias: round3(authorDelta) } : {}),
      ...(tagDelta ? { tag_bias: round3(tagDelta) } : {}),
      ...(knnPrior ? { knn_prior: round3(knnPrior) } : {}),
      final: round1(finalScore),
      ...(input.scoringV2 ? { scoring_v2: input.scoringV2 } : {}),
    },
  };
}
