import { invokeAdminAction } from '@/api/adminActions';
import type { MonitoringEntry } from '@/api/monitoringData';

export type DashboardProcessHudSource = 'local-ledger' | 'unavailable';

export interface DashboardProcessHudPayload {
  available: boolean;
  generatedAt: string | null;
  windowHours: number;
  source: DashboardProcessHudSource;
  partialReason: string | null;
  error: string | null;
  truncated: boolean;
  entries: MonitoringEntry[];
}

const EMPTY_DASHBOARD_PROCESS_HUD: DashboardProcessHudPayload = {
  available: false,
  generatedAt: null,
  windowHours: 24,
  source: 'unavailable',
  partialReason: null,
  error: null,
  truncated: false,
  entries: [],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function normalizeDashboardProcessHud(input: unknown): DashboardProcessHudPayload {
  const row = asRecord(input);
  const source = row.source === 'local-ledger' ? 'local-ledger' : 'unavailable';
  return {
    available: row.available !== false,
    generatedAt: asString(row.generated_at ?? row.generatedAt),
    windowHours: asNumber(row.window_hours ?? row.windowHours, EMPTY_DASHBOARD_PROCESS_HUD.windowHours),
    source,
    partialReason: asString(row.partial_reason ?? row.partialReason),
    error: asString(row.error),
    truncated: row.truncated === true,
    entries: Array.isArray(row.entries) ? row.entries as MonitoringEntry[] : [],
  };
}

export async function fetchDashboardProcessHud(): Promise<DashboardProcessHudPayload> {
  const data = await invokeAdminAction<{
    success?: boolean;
    error?: string;
    process_hud?: unknown;
    processHud?: unknown;
  }>({
    action: 'get_dashboard_process_hud',
    limit: 30,
    window_hours: 24,
  });

  if (data?.success === false) {
    throw new Error(data.error || 'Dashboard process HUD unavailable');
  }

  return normalizeDashboardProcessHud(data?.process_hud ?? data?.processHud ?? EMPTY_DASHBOARD_PROCESS_HUD);
}
