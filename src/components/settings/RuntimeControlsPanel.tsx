import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Loader2, LockKeyhole, PauseCircle, PlayCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { type RuntimeControlName, type RuntimeControls } from '@/api/runtimeControls';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useRuntimeControls, useUpdateRuntimeControls } from '@/hooks/useRuntimeControls';

type PendingChange = {
  name: RuntimeControlName;
  nextValue: boolean;
};

const CONTROL_LABELS: Record<RuntimeControlName, string> = {
  dedupe_enabled: 'OpenAI dedupe',
  translation_enabled: 'OpenAI translation',
};

function countFor(controls: RuntimeControls, key: string): number | undefined {
  return controls.queue_counts?.[key];
}

export default function RuntimeControlsPanel() {
  const { role, isAdmin } = useAuth();
  const isReadOnly = role === 'read_only';
  const canMutate = isAdmin === true && !isReadOnly;
  const { controls, loading, error } = useRuntimeControls();
  const updateMutation = useUpdateRuntimeControls();
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const saving = updateMutation.isPending;

  const effectiveError = localError ?? error;

  const confirmChange = async () => {
    if (!pendingChange || !controls || !canMutate) return;
    const { name, nextValue } = pendingChange;
    setLocalError(null);
    setSuccess(null);
    try {
      await updateMutation.mutateAsync({ control: name, enabled: nextValue });
      setPendingChange(null);
      setSuccess(`${CONTROL_LABELS[name]} ${nextValue ? 'enabled' : 'paused'}.`);
    } catch {
      setLocalError(`Could not update ${CONTROL_LABELS[name].toLowerCase()}. No change was applied.`);
    }
  };

  const openChangeDialog = (name: RuntimeControlName, nextValue: boolean) => {
    if (canMutate) setPendingChange({ name, nextValue });
  };

  return (
    <Card className="glass-card" data-testid="runtime-controls-panel">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-display text-glass-foreground">
          <LockKeyhole className="h-4 w-4 text-primary" aria-hidden="true" />
          {controls?.environment === 'preview' ? 'Preview' : controls?.environment === 'production' ? 'Production' : 'Runtime'} controls
        </CardTitle>
        <CardDescription>
          Dedupe and translation pause before new work is claimed. Existing leased work can finish.
          {isReadOnly || !canMutate ? ' Read-only access can view state but cannot change controls.' : ' Changes require confirmation.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {effectiveError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>Control state unavailable</AlertTitle>
            <AlertDescription>{effectiveError}</AlertDescription>
          </Alert>
        )}
        {success && (
          <Alert className="border-success/40 bg-success/10 text-success" role="status">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading runtime control state…
          </div>
        ) : controls ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              {(['dedupe_enabled', 'translation_enabled'] as const).map((name) => {
                const enabled = controls[name];
                const queuedKey = name === 'dedupe_enabled' ? 'dedupe_queued' : 'translation_queued';
                const deferredKey = name === 'dedupe_enabled' ? 'dedupe_deferred' : 'translation_deferred';
                const queued = countFor(controls, queuedKey);
                const deferred = countFor(controls, deferredKey);
                return (
                  <div key={name} className="rounded-md border border-border/60 bg-muted/20 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-glass-foreground">{CONTROL_LABELS[name]}</p>
                        <p className="text-xs text-muted-foreground">
                          {enabled ? 'New jobs may be claimed.' : 'New jobs remain pending while paused.'}
                        </p>
                      </div>
                      <Switch
                        checked={enabled}
                        disabled={!canMutate || saving}
                        onCheckedChange={(nextValue) => openChangeDialog(name, nextValue)}
                        aria-label={`${CONTROL_LABELS[name]} ${enabled ? 'enabled' : 'paused'}`}
                        aria-describedby={`${name}-description`}
                      />
                    </div>
                    <p id={`${name}-description`} className="sr-only">
                      {!canMutate ? 'Read-only access. This control is disabled.' : 'Changing this control requires confirmation.'}
                    </p>
                    {(queued !== undefined || deferred !== undefined) && (
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {queued !== undefined && <Badge variant="outline"><PlayCircle className="mr-1 h-3 w-3" aria-hidden="true" />{queued} queued</Badge>}
                        {deferred !== undefined && <Badge variant="outline"><PauseCircle className="mr-1 h-3 w-3" aria-hidden="true" />{deferred} deferred</Badge>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-400/30 bg-amber-500/10 p-3 text-sm">
              <LockKeyhole className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
              <span className="font-medium text-amber-100">
                {controls?.posting_mode === 'blocked'
                  ? `Posting locked in ${controls.environment === 'preview' ? 'Preview' : 'Production'}`
                  : controls?.posting_mode === 'enabled'
                    ? `Posting enabled in ${controls.environment === 'preview' ? 'Preview' : 'Production'}`
                    : 'Posting status unavailable'}
              </span>
              <span className="text-xs text-amber-100/75">
                {controls?.posting_mode === 'blocked' ? 'External posting has no enable control.' : 'External posting follows the server runtime gate.'}
              </span>
            </div>

            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              Last updated {new Date(controls.updated_at).toLocaleString()}
            </p>
          </>
        ) : null}
      </CardContent>

      <AlertDialog open={pendingChange !== null} onOpenChange={(open) => { if (!open && !saving) setPendingChange(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingChange ? `${pendingChange.nextValue ? 'Enable' : 'Pause'} ${CONTROL_LABELS[pendingChange.name]}?` : 'Confirm runtime control change'}</AlertDialogTitle>
            <AlertDialogDescription>
              This changes whether new {pendingChange?.name === 'dedupe_enabled' ? 'dedupe' : 'translation'} jobs can be claimed. Existing leased work can finish. Posting state remains server-controlled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void confirmChange(); }} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {saving ? 'Saving…' : 'Confirm change'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
