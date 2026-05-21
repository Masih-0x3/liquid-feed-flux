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

const DIRECT_IRAN_TERMS = [
  'iran', 'iranian', 'tehran', 'irgc', 'sepah', 'qeshm', 'hormuz', 'persian gulf',
  'israel-iran', 'us-iran', 'u.s.-iran', 'iran nuclear', 'khamenei',
];

const HIGH_IMPACT_IRAN_TERMS = [
  'trump', 'netanyahu', 'president', 'prime minister', 'foreign minister', 'army chief',
  'idf', 'us military', 'u.s. military', 'refueling tanker', 'drone', 'air defense',
  'strike', 'attack', 'war', 'military', 'nuclear', 'sanction', 'negotiation', 'talks',
  'agreement', 'final draft', 'ceasefire', 'peace talks', 'assassinat', 'threat',
  'hezbollah', 'houthi', 'militia', 'proxy',
];

const VERY_HIGH_IRAN_TERMS = [
  'refueling tanker', 'air defense', 'drone', 'strike', 'attack', 'assassinat',
  'threat', 'war', 'nuclear', 'destroyed',
];

function hasAnyTerm(haystack: string, terms: string[]): boolean {
  return terms.some((term) => haystack.includes(term));
}

function clampFinalScore(score: number): number {
  return Math.max(0, Math.min(20, Math.round(score * 10) / 10));
}

function applyIranFirstSignalFloor(input: {
  finalScore: number;
  legacyScore: number | null;
  axes: ScoreAxes | null;
  tags: string[];
  text: string;
}): { finalScore: number; reasonSuffix: string } {
  const legacy = typeof input.legacyScore === 'number' && Number.isFinite(input.legacyScore)
    ? input.legacyScore
    : null;
  let finalScore = legacy === null ? input.finalScore : Math.max(input.finalScore, legacy);
  let reasonSuffix = legacy !== null && finalScore > input.finalScore ? ':legacy_floor' : '';

  const haystack = `${input.text || ''} ${(input.tags || []).join(' ')}`.toLowerCase();
  const iranAxis = input.axes?.iran_relevance ?? 0;
  const severity = input.axes?.severity ?? 0;
  const actionability = input.axes?.actionability ?? 0;
  const noise = input.axes?.noise ?? 0;
  const directIran = iranAxis >= 6 || hasAnyTerm(haystack, DIRECT_IRAN_TERMS);
  const highImpact = hasAnyTerm(haystack, HIGH_IMPACT_IRAN_TERMS);
  const veryHighImpact = hasAnyTerm(haystack, VERY_HIGH_IRAN_TERMS);
  const currentSignal = legacy ?? finalScore;

  if (directIran && noise <= 3 && highImpact && currentSignal >= 12.5 && finalScore < 17) {
    finalScore = 17;
    reasonSuffix += ':iran_high_signal_floor';
  }
  if (directIran && noise <= 3 && (veryHighImpact || severity >= 4 || actionability >= 5) && currentSignal >= 15 && finalScore < 18) {
    finalScore = 18;
    reasonSuffix += ':iran_very_high_signal_floor';
  }

  return { finalScore: clampFinalScore(finalScore), reasonSuffix };
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
  let reasonSuffix = '';
  if (profile.id === 'iran-war-default' || profile.id === 'iran-first' || /iran/i.test(profile.name || '')) {
    const adjusted = applyIranFirstSignalFloor({
      finalScore,
      legacyScore,
      axes,
      tags,
      text,
    });
    finalScore = adjusted.finalScore;
    reasonSuffix = adjusted.reasonSuffix;
  }

  let boost = 0;
  for (const kw of profile.must_include_keywords || []) {
    if (kw && norm.includes(kw.toLowerCase())) boost += 2;
  }
  if (boost > 0) finalScore = Math.min(20, finalScore + boost);

  if (finalScore >= profile.threshold) {
    return { decision: 'deliver', reason: `score_pass:${finalScore.toFixed(1)}>=${profile.threshold}${boost ? `(+${boost} kw)` : ''}${reasonSuffix}`, finalScore };
  }
  return { decision: 'skip', reason: `below_threshold:${finalScore.toFixed(1)}<${profile.threshold}${reasonSuffix}`, finalScore };
}
