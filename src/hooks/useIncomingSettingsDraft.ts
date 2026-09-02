import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type DraftUpdate<T> = T | ((current: T) => T);

interface PendingIncoming<T> {
  snapshot: T;
  fingerprint: string;
}

export interface IncomingSettingsDraft<T> {
  draft: T;
  baseline: T;
  dirtyFields: string[];
  pendingFields: string[];
  isDirty: boolean;
  hasPendingIncoming: boolean;
  updateDraft: (next: DraftUpdate<T>) => void;
  reloadIncoming: () => void;
  keepEditing: () => void;
  markSaved: (saved: T) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeForFingerprint(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForFingerprint);
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, normalizeForFingerprint(value[key])]),
    );
  }

  return value;
}

export function settingsSnapshotFingerprint(value: unknown): string {
  return JSON.stringify(normalizeForFingerprint(value)) ?? 'undefined';
}

function changedTopLevelFields<T>(baseline: T, draft: T): string[] {
  if (!isRecord(baseline) || !isRecord(draft)) {
    return settingsSnapshotFingerprint(baseline) === settingsSnapshotFingerprint(draft)
      ? []
      : ['value'];
  }

  return [...new Set([...Object.keys(baseline), ...Object.keys(draft)])]
    .sort((left, right) => left.localeCompare(right))
    .filter((key) => (
      settingsSnapshotFingerprint(baseline[key]) !== settingsSnapshotFingerprint(draft[key])
    ));
}

/**
 * Keeps an incoming persisted settings snapshot separate from an in-progress
 * local draft. Snapshot fingerprints deliberately provide client-side replay
 * protection only; they are not database versions and do not replace CAS.
 */
export function useIncomingSettingsDraft<T>(incoming: T): IncomingSettingsDraft<T> {
  const [draft, setDraft] = useState<T>(() => incoming);
  const [baseline, setBaseline] = useState<T>(() => incoming);
  const [pendingIncoming, setPendingIncoming] = useState<PendingIncoming<T> | null>(null);

  const incomingFingerprint = useMemo(
    () => settingsSnapshotFingerprint(incoming),
    [incoming],
  );
  const dirtyFields = useMemo(
    () => changedTopLevelFields(baseline, draft),
    [baseline, draft],
  );
  const pendingFields = useMemo(
    () => pendingIncoming ? changedTopLevelFields(pendingIncoming.snapshot, draft) : [],
    [draft, pendingIncoming],
  );
  const isDirty = dirtyFields.length > 0;

  const isDirtyRef = useRef(isDirty);
  const pendingIncomingRef = useRef(pendingIncoming);
  const seenIncomingFingerprintsRef = useRef(new Set<string>([incomingFingerprint]));
  isDirtyRef.current = isDirty;
  pendingIncomingRef.current = pendingIncoming;

  useEffect(() => {
    if (seenIncomingFingerprintsRef.current.has(incomingFingerprint)) {
      return;
    }

    seenIncomingFingerprintsRef.current.add(incomingFingerprint);
    if (isDirtyRef.current || pendingIncomingRef.current !== null) {
      setPendingIncoming({ snapshot: incoming, fingerprint: incomingFingerprint });
      return;
    }

    setBaseline(incoming);
    setDraft(incoming);
    setPendingIncoming(null);
  }, [incoming, incomingFingerprint]);

  const updateDraft = useCallback((next: DraftUpdate<T>) => {
    setDraft((current) => (
      typeof next === 'function'
        ? (next as (current: T) => T)(current)
        : next
    ));
  }, []);

  const reloadIncoming = useCallback(() => {
    if (!pendingIncoming) {
      return;
    }

    setBaseline(pendingIncoming.snapshot);
    setDraft(pendingIncoming.snapshot);
    setPendingIncoming(null);
  }, [pendingIncoming]);

  const keepEditing = useCallback(() => {
    // The pending fingerprint is already recorded as seen, so it cannot
    // reappear solely because the component renders again.
    setPendingIncoming(null);
  }, []);

  const markSaved = useCallback((saved: T) => {
    const savedFingerprint = settingsSnapshotFingerprint(saved);
    // A post-save invalidation can still yield an older, already-observed
    // snapshot. Remember the save before that refresh arrives.
    seenIncomingFingerprintsRef.current.add(savedFingerprint);
    setBaseline(saved);
    setDraft((current) => (
      settingsSnapshotFingerprint(current) === savedFingerprint ? saved : current
    ));

    setPendingIncoming((currentPending) => (
      currentPending?.fingerprint === savedFingerprint ? null : currentPending
    ));
  }, []);

  return {
    draft,
    baseline,
    dirtyFields,
    pendingFields,
    isDirty,
    hasPendingIncoming: pendingIncoming !== null,
    updateDraft,
    reloadIncoming,
    keepEditing,
    markSaved,
  };
}
