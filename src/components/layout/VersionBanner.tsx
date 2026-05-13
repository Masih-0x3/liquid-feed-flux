import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';

interface BackendVersion {
  sha: string;
  deployed_at: string;
  function: string;
}

const frontendSha = typeof __APP_VERSION_SHA__ !== 'undefined' ? __APP_VERSION_SHA__ : 'dev';
const frontendTime = typeof __APP_VERSION_TIME__ !== 'undefined' ? __APP_VERSION_TIME__ : '';

function shortTime(iso: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch { return iso.slice(0, 16); }
}

export function VersionBanner() {
  const [backend, setBackend] = useState<BackendVersion | null>(null);
  const [error, setError] = useState(false);

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

  const matched = backend && frontendSha !== 'dev' && backend.sha !== 'unknown' && backend.sha === frontendSha;
  const mismatched = backend && frontendSha !== 'dev' && backend.sha !== 'unknown' && backend.sha !== frontendSha;

  return (
    <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono select-none">
      <span title={`Built: ${frontendTime}`}>
        UI: {frontendSha}
      </span>
      <span className="opacity-40">|</span>
      {error ? (
        <span className="text-destructive" title="Could not reach admin-actions">
          <AlertCircle className="w-3 h-3 inline mr-0.5" />API: offline
        </span>
      ) : !backend ? (
        <span><RefreshCw className="w-3 h-3 inline mr-0.5 animate-spin" />API: checking</span>
      ) : (
        <span title={`Deployed: ${backend.deployed_at}`}>
          API: {backend.sha}
        </span>
      )}
      {matched && (
        <CheckCircle2 className="w-3 h-3 text-green-500" title="Frontend and backend are in sync" />
      )}
      {mismatched && (
        <span className="inline-flex items-center gap-0.5 text-amber-400" title={`Frontend (${frontendSha}) ≠ Backend (${backend!.sha}) — one side has newer code`}>
          <AlertCircle className="w-3 h-3" />out of sync
        </span>
      )}
    </div>
  );
}
