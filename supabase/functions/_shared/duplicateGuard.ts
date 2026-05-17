export interface DuplicateGateFields {
  dedupe_status?: string | null;
  dup_of_tweet_id?: string | null;
  dedupe_reason?: string | null;
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function duplicateBlockTarget(post: DuplicateGateFields | null | undefined): string | null {
  if (!post) return null;
  const explicitTarget = clean(post.dup_of_tweet_id);
  if (explicitTarget) return explicitTarget;
  return post.dedupe_status === 'duplicate' ? 'duplicate' : null;
}

export function duplicateDecisionPatch(post: DuplicateGateFields | null | undefined): {
  delivery_decision: 'skip';
  decision_reason: string;
} | null {
  const target = duplicateBlockTarget(post);
  if (!target) return null;
  const method = clean(post?.dedupe_reason)?.startsWith('duplicate_gate:')
    ? clean(post?.dedupe_reason)
    : null;
  return {
    delivery_decision: 'skip',
    decision_reason: method ?? `duplicate_gate:${target}`,
  };
}

export function duplicateXSkipReason(post: DuplicateGateFields | null | undefined): string | null {
  const target = duplicateBlockTarget(post);
  if (!target) return null;
  return `duplicate_gate:${target}`.slice(0, 240);
}
