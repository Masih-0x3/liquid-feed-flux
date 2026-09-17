import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EnrichmentResearchThreshold } from '@/components/settings/EnrichmentResearchThreshold';
import { SettingsNumberField } from '@/components/settings/SettingsNumberField';
import { ConfirmSettingsAction } from '@/components/settings/ConfirmSettingsAction';
import { MessagePreview } from '@/components/settings/MessagePreview';
import { VideoStylePreview } from '@/components/settings/VideoStylePreview';
import { SettingsNavigation } from '@/components/settings/SettingsNavigation';

describe('settings audit regressions', () => {
  it.each([0, 1, 20])('represents persisted research threshold %i consistently', (value) => {
    const onChange = vi.fn();
    render(<EnrichmentResearchThreshold value={value} onChange={onChange} />);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', String(value));
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuemin', '0');
    expect(screen.getByRole('spinbutton')).toHaveValue(value);
    expect(onChange).not.toHaveBeenCalled();
    if (value === 0) expect(screen.getByText(/no score-based research skip/)).toBeInTheDocument();
  });

  it('keeps an out-of-range stored threshold visible until corrected', () => {
    function Threshold() { const [value, setValue] = useState(27); return <EnrichmentResearchThreshold value={value} onChange={setValue} />; }
    render(<Threshold />);
    expect(screen.getByRole('spinbutton')).toHaveValue(27);
    expect(screen.getByRole('spinbutton')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } });
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '0');
  });

  it('edits percentages without changing the persisted ratio domain', () => {
    const change = vi.fn();
    render(<SettingsNumberField label="Max width" value={0.92} min={0.72} max={0.96} step={0.01} unit="percent of frame width" percent onChange={change} />);
    expect(screen.getByRole('spinbutton')).toHaveValue(92);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '80' } });
    expect(change).toHaveBeenCalledWith(0.8);
  });

  it('shows readable percentage limits without floating-point artifacts', () => {
    render(<SettingsNumberField label="Bottom padding" value={0.06} min={0.025} max={0.14} step={0.005} unit="percent of frame height" percent onChange={vi.fn()} />);
    expect(screen.getByRole('spinbutton')).toHaveAttribute('max', '14');
    expect(screen.getByText('2.5–14 percent of frame height.')).toBeInTheDocument();
  });

  it('does not run a provider action until confirmed', async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    render(<ConfirmSettingsAction title="Run paid preview?" description="Sends the entered text to OpenAI." confirmLabel="Run now" onConfirm={action}><button>Preview</button></ConfirmSettingsAction>);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    expect(action).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('renders supported Telegram formatting without executing supplied markup', () => {
    const parser = vi.spyOn(DOMParser.prototype, 'parseFromString');
    const { container } = render(<MessagePreview destination="Telegram" mode="HTML" text={'<b>خبر فارسی</b> @source <a href="https://example.com/news">Source</a><a href="javascript:alert(1)">Unsafe</a><img src="https://example.com/track"><script>alert(1)</script>'} />);
    expect(container.querySelector('b')).toHaveTextContent('خبر فارسی');
    expect(container.querySelector('[lang="fa"]')).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('Source')).toHaveClass('underline');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Unsafe')).not.toHaveAttribute('href');
    expect(container.querySelector('img, script')).toBeNull();
    expect(container.querySelector('bdi')).toHaveTextContent('@source');
    expect(parser).not.toHaveBeenCalled();
    parser.mockRestore();
  });

  it('keeps entities and nested message formatting as inert text', () => {
    const { container } = render(<MessagePreview destination="Telegram" mode="HTML" text={'<b>خبر <i>English &amp; فارسی</i></b><br>&lt;img src="example"&gt;<blockquote>&#x06F1;&#x06F2;</blockquote><iframe src="https://example.com">Hidden</iframe>'} />);
    expect(container.querySelector('b i')).toHaveTextContent('English & فارسی');
    expect(container.querySelector('blockquote')).toHaveTextContent('۱۲');
    expect(screen.getByText('<img src="example">')).toBeInTheDocument();
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    expect(container.querySelector('img, iframe, [src], [href]')).toBeNull();
  });

  it('previews portrait, English and edited subtitle styles without media elements', () => {
    const config = {
      subtitle_style: { text_color: '#ffffff', background_color: '#000000', font_scale: 1, max_width_pct: 0.9, bottom_padding_pct: 0.04, collision_gap_pct: 0.02 },
      watermark: { apply_when: 'subtitle_track' as const, opacity: 0.1, top_right_opacity: 0.2, cover_opacity: 0.3, multiple: true, cover_delogo: false, cover_padding_pct: 0.02 },
    };
    const view = render(<VideoStylePreview config={config} />);
    expect(view.container.querySelector('[lang="fa"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Portrait' }));
    expect(screen.getByRole('button', { name: 'Portrait' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'English sample' }));
    expect(view.container.querySelector('[lang="en"]')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Preview subtitle' }), { target: { value: 'خبر mixed 123 @source' } });
    view.rerender(<VideoStylePreview config={{ ...config, subtitle_style: { ...config.subtitle_style, max_width_pct: 0.8, bottom_padding_pct: 0.08 }, watermark: { ...config.watermark, apply_when: 'never' } }} />);
    expect(screen.getByText('خبر mixed 123 @source').parentElement).toHaveStyle({ width: '80%', bottom: '8%' });
    expect(screen.queryByText('@Masihh')).not.toBeInTheDocument();
    expect(view.container.querySelector('img, video, source, iframe')).toBeNull();
  });

  it('reserves the measured sticky height for scrolling and restores the main scroller on leave', () => {
    const main = document.createElement('main');
    main.style.scrollPaddingBlockStart = '24px';
    document.body.append(main);
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 96 } as DOMRect);
    const view = render(<SettingsNavigation><button>Settings sections</button></SettingsNavigation>, { container: main });
    expect(main.style.scrollPaddingBlockStart).toBe('112px');
    bounds.mockReturnValue({ height: 132 } as DOMRect);
    fireEvent(window, new Event('resize'));
    expect(main.style.scrollPaddingBlockStart).toBe('148px');
    view.unmount();
    expect(main.style.scrollPaddingBlockStart).toBe('24px');
    bounds.mockRestore();
    main.remove();
  });
});
