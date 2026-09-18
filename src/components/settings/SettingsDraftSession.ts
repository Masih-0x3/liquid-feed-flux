import type { AuthStatus } from '@/lib/authState';

let generation = 0;
let identity: string | null = null;
const resetListeners = new Set<() => void>();

/** A small auth boundary that does not import the Settings UI into the app shell. */
export function clearSettingsDraftSession() {
  generation += 1;
  resetListeners.forEach((listener) => listener());
}

/** Call before committing an authentication transition to React state. */
export function reconcileSettingsDraftIdentity(userId: string | null, status: AuthStatus) {
  const nextIdentity = status === 'authorised' ? userId : null;
  if (identity === nextIdentity) return;
  identity = nextIdentity;
  clearSettingsDraftSession();
}

export function getSettingsDraftSession() {
  return { generation, identity };
}

export function onSettingsDraftSessionReset(listener: () => void) {
  resetListeners.add(listener);
  return () => { resetListeners.delete(listener); };
}
