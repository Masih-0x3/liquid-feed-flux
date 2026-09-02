import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function source(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('read-only mutation inventory', () => {
  it.each([
    'src/components/dashboard/DashboardHealth.tsx',
    'src/pages/Monitoring.tsx',
    'src/pages/VideoRenders.tsx',
    'src/components/video/ManualVideoIntakePanel.tsx',
    'src/pages/Downloader.tsx',
  ])('%s uses the canonical auth role seam', (relativePath) => {
    const contents = source(relativePath);
    expect(contents).toContain('useAuth');
    expect(contents).toMatch(/["']read_only["']/);
  });

  it('gates each owned mutation surface and handler', () => {
    for (const relativePath of [
      'src/components/dashboard/DashboardHealth.tsx',
      'src/pages/Monitoring.tsx',
      'src/pages/VideoRenders.tsx',
      'src/components/video/ManualVideoIntakePanel.tsx',
    ]) {
      const contents = source(relativePath);
      if (relativePath.endsWith('VideoRenders.tsx')) {
        expect(contents).toContain('if (isAdmin) setReviewed.mutate');
      } else {
        expect(contents).toContain('if (!isAdmin) return');
      }
      expect(contents).toContain('disabled={readOnly');
      expect(contents).toContain('Read-only access');
    }
  });

  it('fails closed for Downloader metadata lookup in read-only mode', () => {
    const contents = source('src/pages/Downloader.tsx');
    expect(contents).toContain('resolve_x_media');
    expect(contents).not.toContain('.mutate(');
    expect(contents).not.toContain('update_');
    expect(contents).toContain('disabled={loading || readOnly}');
    expect(contents).toContain('if (readOnly)');
    expect(contents).toContain('Media metadata lookup is unavailable for read-only access.');
  });
});
