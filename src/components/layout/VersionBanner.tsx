import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AlertCircle, CheckCircle2, RefreshCw, Cloud, Monitor } from 'lucide-react';

interface BackendVersion {
  sha: string;
  deployed_at: string;
}

const frontendSha = typeof __APP_VERSION_SHA__ !== 'undefined' ? __APP_VERSION_SHA__ : 'dev';
const frontendTime = typeof __APP_VERSION_TIME__ !== 'undefined' ? __APP_VERSION_TIME__ : '';

function timeAgo(iso: string): string {
  if (!iso) return '';
  try {
    const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  } catch { return ''; }
}

function fullDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
  } catch { return iso; }
}

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

export function VersionBanner() {
  const [backend, setBackend] = useState<BackendVersion | null>(null);
  const [error, setError] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: fnErr } = await supabase.functions.invoke('admin-actions', {
          body: { action: 'version' },
        });
        if (cancelled) return;
        if (fnErr || !data?.ok) { setError(true); return; }
        setBackend(data as BackendVersion);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const uiAge = timeAgo(frontendTime);
  const apiAge = backend ? timeAgo(backend.deployed_at) : '';

  const uiMs = frontendTime ? Date.now() - new Date(frontendTime).getTime() : 0;
  const apiMs = backend?.deployed_at ? Date.now() - new Date(backend.deployed_at).getTime() : 0;
  const uiStale = frontendSha !== 'dev' && uiMs > STALE_THRESHOLD_MS && uiMs > apiMs + STALE_THRESHOLD_MS;
  const apiStale = backend && backend.sha !== 'unknown' && apiMs > STALE_THRESHOLD_MS && apiMs > uiMs + STALE_THRESHOLD_MS;
  const bothFresh = backend && !error && !uiStale && !apiStale && frontendSha !== 'dev';

  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 select-none sm:w-auto sm:justify-end">
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] cursor-default ${
          uiStale
            ? 'bg-amber-500/10 text-amber-400'
            : 'bg-muted/60 text-muted-foreground'
        }`}
        title={
          `Dashboard (what you see in the browser)\n` +
          `Version: ${frontendSha}\n` +
          (frontendTime ? `Built: ${fullDate(frontendTime)}\n` : '') +
          (uiStale
            ? `\n⚠ This build is behind the backend.\nDeploy the latest GitHub commit to Vercel.`
            : `\nThis is up to date.`)
        }
      >
        <Monitor className="w-3 h-3" />
        <span className="hidden sm:inline">Dashboard</span>
        <span className="sm:hidden">UI</span>
        {uiAge && <span className="hidden min-[420px]:inline"> · {uiAge}</span>}
      </span>

      {error ? (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive cursor-default"
          title={
            `Backend API (Supabase Edge Functions)\n` +
            `Status: OFFLINE\n\n` +
            `Cannot reach the backend. Check the Supabase dashboard for errors.`
          }
        >
          <AlertCircle className="w-3 h-3" />
          <span>API offline</span>
        </span>
      ) : !backend ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground">
          <RefreshCw className="w-3 h-3 animate-spin" />
          <span className="hidden min-[420px]:inline">Checking…</span>
          <span className="min-[420px]:hidden">API</span>
        </span>
      ) : (
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] cursor-default ${
            apiStale
              ? 'bg-amber-500/10 text-amber-400'
              : 'bg-muted/60 text-muted-foreground'
          }`}
          title={
            `Backend API (Supabase Edge Functions)\n` +
            `Version: ${backend.sha}\n` +
            `Deployed: ${fullDate(backend.deployed_at)}\n` +
            (apiStale
              ? `\n⚠ The backend is behind the dashboard.\nRun: ./scripts/deploy-functions.sh`
              : `\nThis is up to date.`)
          }
        >
          <Cloud className="w-3 h-3" />
          API{apiAge && <span className="hidden min-[420px]:inline"> · {apiAge}</span>}
        </span>
      )}

      {bothFresh && (
        <span title="Both dashboard and backend are recently deployed. Everything looks good.">
          <CheckCircle2 className="w-3 h-3 text-green-500 cursor-default" />
        </span>
      )}
    </div>
  );
}
