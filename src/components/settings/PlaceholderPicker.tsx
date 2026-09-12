import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function PlaceholderPicker({ items, onInsert }: { items: ReadonlyArray<{ key: string; description?: string; desc?: string }>; onInsert: (key: string) => void }) {
  const [search, setSearch] = useState('');
  const matches = items.filter((item) => `${item.key} ${item.description ?? item.desc ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return <details className="rounded-md border p-3">
    <summary className="cursor-pointer text-sm font-medium">Insert a placeholder</summary>
    <div className="mt-3 space-y-3">
      <Input aria-label="Find a placeholder" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or purpose" />
      <div className="flex flex-wrap gap-2">
        {matches.map((item) => <Button key={item.key} type="button" size="sm" variant="outline" className="h-auto min-h-10 whitespace-normal break-words" onClick={() => onInsert(item.key)} title={item.description ?? item.desc}><code>{item.key}</code></Button>)}
      </div>
      {matches.length === 0 && <p role="status" className="text-sm text-muted-foreground">No matching placeholders.</p>}
    </div>
  </details>;
}
