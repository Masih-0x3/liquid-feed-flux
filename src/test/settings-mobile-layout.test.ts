import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlaceholderPicker } from '@/components/settings/PlaceholderPicker';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('responsive Settings navigation and placeholders', () => {
  const settings = source('src/pages/Settings.tsx');

  it('keeps eight sections discoverable in a compact phone selector and a desktop grid', () => {
    expect(settings).toContain('aria-label="Settings sections"');
    expect(settings).toContain('grid-cols-4 gap-1 sm:grid xl:grid-cols-8');
    expect(settings).toContain('aria-label="Settings section"');
    expect(settings.match(/<SelectItem value="(?:translation|filter|messages|telegram|x-automation|video-rendering|enrichment|observability)">/g)).toHaveLength(8);
    expect(settings).toContain('</SettingsNavigation>\n        <div className="my-3"><SettingsDraftGuard /></div>');
    expect(settings).not.toContain('overflow-x-auto p-1');
    expect(settings).toContain('<SettingsSectionNav tab={settingsTab} />');
  });

  it('lets operators find and insert a placeholder from on-demand help', () => {
    const insert = vi.fn();
    const view = render(createElement(PlaceholderPicker, { items: [{ key: '{content}', description: 'Source text' }, { key: '{author_handle}', description: 'Author' }], onInsert: insert }));
    const disclosure = view.container.querySelector('details');
    expect(disclosure?.open).toBe(false);
    disclosure!.open = true;
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a placeholder' }), { target: { value: 'author' } });
    expect(screen.queryByRole('button', { name: '{content}' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '{author_handle}' }));
    expect(insert).toHaveBeenCalledWith('{author_handle}');
  });

  it('keeps inline prompt text clear of the copy and expand buttons', () => {
    const promptEditor = source('src/components/settings/PromptEditor.tsx');
    expect(promptEditor).toContain("className={cn(textareaClass, 'border-0 rounded-none pr-20')}");
  });
});
