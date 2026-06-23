export type LearnedBiases = {
  author_bias?: Record<string, number>;
  tag_bias?: Record<string, number>;
};

export type KnnFeedbackPriorDetails = {
  prior?: number | null;
  neighbor_count?: number | null;
  positive_count?: number | null;
  negative_count?: number | null;
  recent_negative_count?: number | null;
  mean_similarity?: number | null;
  max_similarity?: number | null;
};

export type LearningMode = "shadow" | "applied" | "human_only";

export type FeedbackBiasInput = {
  deliveryDecision: string;
  decisionReason: string | null;
  finalScore: number | null;
  filterEnabled: boolean;
  scoreOnly: boolean;
  threshold: number;
  xGateThreshold?: number | null;
  learningMode?: LearningMode | null;
  authorHandle?: string | null;
  tags?: unknown[] | null;
  learnedBiases?: LearnedBiases | null;
  knnPrior?: number | null;
  knnPriorDetails?: KnnFeedbackPriorDetails | null;
  scoringV2?: Record<string, unknown> | null;
};

export type FeedbackBiasResult = {
  deliveryDecision: string;
  decisionReason: string | null;
  finalScore: number | null;
  baseScore: number | null;
  learnedScore: number | null;
  learnedDelta: number | null;
  xGateScore: number | null;
  learningConfidence: Record<string, unknown> | null;
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

function normalizeLearningMode(value: unknown): LearningMode {
  return value === "applied" || value === "human_only" ? value : "shadow";
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeKnnFeedbackPriorDetails(
  value: unknown,
): KnnFeedbackPriorDetails | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  return {
    prior: finiteNumber(record.prior),
    neighbor_count: finiteNumber(record.neighbor_count),
    positive_count: finiteNumber(record.positive_count),
    negative_count: finiteNumber(record.negative_count),
    recent_negative_count: finiteNumber(record.recent_negative_count),
    mean_similarity: finiteNumber(record.mean_similarity),
    max_similarity: finiteNumber(record.max_similarity),
  };
}

export function priorFromKnnFeedbackDetails(
  details: KnnFeedbackPriorDetails | null,
): number {
  return typeof details?.prior === "number" && Number.isFinite(details.prior)
    ? details.prior
    : 0;
}

function negativeLearningVetoAllowed(
  details: KnnFeedbackPriorDetails | null | undefined,
): { allowed: boolean; reason: string } {
  const neighborCount = finiteNumber(details?.neighbor_count) ?? 0;
  const negativeCount = finiteNumber(details?.negative_count) ?? 0;
  const recentNegativeCount = finiteNumber(details?.recent_negative_count) ?? 0;
  const meanSimilarity = finiteNumber(details?.mean_similarity) ?? 0;
  const maxSimilarity = finiteNumber(details?.max_similarity) ?? 0;

  if (neighborCount < 3) return { allowed: false, reason: "too_few_neighbors" };
  if (negativeCount < 2) {
    return { allowed: false, reason: "too_few_negative_neighbors" };
  }
  if (recentNegativeCount < 1) {
    return { allowed: false, reason: "no_recent_negative_neighbor" };
  }
  if (meanSimilarity < 0.82) {
    return { allowed: false, reason: "mean_similarity_too_low" };
  }
  if (maxSimilarity < 0.88) {
    return { allowed: false, reason: "max_similarity_too_low" };
  }
  return { allowed: true, reason: "high_confidence_negative_learning" };
}

export function applyLearnedFeedbackBias(
  input: FeedbackBiasInput,
): FeedbackBiasResult {
  const learningMode = normalizeLearningMode(input.learningMode);
  let deliveryDecision = input.deliveryDecision;
  let decisionReason = input.decisionReason;
  let finalScore = input.finalScore;

  if (finalScore === null) {
    return {
      deliveryDecision,
      decisionReason,
      finalScore,
      baseScore: null,
      learnedScore: null,
      learnedDelta: null,
      xGateScore: null,
      learningConfidence: null,
      scoreBreakdown: null,
    };
  }

  const aiFinal = finalScore;
  const baseScore = aiFinal;
  if (learningMode === "human_only") {
    const learningConfidence = {
      learning_mode: learningMode,
      applied_to_production: false,
      reason: "human_only",
    };
    return {
      deliveryDecision,
      decisionReason,
      finalScore: round1(baseScore),
      baseScore: round1(baseScore),
      learnedScore: round1(baseScore),
      learnedDelta: 0,
      xGateScore: round1(baseScore),
      learningConfidence,
      scoreBreakdown: {
        ai: round1(aiFinal),
        base: round1(baseScore),
        learned_delta: 0,
        learned: round1(baseScore),
        final: round1(baseScore),
        x_gate_score: round1(baseScore),
        x_gate: round1(baseScore),
        learning_confidence: learningConfidence,
        ...(input.scoringV2 ? { scoring_v2: input.scoringV2 } : {}),
      },
    };
  }

  const biases = input.learnedBiases ?? {};
  const authorKey = input.authorHandle ? input.authorHandle.toLowerCase() : "";
  const authorDelta = authorKey ? (biases.author_bias?.[authorKey] ?? 0) : 0;
  let tagDelta = 0;
  for (const tag of input.tags ?? []) {
    tagDelta += biases.tag_bias?.[String(tag).toLowerCase()] ?? 0;
  }
  tagDelta = clamp(tagDelta, -2, 2);

  const knnPrior =
    typeof input.knnPrior === "number" && Number.isFinite(input.knnPrior)
      ? input.knnPrior
      : 0;
  const totalBias = clamp(authorDelta + tagDelta + knnPrior, -5, 5);
  const learnedScore = clamp(round1(baseScore + totalBias), 1, 20);

  if (learningMode === "applied" && totalBias !== 0) {
    finalScore = learnedScore;
    if (input.filterEnabled && !input.scoreOnly) {
      if (
        finalScore >= input.threshold &&
        deliveryDecision === "skip" &&
        (decisionReason ?? "").startsWith("below_threshold")
      ) {
        deliveryDecision = "deliver";
        decisionReason = `feedback_boost:${aiFinal.toFixed(1)}+${
          totalBias.toFixed(1)
        }>=${input.threshold}`;
      } else if (
        finalScore < input.threshold &&
        deliveryDecision === "deliver" &&
        (decisionReason ?? "").startsWith("score_pass")
      ) {
        deliveryDecision = "skip";
        decisionReason = `feedback_reduce:${aiFinal.toFixed(1)}+${
          totalBias.toFixed(1)
        }<${input.threshold}`;
      }
    }
  }

  const learnedDelta = round3(learnedScore - baseScore);
  const xGateThreshold = typeof input.xGateThreshold === "number" &&
      Number.isFinite(input.xGateThreshold)
    ? input.xGateThreshold
    : input.threshold;
  const veto = negativeLearningVetoAllowed(input.knnPriorDetails);
  const negativeLearningWouldCrossXGate = learnedDelta < 0 &&
    baseScore >= xGateThreshold &&
    learnedScore < xGateThreshold;
  const xGateScore = learningMode === "applied"
    ? negativeLearningWouldCrossXGate && !veto.allowed
      ? baseScore
      : learnedScore
    : baseScore;
  const learningConfidence = {
    learning_mode: learningMode,
    applied_to_production: learningMode === "applied",
    knn_neighbor_count: input.knnPriorDetails?.neighbor_count ?? null,
    knn_positive_count: input.knnPriorDetails?.positive_count ?? null,
    knn_negative_count: input.knnPriorDetails?.negative_count ?? null,
    knn_recent_negative_count: input.knnPriorDetails?.recent_negative_count ??
      null,
    knn_mean_similarity: input.knnPriorDetails?.mean_similarity ?? null,
    knn_max_similarity: input.knnPriorDetails?.max_similarity ?? null,
    negative_learning_veto_allowed: veto.allowed,
    negative_learning_veto_reason: veto.reason,
    x_gate_threshold: xGateThreshold,
  };

  return {
    deliveryDecision,
    decisionReason,
    finalScore,
    baseScore: round1(baseScore),
    learnedScore: round1(learnedScore),
    learnedDelta,
    xGateScore: round1(xGateScore),
    learningConfidence,
    scoreBreakdown: {
      ai: round1(aiFinal),
      base: round1(baseScore),
      ...(authorDelta ? { author_bias: round3(authorDelta) } : {}),
      ...(tagDelta ? { tag_bias: round3(tagDelta) } : {}),
      ...(knnPrior ? { knn_prior: round3(knnPrior) } : {}),
      learned_delta: learnedDelta,
      learned: round1(learnedScore),
      final: round1(finalScore),
      x_gate_score: round1(xGateScore),
      x_gate: round1(xGateScore),
      learning_confidence: learningConfidence,
      ...(input.scoringV2 ? { scoring_v2: input.scoringV2 } : {}),
    },
  };
}
