import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('mobile Settings layout contract', () => {
  const settings = source('src/pages/Settings.tsx');

  it('keeps both placeholder sections readable at narrow widths', () => {
    expect(settings.match(/grid grid-cols-1 sm:grid-cols-2 gap-2/g)).toHaveLength(2);
    expect(settings.match(/flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between/g)).toHaveLength(2);
    expect(settings.match(/w-full whitespace-normal min-w-0 break-words/g)).toHaveLength(2);
    expect(settings.match(/text-muted-foreground whitespace-normal break-words/g)).toHaveLength(2);
  });

  it('keeps inline prompt text clear of the copy and expand buttons', () => {
    const promptEditor = source('src/components/settings/PromptEditor.tsx');
    expect(promptEditor).toContain("className={cn(textareaClass, 'border-0 rounded-none pr-20')}");
  });
});
