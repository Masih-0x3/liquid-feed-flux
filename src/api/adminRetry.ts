import { supabase } from '@/integrations/supabase/client';

export type AdminRetryBody = { action: string } & Record<string, unknown>;

type InvokeAdminRetryOptions = {
  failureMessage?: string;
  throwOnFailure?: boolean;
};

export async function invokeAdminRetry<T>(
  body: AdminRetryBody,
  options: InvokeAdminRetryOptions = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-retry', { body });
  if (error) throw error;
  if (options.throwOnFailure !== false && (data?.ok === false || data?.success === false)) {
    throw new Error(data.error ?? options.failureMessage ?? 'Admin retry action failed');
  }
  return data as T;
}
