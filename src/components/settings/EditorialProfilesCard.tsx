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
import { Sparkles, Plus, X, Copy, Trash2, Save, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useSaveSettings, makeDefaultProfile, DEFAULT_AXIS_WEIGHTS, SCORE_AXIS_KEYS, type EditorialProfile, type ScoreAxisKey } from '@/hooks/useSettingsData';

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

export default function EditorialProfilesCard({ profiles: initialProfiles, activeProfileId: initialActive }: Props) {
  const [profiles, setProfiles] = useState<EditorialProfile[]>(initialProfiles);
  const [activeId, setActiveId] = useState<string | null>(initialActive);
  const [editingId, setEditingId] = useState<string | null>(initialActive ?? initialProfiles[0]?.id ?? null);
  const [kwInputs, setKwInputs] = useState<Record<string, string>>({});
  const saveMutation = useSaveSettings();
  const { toast } = useToast();

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

  const handleNew = () => {
    const p = makeDefaultProfile(`Profile ${profiles.length + 1}`);
    setProfiles([...profiles, p]);
    setEditingId(p.id);
  };
  const handleDuplicate = () => {
    if (!editing) return;
    const p = { ...editing, id: crypto.randomUUID(), name: `${editing.name} (copy)` };
    setProfiles([...profiles, p]);
    setEditingId(p.id);
  };
  const handleDelete = () => {
    if (!editing) return;
    if (profiles.length <= 1) { toast({ title: 'Keep at least one profile', variant: 'destructive' }); return; }
    const next = profiles.filter(p => p.id !== editing.id);
    setProfiles(next);
    setEditingId(next[0]?.id ?? null);
    if (activeId === editing.id) setActiveId(next[0]?.id ?? null);
  };

  const handleSaveAll = async () => {
    try {
      await saveMutation.mutateAsync({ key: 'editorial_profiles', value: { profiles } });
      await saveMutation.mutateAsync({ key: 'active_profile_id', value: { id: activeId } });
      toast({ title: 'Editorial profiles saved' });
    } catch { /* toast handled in hook */ }
  };

  const handleSetActive = (id: string) => setActiveId(id);

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
          Day-to-day dial. Each profile bundles axis weights, threshold, and hard rules. Worker uses the active profile when set;
          otherwise falls back to the legacy Content Filter below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Profile selector + actions */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 flex-1 min-w-[220px]">
            <Label>Edit profile</Label>
            <Select value={editingId ?? ''} onValueChange={setEditingId}>
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
          <Button variant="outline" size="sm" onClick={handleNew}><Plus className="w-4 h-4 mr-1" />New</Button>
          <Button variant="outline" size="sm" onClick={handleDuplicate} disabled={!editing}><Copy className="w-4 h-4 mr-1" />Duplicate</Button>
          <Button variant="outline" size="sm" onClick={handleDelete} disabled={!editing}><Trash2 className="w-4 h-4 mr-1" />Delete</Button>
          <Button size="sm" onClick={() => editing && handleSetActive(editing.id)} disabled={!editing || activeId === editing?.id}>
            Set active
          </Button>
          {activeId && (
            <Button size="sm" variant="ghost" onClick={() => setActiveId(null)}>Clear active</Button>
          )}
        </div>

        {editing && (
          <>
            <Separator />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Profile name</Label>
                <Input value={editing.name} onChange={(e) => updateEditing({ name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Threshold</Label>
                  <Badge variant="outline">{editing.threshold}/20</Badge>
                </div>
                <Slider value={[editing.threshold]} onValueChange={([v]) => updateEditing({ threshold: v })} min={0} max={20} step={1} />
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
                      min={0} max={5} step={0.1}
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
                    />
                    <Button variant="outline" size="icon" onClick={() => { addToList(key, kwInputs[key] ?? ''); setKwInputs({ ...kwInputs, [key]: '' }); }}>
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
                        <X className="w-3 h-3 cursor-pointer" onClick={() => removeFromList(key, v)} />
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
              />
            </div>
          </>
        )}

        <Separator />
        <div className="flex justify-end">
          <Button onClick={handleSaveAll} disabled={saveMutation.isPending} className="bg-gradient-primary hover:opacity-90 text-white">
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Save profiles & active selection
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
