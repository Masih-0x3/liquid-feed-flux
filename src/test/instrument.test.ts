import { describe, expect, it } from 'vitest';
import { resolveSentryEnvironment, SENTRY_ENVIRONMENT_FALLBACK } from '@/instrument';

describe('Sentry environment resolution', () => {
  it('uses the configured environment and trims surrounding whitespace', () => {
    expect(resolveSentryEnvironment(' preview ')).toBe('preview');
  });

  it('uses a safe non-production sentinel when the environment is missing', () => {
    expect(resolveSentryEnvironment(undefined)).toBe(SENTRY_ENVIRONMENT_FALLBACK);
    expect(SENTRY_ENVIRONMENT_FALLBACK).not.toBe('production');
    expect(resolveSentryEnvironment('')).toBe(SENTRY_ENVIRONMENT_FALLBACK);
  });
});
