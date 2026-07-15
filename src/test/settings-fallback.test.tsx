import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import Settings from '@/pages/Settings';

const mocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/hooks/useSettingsData', () => ({
  useSettingsData: () => ({
    settingsQuery: {
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      refetch: mocks.refetch,
    },
    samplesQuery: { data: [] },
  }),
  useSaveSettings: () => ({ mutate: vi.fn(), isPending: false }),
  openaiModels: [],
  messagePlaceholders: [],
  promptPlaceholders: [],
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/components/settings/ScoringStudio', () => ({ default: () => <div>Scoring studio remains available</div> }));
vi.mock('@/components/settings/EditorialProfilesCard', () => ({ default: () => null }));
vi.mock('@/components/settings/StoryMemoryCard', () => ({ default: () => null }));
vi.mock('@/components/settings/LearnedSignalsCard', () => ({ default: () => null }));
vi.mock('@/components/settings/ContentFilterSettings', () => ({
  default: () => {
    throw new Error('ContentFilterSettings must not render without translation settings');
  },
}));

describe('Settings partial-data fallbacks', () => {
  it('keeps the Filter tab usable when translation settings are unavailable', async () => {
    render(
      <MemoryRouter initialEntries={['/settings#filter']}>
        <Settings />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Translation-dependent scoring controls is temporarily unavailable/i)).toBeInTheDocument();
    expect(screen.getByText('Scoring studio remains available')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });
});
