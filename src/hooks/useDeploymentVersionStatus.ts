import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invokeAdminAction } from '@/api/adminActions';

export interface BackendVersion {
  sha: string;
  deployed_at: string;
  ok?: boolean;
}

export type DeploymentMismatch = 'frontend_behind' | 'backend_behind' | 'revision_mismatch' | null;

export const frontendVersion = typeof __APP_VERSION_SHA__ !== 'undefined' ? __APP_VERSION_SHA__ : 'dev';
export const frontendBuildTime = typeof __APP_VERSION_TIME__ !== 'undefined' ? __APP_VERSION_TIME__ : '';

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

function knownRevision(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized && normalized !== 'unknown' && normalized !== 'dev' ? normalized : null;
}

function releaseTime(value: string | undefined): number | null {
  const timestamp = Date.parse(value ?? '');
  return Number.isFinite(timestamp) ? timestamp : null;
}

function revisionsMatch(frontendSha: string | undefined, backendSha: string | undefined): boolean {
  const frontend = knownRevision(frontendSha);
  const backend = knownRevision(backendSha);
  return Boolean(frontend && backend && (frontend === backend || frontend.startsWith(backend) || backend.startsWith(frontend)));
}

export function timeAgo(iso: string, now = Date.now()): string {
  const timestamp = releaseTime(iso);
  if (timestamp == null) return '';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function fullDate(iso: string): string {
  if (releaseTime(iso) == null) return 'unknown time';
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
  } catch {
    return iso;
  }
}

export function evaluateDeploymentVersion({
  backend,
  frontendSha,
  frontendTime,
  hasError,
  now = Date.now(),
}: {
  backend: BackendVersion | null;
  frontendSha: string;
  frontendTime: string;
  hasError: boolean;
  now?: number;
}) {
  const frontendTimeMs = releaseTime(frontendTime);
  const backendTimeMs = releaseTime(backend?.deployed_at);
  const frontendMetadataAvailable = Boolean(knownRevision(frontendSha) && frontendTimeMs != null);
  const backendMetadataAvailable = Boolean(backend && knownRevision(backend.sha) && backendTimeMs != null);
  const canCompare = frontendMetadataAvailable && backendMetadataAvailable;
  const sameRevision = revisionsMatch(frontendSha, backend?.sha);
  const uiMs = frontendTimeMs == null ? null : now - frontendTimeMs;
  const apiMs = backendTimeMs == null ? null : now - backendTimeMs;
  const uiStale = Boolean(canCompare && !sameRevision && uiMs != null && apiMs != null && uiMs > STALE_THRESHOLD_MS && uiMs > apiMs + STALE_THRESHOLD_MS);
  const apiStale = Boolean(canCompare && !sameRevision && uiMs != null && apiMs != null && apiMs > STALE_THRESHOLD_MS && apiMs > uiMs + STALE_THRESHOLD_MS);
  const mismatch: DeploymentMismatch = uiStale
    ? 'frontend_behind'
    : apiStale
      ? 'backend_behind'
      : canCompare && !sameRevision
        ? 'revision_mismatch'
        : null;

  return {
    backend,
    error: hasError,
    frontendSha,
    frontendTime,
    uiAge: frontendTimeMs == null ? '' : timeAgo(frontendTime, now),
    apiAge: backendTimeMs == null || !backend ? '' : timeAgo(backend.deployed_at, now),
    uiStale,
    apiStale,
    mismatch,
    backendMetadataAvailable,
    revisionsMatch: sameRevision,
    bothFresh: Boolean(canCompare && sameRevision && !hasError),
  };
}

export function getDeploymentVersionStatus(backend: BackendVersion | null, hasError: boolean, now = Date.now()) {
  return evaluateDeploymentVersion({
    backend,
    frontendSha: frontendVersion,
    frontendTime: frontendBuildTime,
    hasError,
    now,
  });
}

export function useDeploymentVersionStatus() {
  const [now, setNow] = useState(() => Date.now());
  const query = useQuery({
    queryKey: ['deployment-version'],
    queryFn: async () => {
      const data = await invokeAdminAction<BackendVersion>({ action: 'version' }, { throwOnFailure: false });
      if (!data?.ok) throw new Error('The backend version endpoint did not return a deploy revision.');
      return data;
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return {
    ...useMemo(() => getDeploymentVersionStatus(query.data ?? null, query.isError, now), [now, query.data, query.isError]),
    isChecking: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
