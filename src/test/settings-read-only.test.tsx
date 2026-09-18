import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Settings from '@/pages/Settings';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useSaveSettings, useSettingsData } from '@/hooks/useSettingsData';
import { clearSettingsDrafts } from '@/components/settings/SettingsDrafts';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/hooks/useDashboardData', () => ({ useDashboardData: vi.fn() }));
vi.mock('@/hooks/useSettingsData', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/hooks/useSettingsData')>(),
  useSettingsData: vi.fn(),
  useSaveSettings: vi.fn(),
}));
vi.mock('@/components/settings/SettingsRuntimeControls', () => ({ SettingsRuntimeControls: () => null }));

const settings = {
  translation_prompt: {
    system_prompt: 'Translate the source.',
    user_prompt_template: '{content}',
    model: 'gpt-4.1-mini',
    temperature: 0.5,
    max_completion_tokens: 1000,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  },
  telegram_config: { parse_mode: 'HTML' },
  message_template: {
    template: '{translated_text}',
    include_source_link: true,
    include_hashtags: false,
    include_media_caption: true,
    source_link_text: 'Source',
    custom_hashtags: '',
  },
};

describe('Settings read-only action boundary', () => {
  const refetch = vi.fn();
  const save = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    clearSettingsDrafts();
    window.history.replaceState(null, '', '/settings#observability');
    vi.mocked(useAuth).mockReturnValue({ role: 'read_only', isAdmin: false } as ReturnType<typeof useAuth>);
    vi.mocked(useSettingsData).mockReturnValue({
      settingsQuery: { data: settings, isLoading: false, isError: false, error: null },
      samplesQuery: { data: [] },
    } as ReturnType<typeof useSettingsData>);
    vi.mocked(useSaveSettings).mockReturnValue({ mutateAsync: save, isPending: false } as unknown as ReturnType<typeof useSaveSettings>);
    vi.mocked(useDashboardData).mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: new Error('Summary unavailable'),
      refetch,
    } as ReturnType<typeof useDashboardData>);
  });

  afterEach(() => {
    clearSettingsDrafts();
    window.history.replaceState(null, '', '/');
  });

  it('allows a safe Observability retry while Telegram edits and saves remain disabled', async () => {
    render(<MemoryRouter initialEntries={['/settings#observability']}><Settings /></MemoryRouter>);

    const retry = await screen.findByRole('button', { name: 'Retry observability' });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Telegram' }), { key: 'Enter' });
    expect(await screen.findByRole('combobox', { name: 'Parse Mode' })).toBeDisabled();
    const saveButton = screen.getByRole('button', { name: 'Save Telegram Config' });
    expect(saveButton).toBeDisabled();
    saveButton.click();
    expect(save).not.toHaveBeenCalled();
  });

  it('prevents repeated retry requests while the read is already running', async () => {
    vi.mocked(useDashboardData).mockReturnValue({
      ...vi.mocked(useDashboardData)(),
      isFetching: true,
    } as ReturnType<typeof useDashboardData>);
    render(<MemoryRouter initialEntries={['/settings#observability']}><Settings /></MemoryRouter>);

    const retry = await screen.findByRole('button', { name: 'Retry observability' });
    expect(retry).toBeDisabled();
    retry.click();
    expect(refetch).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
