import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function SettingsNumberField({ label, value, onChange, min, max, step = 1, unit, percent = false }: {
  label: string; value: number; onChange: (value: number) => void; min: number; max: number; step?: number; unit: string; percent?: boolean;
}) {
  const id = useId();
  const scale = percent ? 100 : 1;
  const displayValue = Number((value * scale).toFixed(4));
  const displayMin = Number((min * scale).toFixed(4));
  const displayMax = Number((max * scale).toFixed(4));
  const displayStep = Number((step * scale).toFixed(4));
  const invalid = !Number.isFinite(value) || value < min || value > max;
  return <div className="space-y-2">
    <Label htmlFor={id}>{label}{percent ? ' (%)' : ''}</Label>
    <Input id={id} type="number" required min={displayMin} max={displayMax} step={displayStep} value={displayValue} aria-invalid={invalid} aria-describedby={`${id}-help`} onChange={(event) => {
      const next = Number(event.target.value);
      if (event.target.value !== '' && Number.isFinite(next)) onChange(next / scale);
    }} />
    <p id={`${id}-help`} className={`text-xs ${invalid ? 'text-destructive' : 'text-muted-foreground'}`}>{invalid ? 'Outside the supported range. Correct before saving. ' : ''}{displayMin}–{displayMax} {unit}.</p>
  </div>;
}
