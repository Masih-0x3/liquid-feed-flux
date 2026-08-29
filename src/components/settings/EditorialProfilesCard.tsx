import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Sparkles, X, Loader2, RefreshCw, ChevronDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { DEFAULT_AXIS_WEIGHTS, SCORE_AXIS_KEYS, type EditorialProfile, type ScoreAxisKey } from '@/hooks/useSettingsData';
import { invokeAdminAction } from '@/api/adminActions';

interface Props {
  profiles: EditorialProfile[];
  activeProfileId: string | null;
}

const AXIS_LABELS: Record<ScoreAxisKey, string> = {
  iran_relevance: 'Iran relevance',
  severity: 'Severity',
  novelty: 'Novelty',
  credibility: 'Credibility',
  actionability: 'Actionability',
  noise: 'Noise (penalty)',
};

/** Short blurbs for the profile editor — aligned with worker axis semantics. */
const AXIS_BLURBS: Record<ScoreAxisKey, string> = {
  iran_relevance: 'How tightly the item relates to Iran and your regional mandate. Raising weight pulls the final score toward that signal.',
  severity: 'How urgent or high-impact the story is (conflict, policy, markets, security).',
  novelty: 'How new or non-redundant the information is versus typical wire chatter.',
  credibility: 'Source quality, specificity, and whether claims are substantiated.',
  actionability: 'Whether the audience can do something meaningful with the information soon.',
  noise: 'Spam-like, thin, or off-topic feel. This axis is applied as a penalty toward the weighted final score.',
};

