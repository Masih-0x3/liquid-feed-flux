import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIncomingSettingsDraft, settingsSnapshotFingerprint, type IncomingSettingsDraft } from '@/hooks/useIncomingSettingsDraft';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { clearSettingsDraftSession, getSettingsDraftSession, onSettingsDraftSessionReset } from '@/components/settings/SettingsDraftSession';

type RetainedDraft = Pick<IncomingSettingsDraft<unknown>, 'baseline' | 'draft' | 'pendingIncoming'> & { label: string; incomingFingerprint: string };
const retainedDrafts = new Map<string, RetainedDraft>();
const listeners = new Set<() => void>();
const dashboardRoutes = new Set(['/', '/monitoring', '/video-renders', '/threads', '/x-account', '/downloader']);
let revision = 0;

function isDirty(draft: RetainedDraft) {
  return settingsSnapshotFingerprint(draft.baseline) !== settingsSnapshotFingerprint(draft.draft);
}

function hasDirtyDrafts() {
  return [...retainedDrafts.values()].some(isDirty);
}

function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasDirtyDrafts()) return;
  event.preventDefault();
  event.returnValue = '';
}

function changed() {
  revision += 1;
  if (typeof window !== 'undefined') {
    window.removeEventListener('beforeunload', warnBeforeUnload);
    if (hasDirtyDrafts()) window.addEventListener('beforeunload', warnBeforeUnload);
  }
  listeners.forEach((listener) => listener());
}

/** Drafts live only in this browser tab's memory. Authentication changes must clear them. */
// eslint-disable-next-line react-refresh/only-export-components
export function clearSettingsDrafts() {
  clearSettingsDraftSession();
}

