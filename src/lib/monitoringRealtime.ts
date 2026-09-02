import type {
  MonitoringEntry,
  MonitoringFilter,
  MonitoringPage,
  ScoreBucket,
} from '@/api/monitoringData';

export const MONITORING_QUERY_ROOT = ['monitoring'] as const;
export const MONITORING_REALTIME_TABLES = [
  'posts',
  'jobs',
  'deliveries',
  'x_deliveries',
  'workflow_runs',
  'ai_call_ledger',
] as const;
export const MAX_MONITORING_REALTIME_STALENESS_MS = 15_000;

export interface MonitoringQueryShape {
  filter: MonitoringFilter;
  search: string;
  scoreBucket: ScoreBucket;
}

export interface MonitoringInfiniteData {
  pages: MonitoringPage[];
  pageParams: unknown[];
}

export type MonitoringInfinitePatchOutcome =
  | 'replaced'
  | 'unchanged'
  | 'resync_required';

export interface MonitoringInfinitePatchResult {
  data: MonitoringInfiniteData | undefined;
  outcome: MonitoringInfinitePatchOutcome;
}

export interface MonitoringRealtimePayload {
  table?: string;
  new?: unknown;
  old?: unknown;
}

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function realtimeRecord(payload: MonitoringRealtimePayload): RecordValue | null {
  const next = asRecord(payload.new);
  if (next && Object.keys(next).length > 0) return next;
  return asRecord(payload.old);
}

function cachedTweetIdsForWorkflowRun(entries: MonitoringEntry[], workflowRunKey: string): string[] {
  return entries
    .filter((entry) => {
      const observability = entry.process_observability;
      if (!observability) return false;
      const runs = [observability.latest_run, ...observability.recent_runs].filter(Boolean);
      return runs.some((run) => run?.run_key === workflowRunKey);
    })
    .map((entry) => entry.tweet_id);
}

/**
 * Realtime rows are deliberately treated as routing hints, not MonitoringEntry
 * replacements. Some supporting tables use a direct post key, while an AI-call
 * event can only be resolved through a workflow run already present in cache.
 */
export function resolveMonitoringRealtimeTweetIds(
  payload: MonitoringRealtimePayload,
  cachedEntries: MonitoringEntry[],
): string[] {
  const row = realtimeRecord(payload);
  if (!row) return [];

  let ids: string[] = [];
  switch (payload.table) {
    case 'posts': {
      const tweetId = nonEmptyString(row.tweet_id);
      if (tweetId) ids = [tweetId];
      break;
    }
    case 'jobs': {
      const jobPayload = asRecord(row.payload);
      const tweetId = nonEmptyString(jobPayload?.tweet_id);
      if (tweetId) ids = [tweetId];
      break;
    }
    case 'deliveries': {
      const subjectType = nonEmptyString(row.subject_type);
      const tweetId = subjectType === 'post' ? nonEmptyString(row.subject_id) : null;
      if (tweetId) ids = [tweetId];
      break;
    }
    case 'x_deliveries': {
      const tweetId = nonEmptyString(row.post_id);
      if (tweetId) ids = [tweetId];
      break;
    }
    case 'workflow_runs': {
      const tweetId = nonEmptyString(row.tweet_id);
      if (tweetId) ids = [tweetId];
      break;
    }
    case 'ai_call_ledger': {
      const workflowRunKey = nonEmptyString(row.workflow_run_key);
      if (workflowRunKey) ids = cachedTweetIdsForWorkflowRun(cachedEntries, workflowRunKey);
      break;
    }
  }

  return [...new Set(ids)];
}

export function monitoringQueryShape(queryKey: readonly unknown[]): MonitoringQueryShape | null {
  if (
    queryKey.length !== 4 ||
    queryKey[0] !== MONITORING_QUERY_ROOT[0] ||
    typeof queryKey[1] !== 'string' ||
    typeof queryKey[2] !== 'string' ||
    typeof queryKey[3] !== 'string'
  ) {
    return null;
  }
  return {
    filter: queryKey[1] as MonitoringFilter,
    search: queryKey[2],
    scoreBucket: queryKey[3] as ScoreBucket,
  };
}

/**
 * Keep a trailing debounce responsive while bounding a continuous known-event
 * burst. The caller preserves firstEventAt until the pending batch is flushed.
 */
export function monitoringPatchFlushDelay(
  now: number,
  firstEventAt: number,
  debounceMs: number,
): number {
  const maxDeadline = firstEventAt + MAX_MONITORING_REALTIME_STALENESS_MS;
  return Math.max(0, Math.min(Math.max(0, debounceMs), maxDeadline - now));
}

/**
 * A known entity keeps its original maximum-staleness deadline until a latest
 * successful exact refresh settles it. Later events advance the generation,
 * but cannot keep moving the deadline further into the future.
 */
export function monitoringEntityRefreshDueAt(
  existingDueAt: number | null,
  now: number,
): number {
  return existingDueAt ?? now + MAX_MONITORING_REALTIME_STALENESS_MS;
}

export function nextMonitoringRealtimeGeneration(
  currentGeneration: number | undefined,
): number {
  return (currentGeneration ?? 0) + 1;
}

export function isCurrentMonitoringRealtimeGeneration(
  currentGeneration: number | undefined,
  candidateGeneration: number,
): boolean {
  return currentGeneration === candidateGeneration;
}

/**
 * The exact-entry read has already applied the target query's filter/search/
 * score bucket. Monitoring pages use offset cursors, so only a stable in-page
 * replacement is locally safe. Membership transitions must be resynced rather
 * than inserted or removed, otherwise a later Load more can duplicate or skip
 * a page-boundary row.
 */
export function patchMonitoringInfiniteData(
  data: MonitoringInfiniteData | undefined,
  tweetId: string,
  nextEntry: MonitoringEntry | null,
): MonitoringInfinitePatchResult {
  if (!data || data.pages.length === 0) {
    return { data, outcome: 'resync_required' };
  }

  const matches: Array<{ pageIndex: number; entryIndex: number; entry: MonitoringEntry }> = [];
  data.pages.forEach((page, pageIndex) => {
    page.entries.forEach((entry, entryIndex) => {
      if (entry.tweet_id === tweetId) matches.push({ pageIndex, entryIndex, entry });
    });
  });

  if (matches.length === 0) {
    return { data, outcome: nextEntry ? 'resync_required' : 'unchanged' };
  }
  if (!nextEntry || matches.length !== 1) {
    return { data, outcome: 'resync_required' };
  }

  const match = matches[0];
  if (match.entry.created_at !== nextEntry.created_at) {
    return { data, outcome: 'resync_required' };
  }

  const pages = data.pages.map((page, pageIndex) => {
    if (pageIndex !== match.pageIndex) return page;
    const entries = page.entries.map((entry, entryIndex) =>
      entryIndex === match.entryIndex ? nextEntry : entry
    );
    return { ...page, entries };
  });
  return { data: { ...data, pages }, outcome: 'replaced' };
}