export default function EditorialProfilesCard({ profiles: initialProfiles, activeProfileId: initialActive }: Props) {
  const [profiles, setProfiles] = useState<EditorialProfile[]>(initialProfiles);
  const [activeId, setActiveId] = useState<string | null>(initialActive);
  const [editingId, setEditingId] = useState<string | null>(initialActive ?? initialProfiles[0]?.id ?? null);
  const [kwInputs, setKwInputs] = useState<Record<string, string>>({});
  const [rescoring, setRescoring] = useState(false);
  const [profileHelpOpen, setProfileHelpOpen] = useState(false);
  const { toast } = useToast();
  const legacyReadOnly = true;

  useEffect(() => { setProfiles(initialProfiles); }, [initialProfiles]);
  useEffect(() => { setActiveId(initialActive); }, [initialActive]);

  const editing = useMemo(() => profiles.find(p => p.id === editingId) ?? null, [profiles, editingId]);

  const updateEditing = (patch: Partial<EditorialProfile>) => {
    if (!editing) return;
    setProfiles(profiles.map(p => p.id === editing.id ? { ...p, ...patch } : p));
  };

  const setWeight = (k: ScoreAxisKey, v: number) => {
    if (!editing) return;
    updateEditing({ weights: { ...editing.weights, [k]: v } });
  };

  const addToList = (key: keyof Pick<EditorialProfile, 'must_include_keywords' | 'must_exclude_keywords' | 'required_tags_any' | 'blocked_tags'>, val: string) => {
    if (!editing || !val.trim()) return;
    const next = [...editing[key], val.trim()];
    updateEditing({ [key]: Array.from(new Set(next)) } as Partial<EditorialProfile>);
  };
  const removeFromList = (key: keyof Pick<EditorialProfile, 'must_include_keywords' | 'must_exclude_keywords' | 'required_tags_any' | 'blocked_tags'>, val: string) => {
    if (!editing) return;
    updateEditing({ [key]: editing[key].filter(x => x !== val) } as Partial<EditorialProfile>);
  };

  const handleRescore = async () => {
    setRescoring(true);
    try {
      const data = await invokeAdminAction<{ queued?: number; matched?: number; scanned?: number }>({ action: 'rescore_recent', hours: 48, only_missing: true });
      toast({
        title: 'Re-score queued',
        description: `Queued ${data?.queued ?? 0} of ${data?.matched ?? 0} posts missing axes (scanned ${data?.scanned ?? 0}).`,
      });
    } catch (e) {
      toast({ title: 'Re-score failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setRescoring(false);
    }
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center text-glass-foreground">
          <Sparkles className="w-5 h-5 mr-2" />Editorial Profiles
          {activeId && (
            <Badge className="ml-3 bg-primary/20 text-primary border-primary/30">
              Active: {profiles.find(p => p.id === activeId)?.name ?? '—'}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Legacy editorial profiles are retained for backwards-compatible reads. Scoring Studio is the only writable scoring policy;
          these values are shown for migration and parity checks and are not applied as a second control plane.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-muted-foreground">
          Read-only legacy snapshot. Edit the canonical scoring policy in Scoring Studio above.
        </div>
        <Collapsible open={profileHelpOpen} onOpenChange={setProfileHelpOpen}>
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-border bg-muted/30 p-3 text-left text-sm font-medium hover:bg-muted/50">
            <span>How profile decisions are ordered (worker)</span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${profileHelpOpen ? 'rotate-180' : ''}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-4 text-sm text-muted-foreground">
            <ol className="list-decimal space-y-1.5 pl-4">
              <li>Per-profile author overrides (always deliver or always skip).</li>
              <li>Blocked tags — if any blocked tag is present on the post, skip.</li>
              <li>Required tags — when the list is non-empty, at least one required tag must match or skip.</li>
              <li>Exclude keywords — a case-insensitive hit in the tweet text skips.</li>
              <li>Weighted axis score (or legacy importance when axes are missing), plus optional boosts for must-include keywords (+2 each, capped at 20).</li>
              <li>Profile threshold — deliver when final score is at or above the threshold.</li>
            </ol>
            <div className="rounded-md border">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="p-2 font-medium text-foreground">Axis</th>
                    <th className="p-2 font-medium text-foreground">In plain language</th>
                  </tr>
                </thead>
                <tbody>
                  {SCORE_AXIS_KEYS.map((k) => (
                    <tr key={k} className="border-b border-border/60 last:border-0">
                      <td className="p-2 align-top font-medium text-foreground">{AXIS_LABELS[k]}</td>
                      <td className="p-2 align-top">{AXIS_BLURBS[k]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Profile selector + actions */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 flex-1 min-w-[220px]">
            <Label>Legacy profile snapshot</Label>
            <Select value={editingId ?? ''} onValueChange={setEditingId} disabled={legacyReadOnly}>
              <SelectTrigger><SelectValue placeholder="No profiles — click New" /></SelectTrigger>
              <SelectContent>
                {profiles.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}{activeId === p.id ? ' • active' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {editing && (
          <>
            <Separator />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Profile name</Label>
                <Input value={editing.name} onChange={(e) => updateEditing({ name: e.target.value })} disabled={legacyReadOnly} />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Threshold</Label>
                  <Badge variant="outline">{editing.threshold}/20</Badge>
                </div>
                <Slider value={[editing.threshold]} onValueChange={([v]) => updateEditing({ threshold: v })} min={0} max={20} step={1} disabled={legacyReadOnly} />
              </div>
            </div>

            {/* Axis weights */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">Axis weights</Label>
              <p className="text-xs text-muted-foreground">
                Each axis 0-5. Higher = more influence on the final score (0-20). Noise subtracts.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                {SCORE_AXIS_KEYS.map((k) => (
                  <div key={k} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">{AXIS_LABELS[k]}</span>
                      <Badge variant="outline" className="font-mono text-xs">
                        {(editing.weights[k] ?? DEFAULT_AXIS_WEIGHTS[k]).toFixed(1)}
                      </Badge>
                    </div>
                    <Slider
                      value={[editing.weights[k] ?? DEFAULT_AXIS_WEIGHTS[k]]}
                      onValueChange={([v]) => setWeight(k, v)}
                      min={0} max={5} step={0.1} disabled={legacyReadOnly}
                    />
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Hard rules: keyword & tag chips */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {([
                { key: 'must_include_keywords', label: 'Must-include keywords (boost +2 each)', tone: 'green' },
                { key: 'must_exclude_keywords', label: 'Must-exclude keywords (auto-skip)', tone: 'red' },
                { key: 'required_tags_any', label: 'Required tags (any one must match)', tone: 'blue' },
                { key: 'blocked_tags', label: 'Blocked tags (auto-skip)', tone: 'orange' },
              ] as const).map(({ key, label, tone }) => (
                <div key={key} className="space-y-2">
                  <Label>{label}</Label>
                  <div className="flex gap-2">
                    <Input
                      value={kwInputs[key] ?? ''}
                      onChange={(e) => setKwInputs({ ...kwInputs, [key]: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          addToList(key, kwInputs[key] ?? '');
                          setKwInputs({ ...kwInputs, [key]: '' });
                        }
                      }}
                      placeholder="Add and press Enter"
                      disabled={legacyReadOnly}
                    />
                    <Button variant="outline" size="icon" onClick={() => { addToList(key, kwInputs[key] ?? ''); setKwInputs({ ...kwInputs, [key]: '' }); }} disabled={legacyReadOnly}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {editing[key].map((v) => (
                      <Badge
                        key={v}
                        className={
                          tone === 'green' ? 'bg-green-500/20 text-green-400 border-green-500/30 gap-1' :
                          tone === 'red' ? 'bg-red-500/20 text-red-400 border-red-500/30 gap-1' :
                          tone === 'blue' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30 gap-1' :
                          'bg-orange-500/20 text-orange-400 border-orange-500/30 gap-1'
                        }
                      >
                        {v}
                        {!legacyReadOnly && <X className="w-3 h-3 cursor-pointer" onClick={() => removeFromList(key, v)} />}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <Label>Editorial note (visible to you only — not sent to AI)</Label>
              <Textarea
                value={editing.editorial_note ?? ''}
                onChange={(e) => updateEditing({ editorial_note: e.target.value })}
                className="min-h-[80px]"
                placeholder="e.g., War mode — focus on kinetic events and ceasefire signals today"
                disabled={legacyReadOnly}
              />
            </div>
          </>
        )}

        <Separator />
        <div className="flex justify-between items-center gap-3 flex-wrap">
          <Button variant="outline" onClick={handleRescore} disabled={rescoring} size="sm">
            {rescoring ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Re-score last 48h (missing axes only)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
