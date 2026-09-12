import { useRef } from 'react';

const sections: Record<string, Array<[string, string]>> = {
  translation: [['translation-model', 'Model'], ['translation-scoring-model', 'Scoring model'], ['translation-prompts', 'Prompts & save'], ['translation-playground', 'Playground']],
  filter: [['scoring-policy', 'Policy & save'], ['duplicate-gate', 'Duplicate Gate'], ['scoring-legacy', 'Legacy reference'], ['learned-signals', 'Learned signals']],
  messages: [['message-template', 'Template & save']],
  telegram: [['telegram-config', 'Configuration']],
  'x-automation': [['x-credentials', 'Connection'], ['x-hydration', 'Hydration'], ['x-tests', 'Live tests'], ['x-posting-config', 'Posting & save'], ['x-limits', 'Limits & save']],
  'video-rendering': [['video-mode', 'Mode'], ['video-style', 'Style preview'], ['video-watermark', 'Watermark'], ['video-save', 'Save']],
  enrichment: [['enrichment-config', 'Pipeline'], ['enrichment-voice', 'Voice guide'], ['enrichment-thresholds', 'Thresholds'], ['enrichment-save', 'Save']],
  observability: [['observability-metrics', 'Metrics'], ['observability-controls', 'Controls']],
};

export function SettingsSectionNav({ tab }: { tab: string }) {
  const mobileDisclosureRef = useRef<HTMLDetailsElement>(null);
  const links = (sections[tab] ?? []).map(([id, label]) => <a key={id} href={`#${tab}`} className="inline-flex min-h-9 items-center text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={(event) => {
      event.preventDefault();
      if (mobileDisclosureRef.current) mobileDisclosureRef.current.open = false;
      const target = document.getElementById(id);
      if (!target) return;
      const disclosure = target.closest('details');
      if (disclosure) disclosure.open = true;
      target.scrollIntoView({ block: 'start' });
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }}>{label}</a>);
  return <>
    <nav aria-label="On this settings page" className="hidden flex-wrap gap-x-4 gap-y-1 px-1 text-xs sm:flex">{links}</nav>
    <details ref={mobileDisclosureRef} className="sm:hidden">
      <summary className="min-h-9 cursor-pointer px-1 py-2 text-sm text-muted-foreground">On this page · {links.length} section{links.length === 1 ? '' : 's'}</summary>
      <nav aria-label="On this settings page" className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-sm">{links}</nav>
    </details>
  </>;
}
