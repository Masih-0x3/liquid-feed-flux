import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

export function EnrichmentResearchThreshold({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const invalid = !Number.isFinite(value) || value < 0 || value > 20;
  return <div className="space-y-2">
    <Label htmlFor="enrichment-research-threshold">Skip research below score</Label>
    {!invalid && <Slider aria-label="Skip research below score" aria-describedby="enrichment-research-threshold-help" aria-valuetext={value === 0 ? '0, no score-based skip' : String(value)} value={[value]} min={0} max={20} step={1} onValueChange={([next]) => onChange(next)} />}
    <Input aria-label="Skip research below score" id="enrichment-research-threshold" type="number" min={0} max={20} step={1} value={value} aria-invalid={invalid} aria-describedby="enrichment-research-threshold-help" onChange={(event) => { const next = Number(event.target.value); if (event.target.value !== '' && Number.isFinite(next)) onChange(next); }} />
    <p id="enrichment-research-threshold-help" className={`text-xs ${invalid ? 'text-destructive' : 'text-muted-foreground'}`}>
      {invalid ? 'The saved value is outside 0–20. It has not been changed. Enter a value in range before saving.' : value === 0 ? '0 = no score-based research skip. All scores may use research.' : `Scores below ${value} skip web research; commentary still runs. Valid range: 0–20.`}
    </p>
  </div>;
}
