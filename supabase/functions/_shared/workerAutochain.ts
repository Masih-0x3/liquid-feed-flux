export const AUTOCHAIN_JOB_TYPES = ['dedupe', 'translate', 'deliver', 'resolve_media', 'download_media'] as const;
export const AUTOCHAIN_MAX_DEPTH = 3;
export const AUTOCHAIN_DUE_WINDOW_MS = 1500;

export function normalizeChainDepth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function selectAutochainJobTypes(requested: string[] | null | undefined): string[] {
  if (!requested || requested.length === 0) return [...AUTOCHAIN_JOB_TYPES];
  const allowed = new Set<string>(AUTOCHAIN_JOB_TYPES);
  return requested.filter((type) => allowed.has(type));
}

export function shouldAutochain(params: {
  chainDepth: number;
  pendingCount: number;
  maxDepth?: number;
}): boolean {
  const maxDepth = params.maxDepth ?? AUTOCHAIN_MAX_DEPTH;
  return params.pendingCount > 0 && params.chainDepth < maxDepth;
}
