import type { MonitoringEntry } from "@/hooks/useMonitoringData";
import { toneClass } from "@/lib/monitoringViewModel";

type DuplicateCoverageState = NonNullable<MonitoringEntry['duplicate_of']>['coverage_state'];

export function duplicateCoverageLabel(coverage?: DuplicateCoverageState) {
  switch (coverage) {
    case 'delivered': return 'covered: delivered';
    case 'in_pipeline': return 'covered: in pipeline';
    case 'also_duplicate': return 'canonical is also duplicate';
    case 'not_covered': return 'not covered';
    default: return 'coverage unknown';
  }
}

export function duplicateCoverageClass(coverage?: DuplicateCoverageState) {
  switch (coverage) {
    case 'delivered': return toneClass('good');
    case 'in_pipeline': return toneClass('info');
    case 'also_duplicate':
    case 'not_covered': return toneClass('warn');
    default: return toneClass('muted');
  }
}

export function duplicateCoverageDetail(target?: MonitoringEntry['duplicate_of']) {
  if (!target) return 'The matched post was not returned by the backend. Use the tweet ID to inspect it directly.';

  switch (target.coverage_state) {
    case 'delivered':
      return 'Canonical item is covered. At least one delivery path already posted it.';
    case 'in_pipeline':
      return 'Canonical item is still active in the pipeline, so this duplicate is blocked while the original moves.';
    case 'also_duplicate':
      return 'Canonical item is also marked duplicate. This needs review so the story is not lost.';
    case 'not_covered':
      return 'Canonical item is not delivered or active. This is a coverage gap that needs review.';
    default:
      return 'Coverage is unknown. Inspect the matched item before trusting the duplicate decision.';
  }
}
