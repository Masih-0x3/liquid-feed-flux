import { describe, expect, it } from 'vitest';
import { rendererStateFor } from '@/lib/videoRenderState';

describe('renderer status presentation', () => {
  it('keeps unresolved and failed overview requests distinct from offline', () => {
    expect(rendererStateFor({ isLoading: true, isError: false, hasOverview: false, heartbeat: null })).toBe('checking');
    expect(rendererStateFor({ isLoading: false, isError: true, hasOverview: false, heartbeat: null })).toBe('unknown');
    expect(rendererStateFor({ isLoading: false, isError: false, hasOverview: true, heartbeat: null })).toBe('unknown');
  });

  it('keeps cached overview data explicitly stale after a refresh error', () => {
    expect(rendererStateFor({
      isLoading: false,
      isError: true,
      hasOverview: true,
      heartbeat: { status: 'online', last_seen_at: new Date().toISOString() },
    })).toBe('stale');
  });

  it('reports a fresh online renderer and a stale heartbeat separately', () => {
    expect(rendererStateFor({
      isLoading: false,
      isError: false,
      hasOverview: true,
      heartbeat: { status: 'online', last_seen_at: new Date().toISOString() },
    })).toBe('online');
    expect(rendererStateFor({
      isLoading: false,
      isError: false,
      hasOverview: true,
      heartbeat: { status: 'online', last_seen_at: '2026-01-01T00:00:00.000Z' },
    })).toBe('stale');
    expect(rendererStateFor({
      isLoading: false,
      isError: false,
      hasOverview: true,
      heartbeat: { status: 'offline', last_seen_at: new Date().toISOString() },
    })).toBe('offline');
  });
});
