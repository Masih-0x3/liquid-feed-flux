import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, RefreshCw } from 'lucide-react';

/**
 * Design-system state gallery (Linear 0X3-606 / B3).
 * Dev-only documentation surface: it demonstrates every shared interactive
 * primitive and its complete state contract in both themes. It is excluded
 * from production builds via the import.meta.env.DEV gate in App.tsx and is
 * never a report or demo route in the published bundle.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass-card p-4 sm:p-5" aria-labelledby={`gallery-${title.replace(/\s+/g, '-').toLowerCase()}`}>
      <h2 id={`gallery-${title.replace(/\s+/g, '-').toLowerCase()}`} className="mb-3 text-base font-semibold text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function DesignStateGallery() {
  return (
    <div className="space-y-4 pb-10">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Design state gallery</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every shared primitive and state in the current theme. Dev-only; not part of production builds.
        </p>
      </div>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button disabled>Disabled</Button>
          <Button>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Pending
          </Button>
          <Button variant="outline" className="focus-visible:ring-2">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh scope
          </Button>
        </div>
      </Section>

      <Section title="Fields">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="gallery-input">Default field</Label>
            <Input id="gallery-input" placeholder="Numeric ID or URL" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gallery-input-error">Field with validation error</Label>
            <Input id="gallery-input-error" aria-invalid placeholder="Enter a numeric ID" />
            <p className="text-xs text-destructive">Enter a numeric ID or a full x.com status URL.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="gallery-input-disabled">Disabled field</Label>
            <Input id="gallery-input-disabled" disabled placeholder="Read-only while pending" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gallery-textarea">Multi-line editor</Label>
            <Textarea id="gallery-textarea" placeholder="Prompt or message template" />
          </div>
        </div>
      </Section>

      <Section title="Selection controls">
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox defaultChecked /> Checked choice
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox /> Unchecked choice
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox disabled /> Disabled choice
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Switch defaultChecked /> Runtime enabled
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Switch /> Runtime blocked
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch disabled /> Unavailable
          </label>
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="queue">
          <TabsList>
            <TabsTrigger value="queue">Queue</TabsTrigger>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="manual" disabled>
              Manual (disabled)
            </TabsTrigger>
          </TabsList>
          <TabsContent value="queue" className="mt-2 text-sm text-muted-foreground">
            Queue-first workbench content.
          </TabsContent>
          <TabsContent value="overview" className="mt-2 text-sm text-muted-foreground">
            Overview content with bounded cohorts.
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Table">
        <div className="overflow-hidden rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Record</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Deliveries</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">17483920194839040</TableCell>
                <TableCell>
                  <span className="status-success inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs">Delivered</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">2</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">17483920194839041</TableCell>
                <TableCell>
                  <span className="status-warning inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs">Skipped</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">0</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">17483920194839042</TableCell>
                <TableCell>
                  <span className="status-error inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs">Failed</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">0</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">17483920194839043</TableCell>
                <TableCell>
                  <span className="status-pending inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs">Pending</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">1</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title="Status and metric language">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Neutral</Badge>
          <span className="status-success inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs">Success chip</span>
          <span className="status-warning inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs">Warning chip</span>
          <span className="status-error inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs">Destructive chip</span>
          <span className="status-pending inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs">Pending chip</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Queue (24h)</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground">128</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Delivered (24h)</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground">96</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Unavailable</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-muted-foreground">—</p>
          </div>
        </div>
        <div className="mt-4 max-w-md">
          <Progress value={62} />
          <p className="mt-1 text-xs text-muted-foreground">62% of the monthly posting budget.</p>
        </div>
      </Section>

      <Section title="Feedback surfaces">
        <div className="grid gap-3 sm:grid-cols-2">
          <Alert>
            <AlertTitle>Informational</AlertTitle>
            <AlertDescription>How scoring fits together: filters apply before thresholds.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <AlertTitle>Destructive</AlertTitle>
            <AlertDescription>The save failed; your edits are retained. Retry the save.</AlertDescription>
          </Alert>
          <Alert className="border-warning/40 bg-warning/10">
            <AlertTitle>Warning</AlertTitle>
            <AlertDescription className="text-warning">Posting is locked in Preview.</AlertDescription>
          </Alert>
          <Alert className="border-success/40 bg-success/10">
            <AlertTitle>Success</AlertTitle>
            <AlertDescription className="text-success">Translation group saved.</AlertDescription>
          </Alert>
        </div>
      </Section>

      <Section title="Asynchronous states">
        <div className="grid gap-3 sm:grid-cols-3">
          <div role="status" className="flex min-h-24 items-center justify-center gap-2 rounded-md border border-border text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading queue…
          </div>
          <div className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-md border border-border p-3 text-center">
            <p className="text-sm font-medium text-foreground">No retained threads yet</p>
            <p className="text-xs text-muted-foreground">Threads appear once the pipeline retains a conversation.</p>
          </div>
          <div className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-center">
            <p className="text-sm font-medium text-destructive">Overview unavailable</p>
            <p className="text-xs text-muted-foreground">The last successful values remain visible with a stale notice.</p>
          </div>
        </div>
        <div className="mt-3 space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </Section>
    </div>
  );
}
