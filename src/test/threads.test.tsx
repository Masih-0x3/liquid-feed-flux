import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { invokeAdminAction } from '@/api/adminActions';
import Threads from '@/pages/Threads';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/api/adminActions', () => ({
  invokeAdminAction: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: mocks.from },
}));

const thread = {
  id: 'thread-1',
  account_id: 'account-1',
  tweet_ids: ['tweet-1'],
  confidence: 0.9,
  created_at: '2026-07-14T10:00:00.000Z',
  accounts: { handle: 'source' },
};

describe('Threads', () => {
  it('requires a loaded preview before it queues a thread post', async () => {
    let resolvePosts: (value: { data: Array<Record<string, unknown>>; error: null }) => void;
    const posts = new Promise<{ data: Array<Record<string, unknown>>; error: null }>((resolve) => {
      resolvePosts = resolve;
    });

    const threadOrder = vi.fn().mockResolvedValue({ data: [thread], error: null });
    const postOrder = vi.fn(() => posts);
    mocks.from.mockImplementation((table: string) => {
      if (table === 'threads') {
        return { select: vi.fn(() => ({ order: threadOrder })) };
      }
      if (table === 'posts') {
        return { select: vi.fn(() => ({ in: vi.fn(() => ({ order: postOrder })) })) };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    vi.mocked(invokeAdminAction).mockResolvedValue({ ok: true });

    render(
      <TooltipProvider>
        <Threads />
      </TooltipProvider>,
    );

    await screen.findByText('@source');
    fireEvent.click(screen.getByRole('button', { name: /review thread from @source before queueing/i }));

    expect(invokeAdminAction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Post Thread' })).toBeDisabled();

    await act(async () => {
      resolvePosts({
        data: [{
          tweet_id: 'tweet-1',
          text_original: 'Source post',
          text_translated: 'Translated post',
          created_at: '2026-07-14T10:01:00.000Z',
        }],
        error: null,
      });
    });

    await screen.findByText('Individual Posts');
    fireEvent.click(screen.getByRole('button', { name: 'Post Thread' }));

    await waitFor(() => {
      expect(invokeAdminAction).toHaveBeenCalledWith({ action: 'post_thread', thread_id: 'thread-1' });
    });
  });
});