onSettingsDraftSessionReset(() => {
  retainedDrafts.clear();
  changed();
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Preserves unfinished groups through tab changes and browser Back without writing private form data to storage. */
// eslint-disable-next-line react-refresh/only-export-components
export function useSettingsDraft<T>(scope: string, label: string, incoming: T): IncomingSettingsDraft<T> {
  const session = getSettingsDraftSession();
  const generation = useRef(session.generation);
  const scopedKey = `${session.identity ?? 'current-session'}:${scope}`;
  const previous = retainedDrafts.get(scopedKey);
  // Loading is not an authoritative null configuration. The page's read gate
  // still controls whether editing is available while its request settles.
  const effectiveIncoming = incoming == null && previous ? previous.baseline as T : incoming;
  const incomingFingerprint = incoming == null && previous ? previous.incomingFingerprint : settingsSnapshotFingerprint(incoming);
  const restored = useRef((() => {
    const cached = retainedDrafts.get(scopedKey);
    // A fresh authoritative snapshot replaces a clean cache. A stale pre-save
    // response must not undo an acknowledged save when a panel remounts.
    return cached && (isDirty(cached) || cached.pendingIncoming || cached.incomingFingerprint === incomingFingerprint) ? cached : undefined;
  })());
  const editor = useIncomingSettingsDraft(effectiveIncoming, restored.current as (Pick<IncomingSettingsDraft<T>, 'draft' | 'baseline' | 'pendingIncoming'> & { incomingFingerprint: string }) | undefined);
  const markSaved = editor.markSaved;

  useEffect(() => {
    if (generation.current !== getSettingsDraftSession().generation) return;
    const next = { baseline: editor.baseline, draft: editor.draft, pendingIncoming: editor.pendingIncoming, label, incomingFingerprint };
    if (settingsSnapshotFingerprint(retainedDrafts.get(scopedKey)) === settingsSnapshotFingerprint(next)) return;
    retainedDrafts.set(scopedKey, next);
    changed();
  }, [editor.baseline, editor.draft, editor.pendingIncoming, incomingFingerprint, label, scopedKey]);

  const acknowledgeSave = useCallback((saved: T) => {
    if (generation.current !== getSettingsDraftSession().generation) return;
    const cached = retainedDrafts.get(scopedKey);
    if (cached) {
      retainedDrafts.set(scopedKey, { ...cached, baseline: saved });
      changed();
    }
    markSaved(saved);
  }, [markSaved, scopedKey]);

  return { ...editor, markSaved: acknowledgeSave };
}

export function SettingsDraftGuard() {
  useSyncExternalStore(subscribe, () => revision, () => 0);
  const navigate = useNavigate();
  const [destination, setDestination] = useState<string | null>(null);
  const labels = [...retainedDrafts.values()].filter(isDirty).map((draft) => draft.label);

  useEffect(() => {
    const interceptNavigation = (event: MouseEvent) => {
      if (!hasDirtyDrafts() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.getAttribute('target') === '_blank' || anchor.hasAttribute('download')) return;
      const target = new URL(anchor.href);
      if (target.origin !== window.location.origin || !dashboardRoutes.has(target.pathname)) return;
      event.preventDefault();
      event.stopPropagation();
      setDestination(`${target.pathname}${target.search}${target.hash}`);
    };
    document.addEventListener('click', interceptNavigation, true);
    return () => document.removeEventListener('click', interceptNavigation, true);
  }, []);

  return <>
    {labels.length > 0 && <p role="status" className="text-sm text-amber-200">Unsaved changes: {labels.join(', ')}. Drafts remain when switching sections.</p>}
    <AlertDialog open={destination !== null} onOpenChange={(open) => { if (!open) setDestination(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave Settings with unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>Your drafts are kept in this tab while you use the dashboard. Save each group before closing or reloading the tab. Nothing has been applied to the pipeline.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction onClick={() => {
            if (!destination) return;
            navigate(destination);
            setDestination(null);
          }}>Leave and keep drafts</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

export function SettingsSaveStatus({ label, dirty, saving, error, saved, onSave, disabled = false }: {
  label: string; dirty: boolean; saving?: boolean; error?: unknown; saved?: boolean; onSave?: () => void; disabled?: boolean;
}) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background/80 p-3" data-settings-save>
    <p role="status" className={`text-sm ${error ? 'text-destructive' : 'text-muted-foreground'}`}>
      <span className="font-medium text-foreground">{label}: </span>
      {saving ? 'Saving…' : error ? 'Save failed. Your edits are retained; retry when ready.' : dirty ? 'Unsaved changes — save to apply.' : saved ? 'Saved.' : 'Changes require Save.'}
    </p>
    {onSave && <Button type="button" className="h-auto min-h-9 whitespace-normal" onClick={onSave} disabled={disabled || saving || !dirty} size="sm">Save {label}</Button>}
  </div>;
}

export function SettingsIncomingNotice({ editor }: { editor: Pick<IncomingSettingsDraft<unknown>, 'hasPendingIncoming' | 'pendingFields' | 'reloadIncoming' | 'keepEditing'> }) {
  if (!editor.hasPendingIncoming) return null;
  return <div role="alert" className="space-y-2 rounded-md border border-amber-400/40 bg-amber-500/10 p-3 text-sm">
    <p>New saved settings are available. Your draft is preserved. Changed fields: {editor.pendingFields.join(', ') || 'none'}.</p>
    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={editor.reloadIncoming}>Reload saved values</Button><Button type="button" size="sm" variant="outline" onClick={editor.keepEditing}>Keep editing</Button></div>
  </div>;
}

// Capture the submitted snapshot; an in-flight save must not acknowledge later edits.
// eslint-disable-next-line react-refresh/only-export-components
export function useSettingsSave<T>(editor: IncomingSettingsDraft<T>, persist: (snapshot: T) => Promise<unknown>) {
  const [state, setState] = useState<{ saving: boolean; error: boolean; saved: boolean }>({ saving: false, error: false, saved: false });
  const inFlight = useRef(false);
  const save = useCallback(async () => {
    if (inFlight.current || editor.hasPendingIncoming) return;
    inFlight.current = true;
    const snapshot = editor.draft;
    setState({ saving: true, error: false, saved: false });
    try {
      await persist(snapshot);
      editor.markSaved(snapshot);
      setState({ saving: false, error: false, saved: true });
    } catch {
      setState({ saving: false, error: true, saved: false });
    } finally {
      inFlight.current = false;
    }
  }, [editor, persist]);
  return { ...state, save };
}
