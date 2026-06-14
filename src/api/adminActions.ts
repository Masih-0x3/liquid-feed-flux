import { supabase } from '@/integrations/supabase/client';
import type { AdminActionName } from '../../supabase/functions/_shared/adminActionNames';

export type AdminActionBody = { action: AdminActionName } & Record<string, unknown>;

export async function invokeAdminAction<T>(body: AdminActionBody): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-actions', { body });
  if (error) throw error;
  if (data?.ok === false || data?.success === false) {
    throw new Error(data.error ?? 'Admin action failed');
  }
  return data as T;
}
