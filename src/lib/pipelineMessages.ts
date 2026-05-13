/**
 * Human-readable copy for pipeline / editorial codes shown in Monitoring.
 * Raw values stay available as `detail` for tooltips and support.
 */

import type { MonitoringEntry } from '@/hooks/useMonitoringData';

export interface FormattedPipelineLine {
  title: string;
  /** Original machine string for tooltips / debugging */
  detail?: string;
}

function withDetail(raw: string, title: string): FormattedPipelineLine {
  return { title, detail: raw };
}

/** Delivery / editorial `decision_reason` strings from worker or admin rescore. */
export function formatDecisionReason(reason: string | null | undefined): FormattedPipelineLine {
  if (reason == null || !String(reason).trim()) {
    return { title: 'No reason recorded' };
  }
  const r = String(reason).trim();

  const below = r.match(/^below_threshold:([\d.]+)<(\d+)/i);
  if (below) {
    return withDetail(r, `Below threshold (score ${below[1]} is under ${below[2]})`);
  }
  if (/^score_pass:/i.test(r)) {
    return withDetail(r, 'Met editorial threshold');
  }
  const auth = r.match(/^author_override:(always_deliver|always_skip):@(.+)$/i);
  if (auth) {
    return withDetail(r, auth[1] === 'always_deliver' ? `Author always deliver (@${auth[2]})` : `Author always skip (@${auth[2]})`);
  }
  const blocked = r.match(/^blocked_tag:(.+)$/i);
  if (blocked) return withDetail(r, `Blocked tag: ${blocked[1]}`);
  const excl = r.match(/^excluded_keyword:(.+)$/i);
  if (excl) return withDetail(r, `Excluded keyword: ${excl[1]}`);
  if (r === 'missing_required_tag' || /^missing_required_tag$/i.test(r)) {
    return withDetail(r, 'Missing a required tag');
  }
  const pass = r.match(/^score_pass:([\d.]+)>=(\d+)/i);
  if (pass) return withDetail(r, `Passed threshold (${pass[1]} ≥ ${pass[2]})`);
  const legacyPass = r.match(/^score_pass:(\d+)>=(\d+)/);
  if (legacyPass) return withDetail(r, `Passed threshold (${legacyPass[1]} ≥ ${legacyPass[2]})`);
  const legacyBelow = r.match(/^below_threshold:(\d+)<(\d+)/);
  if (legacyBelow) return withDetail(r, `Below threshold (${legacyBelow[1]} < ${legacyBelow[2]})`);
  if (/^author_rule:always_deliver:/i.test(r)) return withDetail(r, 'Author rule: always deliver');
  if (/^author_rule:always_skip:/i.test(r)) return withDetail(r, 'Author rule: always skip');
  if (r === 'dup_cleared_by_admin') return withDetail(r, 'Duplicate cleared by admin');
  const boost = r.match(/^feedback_boost:([\d.]+)\+([-\d.]+)>=(\d+)/);
  if (boost) return withDetail(r, `Feedback boosted: AI ${boost[1]} + bias ${boost[2]} met threshold ${boost[3]}`);
  const reduce = r.match(/^feedback_reduce:([\d.]+)\+([-\d.]+)<(\d+)/);
  if (reduce) return withDetail(r, `Feedback reduced: AI ${reduce[1]} + bias ${reduce[2]} below threshold ${reduce[3]}`);
  const dupOf = r.match(/^dup_of\s+(\S+)/);
  if (dupOf) return withDetail(r, `Duplicate of ${dupOf[1]}`);

  return withDetail(r, r.length > 72 ? `${r.slice(0, 69)}…` : r);
}

/** Generic pipeline errors (translation, Telegram, or X). */
export function formatPipelineError(raw: string | null | undefined): FormattedPipelineLine {
  if (raw == null || !String(raw).trim()) return { title: 'Unknown error' };
  const r = String(raw).trim();
  if (/^(media_|rate_limit|tweet )/i.test(r) || r.includes('media_required') || r.includes('missing data.id')) {
    return formatXSkipOrError(undefined, r);
  }
  return withDetail(r, r.length > 100 ? `${r.slice(0, 97)}…` : r);
}

/** X poster skip_reason and/or last_error (e.g. media_required:…, rate_limit_day). */
export function formatXSkipOrError(skip: string | null | undefined, err: string | null | undefined): FormattedPipelineLine {
  const raw = (err && err.trim()) || (skip && skip.trim()) || '';
  if (!raw) return { title: 'No details' };

  if (raw.startsWith('media_required:')) {
    const sub = raw.slice('media_required:'.length);
    const subHuman: Record<string, string> = {
      no_supported_media: 'No supported media file yet (X needs image/video bytes, not text-only for posts with media).',
      no_downloaded_media: 'Media not downloaded yet.',
    };
    return withDetail(raw, subHuman[sub] ?? `Media required: ${sub.replace(/_/g, ' ')}`);
  }
  if (raw.startsWith('media_upload_failed')) {
    return withDetail(raw, 'Media upload to X failed');
  }
  if (raw.startsWith('rate_limit_')) {
    const kind = raw.replace('rate_limit_', '');
    const map: Record<string, string> = {
      hour: 'X rate limit: hourly post cap reached',
      day: 'X rate limit: daily post cap reached',
      month: 'X rate limit: monthly post cap reached',
      media: 'X rate limit: media upload cap reached',
    };
    return withDetail(raw, map[kind] ?? 'X rate limit reached');
  }
  if (raw === 'disabled' || /skipped.*disabled/i.test(raw)) {
    return withDetail(raw, 'X posting is disabled in settings');
  }
  if (raw.startsWith('tweet ')) {
    return withDetail(raw, 'X API rejected the post');
  }
  if (raw.includes('missing data.id')) {
    return withDetail(raw, 'X API response missing tweet id');
  }

  return withDetail(raw, raw.length > 90 ? `${raw.slice(0, 87)}…` : raw);
}

/** Badge label + tooltip title for X row state. */
export function formatXBadge(entry: MonitoringEntry): { label: string; title: string } {
  const xs = entry.x_status;
  if (!xs) return { label: 'X: —', title: 'No X delivery row yet' };

  if (xs === 'posted') {
    return {
      label: 'X: Posted',
      title: entry.x_tweet_id ? `Open tweet ${entry.x_tweet_id}` : (entry.x_error || 'Posted (id missing — check logs)'),
    };
  }
  if (xs === 'failed') {
    const f = formatXSkipOrError(entry.x_skip_reason, entry.x_error);
    return { label: 'X: Failed', title: f.detail ?? f.title };
  }
  if (xs === 'skipped') {
    const f = formatXSkipOrError(entry.x_skip_reason, entry.x_error);
    const short = f.title.length > 48 ? `${f.title.slice(0, 45)}…` : f.title;
    return { label: `X: Skipped — ${short}`, title: f.detail ?? f.title };
  }
  if (xs === 'pending') {
    const f = formatXSkipOrError(entry.x_skip_reason, entry.x_error);
    return { label: 'X: Pending', title: f.detail ?? f.title };
  }
  return { label: `X: ${xs}`, title: entry.x_error || entry.x_skip_reason || xs };
}

export function decisionScore(entry: { final_score: number | null; importance_score: number | null }): number | null {
  if (entry.final_score != null) return entry.final_score;
  if (entry.importance_score != null) return entry.importance_score;
  return null;
}
