import { AlertCircle, CheckCircle2, Cloud, Monitor, RefreshCw } from 'lucide-react';
import { fullDate, useDeploymentVersionStatus } from '@/hooks/useDeploymentVersionStatus';

export function VersionBanner() {
  const {
    apiAge,
    apiStale,
    backend,
    backendMetadataAvailable,
    bothFresh,
    error,
    frontendSha,
    frontendTime,
    isChecking,
    mismatch,
    uiAge,
    uiStale,
  } = useDeploymentVersionStatus();

  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 select-none sm:w-auto sm:justify-end" aria-label="Deployment revision status">
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] cursor-default ${
          uiStale ? 'bg-amber-500/10 text-amber-400' : 'bg-muted/60 text-muted-foreground'
        }`}
        title={
          `Dashboard (what you see in the browser)\n` +
          `Version: ${frontendSha}\n` +
          (frontendTime ? `Built: ${fullDate(frontendTime)}\n` : '') +
          (uiStale ? '\nThis build is behind the backend. Review the Dashboard deployment alert.' : mismatch === 'revision_mismatch' ? '\nThis revision differs from the backend. Review the Dashboard deployment alert.' : '\nThis is up to date.')
        }
      >
        <Monitor className="w-3 h-3" />
        <span className="hidden sm:inline">Dashboard</span>
        <span className="sm:hidden">UI</span>
        {uiAge && <span className="hidden min-[420px]:inline"> · {uiAge}</span>}
      </span>

      {error || (!isChecking && backend && !backendMetadataAvailable) ? (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive cursor-default"
          title={error ? 'Backend API (Supabase Edge Functions) could not return a version revision.' : 'Backend API release metadata is missing or invalid.'}
        >
          <AlertCircle className="w-3 h-3" />
          <span>API unknown</span>
        </span>
      ) : isChecking || !backend ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground">
          <RefreshCw className="w-3 h-3 animate-spin" />
          <span className="hidden min-[420px]:inline">Checking…</span>
          <span className="min-[420px]:hidden">API</span>
        </span>
      ) : (
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] cursor-default ${
            apiStale ? 'bg-amber-500/10 text-amber-400' : 'bg-muted/60 text-muted-foreground'
          }`}
          title={
            `Backend API (Supabase Edge Functions)\n` +
            `Version: ${backend.sha}\n` +
            `Deployed: ${fullDate(backend.deployed_at)}\n` +
            (apiStale ? '\nThe backend is behind the dashboard. Review the Dashboard deployment alert.' : mismatch === 'revision_mismatch' ? '\nThis revision differs from the dashboard. Review the Dashboard deployment alert.' : '\nThis is up to date.')
          }
        >
          <Cloud className="w-3 h-3" />
          API{apiAge && <span className="hidden min-[420px]:inline"> · {apiAge}</span>}
        </span>
      )}

      {bothFresh && (
        <span title="Dashboard and backend release revisions match.">
          <CheckCircle2 className="w-3 h-3 text-green-500 cursor-default" />
        </span>
      )}
    </div>
  );
}
