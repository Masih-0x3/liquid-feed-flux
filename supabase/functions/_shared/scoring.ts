// Multi-axis scoring (PR1) + editorial profile decision (PR2).
// Shared by worker and admin-actions runRescore — pure functions only.

export const SCORE_AXIS_KEYS = [
  'iran_relevance',
  'severity',
  'novelty',
  'credibility',
  'actionability',
  'noise',
] as const;
export type ScoreAxisKey = typeof SCORE_AXIS_KEYS[number];
export type ScoreAxes = Partial<Record<ScoreAxisKey, number>>;

const DEFAULT_AXIS_WEIGHTS: Record<ScoreAxisKey, number> = {
  iran_relevance: 1.0,
  severity: 1.0,
  novelty: 1.0,
  credibility: 0.5,
  actionability: 1.0,
  noise: 1.0, // subtractive
};

/** Parse and clamp axes from arbitrary tool-call output. Returns null if no usable axes. */
export function parseScoreAxes(raw: unknown): ScoreAxes | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const out: ScoreAxes = {};
  let hasAny = false;
  for (const k of SCORE_AXIS_KEYS) {
    const v = src[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = Math.max(0, Math.min(10, Math.round(v)));
      hasAny = true;
    }
  }
  return hasAny ? out : null;
}

/**
 * Compute final_score (0-20) from axes using a weights map.
 * Formula: positive_sum = Σ(axis * weight) for non-noise axes; subtract noise * weight.
 * Then normalize to 0-20 against the maximum possible positive sum.
 */
export function computeFinalScore(
  axes: ScoreAxes,
  weights: Record<ScoreAxisKey, number> = DEFAULT_AXIS_WEIGHTS,
): number {
  let posSum = 0;
  let posMax = 0;
  for (const k of SCORE_AXIS_KEYS) {
    if (k === 'noise') continue;
    const w = Math.max(0, weights[k] ?? 0);
    posSum += (axes[k] ?? 0) * w;
    posMax += 10 * w;
  }
  const noiseW = Math.max(0, weights.noise ?? 0);
  const noisePenalty = (axes.noise ?? 0) * noiseW;
  const noiseMax = 10 * noiseW;

  const positiveNorm = posMax > 0 ? (posSum / posMax) * 20 : 0;
  const noiseNorm = noiseMax > 0 ? (noisePenalty / noiseMax) * 8 : 0;
  return Math.max(0, Math.min(20, Math.round((positiveNorm - noiseNorm) * 10) / 10));
}

export interface EditorialProfile {
  id: string;
  name: string;
  weights: Record<ScoreAxisKey, number>;
  threshold: number;
  must_include_keywords: string[];
  must_exclude_keywords: string[];
  required_tags_any: string[];
  blocked_tags: string[];
  author_overrides: Record<string, 'always_deliver' | 'always_skip'>;
  editorial_note?: string;
}

export interface ProfileDecisionInput {
  profile: EditorialProfile;
  axes: ScoreAxes | null;
  legacyScore: number | null;
  tags: string[];
  text: string;
  authorHandle: string | null;
}

export interface ProfileDecisionResult {
  decision: 'deliver' | 'skip';
  reason: string;
  finalScore: number;
}

/** Apply hard rules + weighted formula. Returns final decision + reason. */
export function applyProfileDecision(input: ProfileDecisionInput): ProfileDecisionResult {
  const { profile, axes, legacyScore, tags, text, authorHandle } = input;
  const norm = (text || '').toLowerCase();
  const handle = (authorHandle || '').toLowerCase();
  const tagSet = new Set((tags || []).map((t) => String(t).toLowerCase()));

  if (handle && profile.author_overrides) {
    for (const [h, rule] of Object.entries(profile.author_overrides)) {
      if (h.toLowerCase().replace(/^@/, '') === handle.replace(/^@/, '')) {
        const finalScore = axes ? computeFinalScore(axes, profile.weights) : (legacyScore ?? 0);
        return { decision: rule === 'always_deliver' ? 'deliver' : 'skip', reason: `author_override:${rule}:@${handle}`, finalScore };
      }
    }
  }

  for (const t of profile.blocked_tags || []) {
    if (tagSet.has(t.toLowerCase())) {
      return { decision: 'skip', reason: `blocked_tag:${t}`, finalScore: 0 };
    }
  }

  if ((profile.required_tags_any || []).length > 0) {
    const ok = profile.required_tags_any.some((t) => tagSet.has(t.toLowerCase()));
    if (!ok) return { decision: 'skip', reason: `missing_required_tag`, finalScore: 0 };
  }

  for (const kw of profile.must_exclude_keywords || []) {
    if (kw && norm.includes(kw.toLowerCase())) {
      return { decision: 'skip', reason: `excluded_keyword:${kw}`, finalScore: 0 };
    }
  }

  let finalScore = axes ? computeFinalScore(axes, profile.weights) : (legacyScore ?? 0);

  let boost = 0;
  for (const kw of profile.must_include_keywords || []) {
    if (kw && norm.includes(kw.toLowerCase())) boost += 2;
  }
  if (boost > 0) finalScore = Math.min(20, finalScore + boost);

  if (finalScore >= profile.threshold) {
    return { decision: 'deliver', reason: `score_pass:${finalScore.toFixed(1)}>=${profile.threshold}${boost ? `(+${boost} kw)` : ''}`, finalScore };
  }
  return { decision: 'skip', reason: `below_threshold:${finalScore.toFixed(1)}<${profile.threshold}`, finalScore };
}
