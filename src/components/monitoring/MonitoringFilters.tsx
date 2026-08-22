import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select as ThemedSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MonitoringFilter, ScoreBucket } from "@/hooks/useMonitoringData";
import { FILTERS, SCORE_BUCKETS } from "@/lib/monitoringViewModel";
import { Ban, RotateCcw, Search } from "lucide-react";

interface MonitoringFiltersProps {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  filter: MonitoringFilter;
  onFilterChange: (value: MonitoringFilter) => void;
  scoreBucket: ScoreBucket;
  onScoreBucketChange: (value: ScoreBucket) => void;
  selectedCount: number;
  visibleCount: number;
  isAllVisibleSelected: boolean;
  onToggleSelectAllVisible: () => void;
  onBulkReprocess: () => void;
  onBulkIgnore: () => void;
  onClearSelection: () => void;
  readOnly: boolean;
  mutationDisabledTitle?: string;
}

export function MonitoringFilters({
  searchTerm,
  onSearchTermChange,
  filter,
  onFilterChange,
  scoreBucket,
  onScoreBucketChange,
  selectedCount,
  visibleCount,
  isAllVisibleSelected,
  onToggleSelectAllVisible,
  onBulkReprocess,
  onBulkIgnore,
  onClearSelection,
  readOnly,
  mutationDisabledTitle,
}: MonitoringFiltersProps) {
  return (
    <CardHeader className="p-3">
      <div className="grid gap-3 xl:grid-cols-[auto_minmax(0,1fr)] xl:items-center">
        <CardTitle className="text-base">Queue</CardTitle>
        <div className="grid gap-2 sm:grid-cols-[minmax(18rem,1fr)_13rem_10rem] xl:justify-end">
          <div className="relative min-w-0">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(event) => onSearchTermChange(event.target.value)}
              placeholder="Search author, source, text, tweet ID"
              className="pl-9"
            />
          </div>
          <ThemedSelect value={filter} onValueChange={(value) => onFilterChange(value as MonitoringFilter)}>
            <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FILTERS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectContent>
          </ThemedSelect>
          <ThemedSelect value={scoreBucket} onValueChange={(value) => onScoreBucketChange(value as ScoreBucket)}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SCORE_BUCKETS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectContent>
          </ThemedSelect>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
        <span className="text-xs font-medium text-muted-foreground">{selectedCount} selected</span>
        <Button size="sm" variant="outline" onClick={onToggleSelectAllVisible} disabled={visibleCount === 0}>
          {isAllVisibleSelected ? 'Deselect all visible' : 'Select all visible'}
        </Button>
        {selectedCount > 0 && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={readOnly}
              title={readOnly ? mutationDisabledTitle : undefined}
              onClick={() => { if (!readOnly) onBulkReprocess(); }}
            >
              <RotateCcw className="w-3 h-3 mr-2" />
              Mass reprocess
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={readOnly}
              title={readOnly ? mutationDisabledTitle : undefined}
              onClick={() => { if (!readOnly) onBulkIgnore(); }}
            >
              <Ban className="w-3 h-3 mr-2" />
              Mass ignore
            </Button>
            <Button size="sm" variant="ghost" onClick={onClearSelection}>
              Clear selection
            </Button>
          </>
        )}
      </div>
    </CardHeader>
  );
}
