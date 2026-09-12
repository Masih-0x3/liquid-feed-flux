import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useRuntimeControls } from '@/hooks/useRuntimeControls';
import RuntimeControlsPanel from '@/components/settings/RuntimeControlsPanel';

/** Compact Settings disclosure; the audited runtime mutation panel stays unchanged. */
export function SettingsRuntimeControls() {
  const { controls, loading, error } = useRuntimeControls();
  const [expanded, setExpanded] = useState(false);
  const environment = controls?.environment === 'production' ? 'Production' : controls?.environment === 'preview' ? 'Preview' : 'Runtime';

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
      <p role="status" className="text-sm">
        <strong>{environment}</strong>
        {' · '}{loading ? 'Checking controls…' : error || !controls ? 'State unavailable' : `Posting ${controls.posting_mode} · Dedupe ${controls.dedupe_enabled ? 'on' : 'paused'} · Translation ${controls.translation_enabled ? 'on' : 'paused'}`}
      </p>
      <Button type="button" variant="outline" size="sm" aria-expanded={expanded} aria-controls="settings-runtime-controls" onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide runtime controls' : 'Runtime controls'}</Button>
    </div>
    <div id="settings-runtime-controls" hidden={!expanded}>{expanded && <RuntimeControlsPanel />}</div>
  </div>;
}
