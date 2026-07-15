import { describe, expect, it } from 'vitest';
import { evaluateDeploymentVersion } from '@/hooks/useDeploymentVersionStatus';

const now = Date.parse('2026-07-14T12:00:00.000Z');

describe('deployment version status', () => {
  it('identifies a dashboard build that is materially behind the backend', () => {
    const status = evaluateDeploymentVersion({
      frontendSha: 'front-old',
      frontendTime: '2026-07-14T06:00:00.000Z',
      backend: { sha: 'api-new', deployed_at: '2026-07-14T11:30:00.000Z', ok: true },
      hasError: false,
      now,
    });

    expect(status.mismatch).toBe('frontend_behind');
    expect(status.uiStale).toBe(true);
    expect(status.apiStale).toBe(false);
  });

  it('identifies a backend revision that is materially behind the dashboard', () => {
    const status = evaluateDeploymentVersion({
      frontendSha: 'front-new',
      frontendTime: '2026-07-14T11:30:00.000Z',
      backend: { sha: 'api-old', deployed_at: '2026-07-14T06:00:00.000Z', ok: true },
      hasError: false,
      now,
    });

    expect(status.mismatch).toBe('backend_behind');
    expect(status.apiStale).toBe(true);
    expect(status.uiStale).toBe(false);
  });

  it('does not invent a mismatch when a local development build has no comparable revision', () => {
    const status = evaluateDeploymentVersion({
      frontendSha: 'dev',
      frontendTime: '',
      backend: { sha: 'api-new', deployed_at: '2026-07-14T06:00:00.000Z', ok: true },
      hasError: false,
      now,
    });

    expect(status.mismatch).toBeNull();
    expect(status.bothFresh).toBe(false);
  });

  it('recognizes a full backend SHA as the same revision as a short frontend SHA', () => {
    const status = evaluateDeploymentVersion({
      frontendSha: 'abcdef1',
      frontendTime: '2026-07-14T11:30:00.000Z',
      backend: { sha: 'abcdef1234567890', deployed_at: '2026-07-14T11:31:00.000Z', ok: true },
      hasError: false,
      now,
    });

    expect(status.revisionsMatch).toBe(true);
    expect(status.mismatch).toBeNull();
    expect(status.bothFresh).toBe(true);
  });

  it('does not show a green match for fresh but different revisions', () => {
    const status = evaluateDeploymentVersion({
      frontendSha: 'abcdef1',
      frontendTime: '2026-07-14T11:30:00.000Z',
      backend: { sha: '0123456789abcdef', deployed_at: '2026-07-14T11:31:00.000Z', ok: true },
      hasError: false,
      now,
    });

    expect(status.mismatch).toBe('revision_mismatch');
    expect(status.bothFresh).toBe(false);
  });

  it('fails closed when backend release metadata is unknown', () => {
    const status = evaluateDeploymentVersion({
      frontendSha: 'abcdef1',
      frontendTime: '2026-07-14T11:30:00.000Z',
      backend: { sha: 'unknown', deployed_at: 'unknown', ok: true },
      hasError: false,
      now,
    });

    expect(status.backendMetadataAvailable).toBe(false);
    expect(status.bothFresh).toBe(false);
    expect(status.mismatch).toBeNull();
  });
});
