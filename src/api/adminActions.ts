import { supabase } from '@/integrations/supabase/client';
import type { AdminActionName } from '../../supabase/functions/_shared/adminActionNames';
import {
  createAdminActionResponseError,
  createAdminActionTransportError,
  withAdminActionDeadline,
  withNormalizedAdminActionTransport,
} from './adminActionErrors';

/** Client-only control actions are added here before the server action catalog is regenerated. */
export type ClientControlActionName = 'get_runtime_controls' | 'update_runtime_controls';
export type AdminActionBody = { action: AdminActionName | ClientControlActionName } & Record<string, unknown>;

export type InvokeAdminActionOptions = {
  failureMessage?: string;
  throwOnFailure?: boolean;
};

export type InvokeAdminReadOptions = InvokeAdminActionOptions & {
  timeoutMs?: number;
};

export async function invokeAdminAction<T>(
  body: AdminActionBody,
  options: InvokeAdminActionOptions = {},
): Promise<T> {
  const { data, error } = await withNormalizedAdminActionTransport(
    () => supabase.functions.invoke('admin-actions', { body }),
  );
  if (error) throw createAdminActionTransportError(error);
  if (options.throwOnFailure !== false && (data?.ok === false || data?.success === false)) {
    throw createAdminActionResponseError(options);
  }
  return data as T;
}

export async function invokeAdminRead<T>(
  body: AdminActionBody,
  options: InvokeAdminReadOptions = {},
): Promise<T> {
  const { timeoutMs = 15_000, ...actionOptions } = options;
  return withAdminActionDeadline(
    () => invokeAdminAction<T>(body, actionOptions),
    timeoutMs,
  );
}
