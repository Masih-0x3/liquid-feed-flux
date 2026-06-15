import { supabase } from '@/integrations/supabase/client';
import type { AdminActionName } from '../../supabase/functions/_shared/adminActionNames';

export type AdminActionBody = { action: AdminActionName } & Record<string, unknown>;

type InvokeAdminActionOptions = {
  failureMessage?: string;
  throwOnFailure?: boolean;
};

async function formatFunctionError(error: unknown): Promise<string> {
  const fallback = error instanceof Error ? error.message : String(error);
  const context = error && typeof error === 'object' && 'context' in error
    ? (error as { context?: unknown }).context
    : null;

  if (!context || typeof (context as Response).clone !== 'function') {
    return fallback;
  }

  const response = context as Response;
  let responseText = '';
  try {
    responseText = await response.clone().text();
  } catch {
    return fallback;
  }

  if (!responseText) return fallback;

  try {
    const parsed = JSON.parse(responseText) as { error?: unknown; message?: unknown; code?: unknown };
    const detail = parsed.error ?? parsed.message ?? parsed.code;
    if (detail) {
      return `Edge Function ${response.status}: ${String(detail)}`;
    }
  } catch {
    // Fall through to a compact raw response excerpt.
  }

  return `Edge Function ${response.status}: ${responseText.slice(0, 300)}`;
}

export async function invokeAdminAction<T>(
  body: AdminActionBody,
  options: InvokeAdminActionOptions = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-actions', { body });
  if (error) throw new Error(await formatFunctionError(error));
  if (options.throwOnFailure !== false && (data?.ok === false || data?.success === false)) {
    throw new Error(data.error ?? options.failureMessage ?? 'Admin action failed');
  }
  return data as T;
}
