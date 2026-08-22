import { describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke },
  },
}));

import { getRuntimeControls, updateRuntimeControls } from '@/api/runtimeControls';

const controls = {
  environment: 'preview',
  dedupe_enabled: false,
  translation_enabled: true,
  posting_mode: 'blocked',
  updated_at: '2026-08-12T15:00:00.000Z',
  updated_by: null,
};

describe('runtime control client contract', () => {
  it('requests runtime state through the read action', async () => {
    invoke.mockResolvedValueOnce({ data: { success: true, controls }, error: null });

    await expect(getRuntimeControls()).resolves.toMatchObject(controls);
    expect(invoke).toHaveBeenCalledWith('admin-actions', {
      body: { action: 'get_runtime_controls' },
    });
  });

  it('sends only the two boolean controls on update', async () => {
    invoke.mockResolvedValueOnce({ data: { success: true, controls: { ...controls, dedupe_enabled: true } }, error: null });

    await updateRuntimeControls({ dedupe_enabled: true, translation_enabled: false });
    const body = invoke.mock.calls.at(-1)?.[1]?.body as Record<string, unknown>;
    expect(body).toEqual({
      action: 'update_runtime_controls',
      dedupe_enabled: true,
      translation_enabled: false,
    });
    expect(Object.keys(body)).toEqual(['action', 'dedupe_enabled', 'translation_enabled']);
    expect(Object.values(body).slice(1).every((value) => typeof value === 'boolean')).toBe(true);
  });

  it('does not expose unexpected response fields and rejects malformed control state', async () => {
    invoke.mockResolvedValueOnce({
      data: {
        controls: { ...controls, api_key: 'secret-must-not-escape' },
      },
      error: null,
    });
    const safe = await getRuntimeControls();
    expect(safe).not.toHaveProperty('api_key');

    invoke.mockResolvedValueOnce({
      data: { controls: { ...controls, dedupe_enabled: 'yes' } },
      error: null,
    });
    await expect(getRuntimeControls()).rejects.toThrow('Runtime controls are unavailable.');
  });
});
