import { supabase } from '@/integrations/supabase/client';
import {
  createAdminActionResponseError,
  createAdminActionTransportError,
  withNormalizedAdminActionTransport,
} from './adminActionErrors';

export type AdminRetryBody = { action: string } & Record<string, unknown>;

type InvokeAdminRetryOptions = {
  failureMessage?: string;
  throwOnFailure?: boolean;
};

export async function invokeAdminRetry<T>(
  body: AdminRetryBody,
  options: InvokeAdminRetryOptions = {},
): Promise<T> {
  const { data, error } = await withNormalizedAdminActionTransport(
    () => supabase.functions.invoke('admin-retry', { body }),
  );
  if (error) throw createAdminActionTransportError(error);
  if (options.throwOnFailure !== false && (data?.ok === false || data?.success === false)) {
    throw createAdminActionResponseError(options);
  }
  return data as T;
}
