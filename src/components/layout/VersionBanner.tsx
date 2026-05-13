import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AlertCircle, CheckCircle2, RefreshCw, Cloud, Monitor } from 'lucide-react';

interface BackendVersion {
  sha: string;
  deployed_at: string;
  function: string;
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

  const matched = backend && frontendSha !== 'dev' && backend.sha !== 'unknown' && backend.sha === frontendSha;
  const mismatched = backend && frontendSha !== 'dev' && backend.sha !== 'unknown' && backend.sha !== frontendSha;

  const uiAge = timeAgo(frontendTime);
  const apiAge = backend ? timeAgo(backend.deployed_at) : '';

  return (
    <div className="flex flex-col items-end gap-0.5 select-none">
      {/* Top row: version pills */}
      <div className="flex items-center gap-1.5">
        <span
          className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground cursor-default"
          title={
            `Dashboard (frontend)\n` +
            `Version: ${frontendSha}\n` +
            (frontendTime ? `Built: ${fullDate(frontendTime)}\n` : '') +
            `\nThis is the code running in your browser.\n` +
            `If this says "dev", Lovable hasn't rebuilt from GitHub yet.`
          }
        >
          <Monitor className="w-3 h-3" />
          Dashboard {uiAge ? `· ${uiAge}` : ''}
        </span>

        {error ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive cursor-default"
            title={
              `Backend API (Edge Functions)\n` +
              `Status: OFFLINE — cannot reach admin-actions\n\n` +
              `The Supabase backend is not responding.\n` +
              `Check the Supabase dashboard for errors.`
            }
          >
            <AlertCircle className="w-3 h-3" />
            API offline
          </span>
        ) : !backend ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Checking API…
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground cursor-default"
            title={
              `Backend API (Edge Functions)\n` +
              `Version: ${backend.sha}\n` +
              `Deployed: ${fullDate(backend.deployed_at)}\n` +
              `\nThis is the code running on Supabase servers.\n` +
              `Updated by deploying Edge Functions.`
            }
          >
            <Cloud className="w-3 h-3" />
            API {apiAge ? `· ${apiAge}` : ''}
          </span>
        )}

        {matched && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-400 cursor-default"
            title={
              `Everything is in sync!\n\n` +
              `Dashboard and API are running the same version (${frontendSha}).\n` +
              `All recent changes are live.`
            }
          >
            <CheckCircle2 className="w-3 h-3" />
          </span>
        )}

        {mismatched && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400 cursor-default"
            title={
              `Dashboard and API are out of sync!\n\n` +
              `Dashboard version: ${frontendSha}\n` +
              `API version: ${backend!.sha}\n\n` +
              `This means one side was updated but the other wasn't.\n` +
              `• If Dashboard is older → sync from GitHub in Lovable\n` +
              `• If API is older → run: ./scripts/deploy-functions.sh`
            }
          >
            <AlertCircle className="w-3 h-3" />
            Out of sync
          </span>
        )}
      </div>
    </div>
  );
}
