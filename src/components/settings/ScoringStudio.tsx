import { useEffect, useMemo, useState } from 'react';
import { Brain, FlaskConical, Loader2, Plus, Save, SlidersHorizontal, Target, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  DEFAULT_SCORING_POLICY,
  SCORING_V2_AXIS_KEYS,
  type AudienceClass,
  type ScoringPolicy,
  type ScoringPolicyProfile,
  type ScoringV2AxisKey,
  useSaveSettings,
} from '@/hooks/useSettingsData';
import { invokeAdminAction } from '@/api/adminActions';

interface Props {
  initial?: ScoringPolicy;
}

const CLASS_LABELS: Record<AudienceClass, string> = {
  direct_focus: 'Direct focus',
  adjacent: 'Adjacent',
  global_exception: 'Global exception',
  off_topic: 'Off topic',
};

const AXIS_LABELS: Record<ScoringV2AxisKey, string> = {
  focus_relevance: 'Focus relevance',
  geopolitical_weight: 'Geopolitical weight',
  audience_value: 'Audience value',
  materiality: 'Materiality',
  freshness: 'Freshness',
  credibility: 'Credibility',
  noise_penalty: 'Noise penalty',
};

const EXAMPLE_TEXT = 'Bitcoin breaks a major all-time high while oil markets react to new Middle East shipping risk.';

function normalizeStudioProfile(profile: ScoringPolicyProfile, index: number): ScoringPolicyProfile {
  const fallback = DEFAULT_SCORING_POLICY.profiles.find((item) => item.id === profile.id) ?? DEFAULT_SCORING_POLICY.profiles[index] ?? DEFAULT_SCORING_POLICY.profiles[0];
  const raw = profile as Partial<ScoringPolicyProfile>;
  return {
    ...fallback,
    ...raw,
    id: raw.id ?? fallback.id,
    name: raw.name ?? fallback.name,
    audience_description: raw.audience_description ?? fallback.audience_description,
    focus_entities: Array.isArray(raw.focus_entities) ? raw.focus_entities : fallback.focus_entities,
    aliases: Array.isArray(raw.aliases) ? raw.aliases : fallback.aliases,
    geographies: Array.isArray(raw.geographies) ? raw.geographies : fallback.geographies,
    blocked_categories: Array.isArray(raw.blocked_categories) ? raw.blocked_categories : fallback.blocked_categories,
    prompt_notes: raw.prompt_notes ?? fallback.prompt_notes,
    thresholds: { ...fallback.thresholds, ...(raw.thresholds ?? {}) },
    global_exceptions: Array.isArray(raw.global_exceptions) ? raw.global_exceptions : fallback.global_exceptions,
    review_only_exception_ids: Array.isArray(raw.review_only_exception_ids) ? raw.review_only_exception_ids : fallback.review_only_exception_ids,
    axis_weights: { ...fallback.axis_weights, ...(raw.axis_weights ?? {}) },
    author_overrides: { ...fallback.author_overrides, ...(raw.author_overrides ?? {}) },
  };
}

function normalizeInitial(initial?: ScoringPolicy): ScoringPolicy {
  if (!initial) return DEFAULT_SCORING_POLICY;
  const profiles = Array.isArray(initial.profiles) && initial.profiles.length > 0
    ? initial.profiles.map((profile, index) => normalizeStudioProfile(profile, index))
    : DEFAULT_SCORING_POLICY.profiles;
  return {
    ...DEFAULT_SCORING_POLICY,
    ...initial,
    profiles,
    adjudication: { ...DEFAULT_SCORING_POLICY.adjudication, ...initial.adjudication },
    learning: { ...DEFAULT_SCORING_POLICY.learning, ...initial.learning },
  };
}

function makeProfileCopy(profile: ScoringPolicyProfile): ScoringPolicyProfile {
  return JSON.parse(JSON.stringify(profile)) as ScoringPolicyProfile;
}

function listToText(items: string[]) {
  return items.join(', ');
}

function textToList(value: string) {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

export default function ScoringStudio({ initial }: Props) {
  const [policy, setPolicy] = useState<ScoringPolicy>(() => normalizeInitial(initial));
  const [previewText, setPreviewText] = useState(EXAMPLE_TEXT);
  const [previewAuthor, setPreviewAuthor] = useState('');
  const [previewResult, setPreviewResult] = useState<Record<string, unknown> | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [dryRunState, setDryRunState] = useState<string | null>(null);
  const saveMutation = useSaveSettings();
  const { toast } = useToast();

  useEffect(() => {
    setPolicy(normalizeInitial(initial));
  }, [initial]);

  const activeProfile = useMemo(() => {
    return policy.profiles.find((profile) => profile.id === policy.active_profile_id) ?? policy.profiles[0] ?? DEFAULT_SCORING_POLICY.profiles[0];
  }, [policy.profiles, policy.active_profile_id]);
  const oilEnergyRule = activeProfile.global_exceptions.find((rule) => rule.id === 'oil_energy');
  const leaderRule = activeProfile.global_exceptions.find((rule) => rule.id === 'major_leader_statement');
  const globalMegaRule = activeProfile.global_exceptions.find((rule) => rule.id === 'global_mega_event');
  const globalMegaReviewOnly = Boolean(globalMegaRule && activeProfile.review_only_exception_ids.includes('global_mega_event'));

  const updatePolicy = (patch: Partial<ScoringPolicy>) => setPolicy((current) => ({ ...current, ...patch }));

  const updateProfile = (patch: Partial<ScoringPolicyProfile>) => {
    setPolicy((current) => ({
      ...current,
      profiles: current.profiles.map((profile) => profile.id === activeProfile.id ? { ...profile, ...patch } : profile),
    }));
  };

  const updateThreshold = (klass: AudienceClass, key: 'threshold' | 'cap', value: number) => {
    updateProfile({
      thresholds: {
        ...activeProfile.thresholds,
        [klass]: { ...activeProfile.thresholds[klass], [key]: value },
      },
    });
  };

  const updateAxisWeight = (axis: ScoringV2AxisKey, value: number) => {
    updateProfile({ axis_weights: { ...activeProfile.axis_weights, [axis]: value } });
  };

  const addProfile = () => {
    const next = makeProfileCopy(activeProfile);
    next.id = `profile-${crypto.randomUUID().slice(0, 8)}`;
    next.name = `${activeProfile.name} copy`;
    setPolicy((current) => ({
      ...current,
      active_profile_id: next.id,
      profiles: [...current.profiles, next],
    }));
  };

  const removeProfile = () => {
    if (policy.profiles.length <= 1) {
      toast({ title: 'Keep at least one scoring profile', variant: 'destructive' });
      return;
    }
    const remaining = policy.profiles.filter((profile) => profile.id !== activeProfile.id);
    setPolicy((current) => ({
      ...current,
      active_profile_id: remaining[0].id,
      profiles: remaining,
    }));
  };

  const save = async () => {
    await saveMutation.mutateAsync({ key: 'scoring_policy', value: policy });
  };

  const preview = async () => {
    setPreviewing(true);
    setPreviewResult(null);
    try {
      const data = await invokeAdminAction<{ ok?: boolean; error?: string; result?: Record<string, unknown> }>(
        {
          action: 'preview_scoring_policy',
          text: previewText,
          author_handle: previewAuthor || undefined,
          profile_id: activeProfile.id,
        },
        { throwOnFailure: false },
      );
      if (!data?.ok) throw new Error(data?.error ?? 'Preview failed');
      setPreviewResult(data.result as Record<string, unknown>);
    } catch (e) {
      toast({ title: 'Preview failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setPreviewing(false);
    }
  };

  const dryRunBackfill = async () => {
    setDryRunState('checking');
    try {
      const data = await invokeAdminAction<{ ok?: boolean; error?: string; matched?: number }>(
        { action: 'backfill_score_v2', hours: 48, max: 100, dry_run: true },
        { throwOnFailure: false },
      );
      if (!data?.ok) throw new Error(data?.error ?? 'Dry run failed');
      setDryRunState(`${data.matched ?? 0} recent posts would be queued`);
    } catch (e) {
      setDryRunState(null);
      toast({ title: 'Dry run failed', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const runEval = async () => {
    setDryRunState('evaluating');
    try {
      const data = await invokeAdminAction<{ ok?: boolean; error?: string; summary?: { accuracy?: number | string; correct?: number; profile_id?: string }; results?: unknown[] }>(
        { action: 'run_scoring_eval', profile_id: activeProfile.id, limit: 10 },
        { throwOnFailure: false },
      );
      if (!data?.ok) throw new Error(data?.error ?? 'Evaluation failed');
      setDryRunState(`Evaluation accuracy: ${data.summary?.accuracy ?? 'n/a'}% on ${data.summary?.correct ?? 0}/${data.summary?.profile_id ? data.results?.length ?? 0 : 0} examples`);
    } catch (e) {
      setDryRunState(null);
      toast({ title: 'Evaluation failed', description: (e as Error).message, variant: 'destructive' });
    }
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex items-center text-glass-foreground">
              <Brain className="mr-2 h-5 w-5" />Scoring Studio
            </CardTitle>
            <CardDescription>
              Profile-driven audience fit scoring. Duplicate Gate still runs first; this decides whether non-duplicates match the account audience.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={policy.enabled ? 'default' : 'outline'}>{policy.enabled ? 'Enabled' : 'Disabled'}</Badge>
            <Badge variant="outline">{policy.mode === 'active' ? 'Active gating' : 'Shadow learning'}</Badge>
            <Badge variant="outline">{activeProfile.name}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <section className="space-y-4 rounded-lg border bg-muted/15 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2 sm:col-span-2">
                <Label>Active profile</Label>
                <Select value={policy.active_profile_id} onValueChange={(value) => updatePolicy({ active_profile_id: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {policy.profiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2 self-end">
                <Button type="button" variant="outline" onClick={addProfile}><Plus className="mr-1.5 h-4 w-4" />Copy</Button>
                <Button type="button" variant="outline" onClick={removeProfile}><X className="mr-1.5 h-4 w-4" />Delete</Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-md border bg-background/50 p-3">
                <div>
                  <Label>Run v2 scorer</Label>
                  <p className="text-xs text-muted-foreground">Disabled means legacy scoring remains untouched.</p>
                </div>
                <Switch checked={policy.enabled} onCheckedChange={(enabled) => updatePolicy({ enabled })} />
              </div>
              <div className="space-y-2">
                <Label>Mode</Label>
                <Select value={policy.mode} onValueChange={(mode) => updatePolicy({ mode: mode as ScoringPolicy['mode'] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shadow">Shadow: record v2, keep legacy gates</SelectItem>
                    <SelectItem value="active">Active: v2 controls deliver/skip</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-md border border-primary/25 bg-primary/5 p-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Active tuning state</h3>
                  <p className="text-xs text-muted-foreground">Production V2 editorial tuning currently applied by this profile.</p>
                </div>
                <Badge variant="outline">{policy.mode === 'active' ? 'active' : 'shadow'}</Badge>
              </div>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div className="rounded border bg-background/50 px-2 py-1.5">
                  <p className="font-medium">Regional escalation auto</p>
                  <p className="text-muted-foreground">Adjacent skips from 10.0 to 12.49 with urgent regional/security/oil terms deliver.</p>
                </div>
                <div className="rounded border bg-background/50 px-2 py-1.5">
                  <p className="font-medium">Oil / energy shock &gt;={oilEnergyRule?.threshold ?? 14}</p>
                  <p className="text-muted-foreground">Lowered global exception threshold for oil, shipping, OPEC, and energy-security events.</p>
                </div>
                <div className="rounded border bg-background/50 px-2 py-1.5">
                  <p className="font-medium">Major leader statement &gt;={leaderRule?.threshold ?? 14}</p>
                  <p className="text-muted-foreground">Lowered threshold for material war, oil, sanctions, and regional-security statements.</p>
                </div>
                <div className="rounded border bg-background/50 px-2 py-1.5">
                  <p className="font-medium">Global mega-event {globalMegaReviewOnly ? 'review pilot' : 'not review-only'}</p>
                  <p className="text-muted-foreground">&gt;={globalMegaRule?.threshold ?? 18} / cap {globalMegaRule?.cap ?? 18}; review-only items do not auto-deliver.</p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Profile name</Label>
                <Input value={activeProfile.name} onChange={(e) => updateProfile({ name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Profile ID</Label>
                <Input value={activeProfile.id} disabled className="font-mono text-xs" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Audience description</Label>
              <Textarea value={activeProfile.audience_description} onChange={(e) => updateProfile({ audience_description: e.target.value })} className="min-h-24" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <ListEditor label="Focus entities" value={activeProfile.focus_entities} onChange={(items) => updateProfile({ focus_entities: items })} />
              <ListEditor label="Aliases" value={activeProfile.aliases} onChange={(items) => updateProfile({ aliases: items })} />
              <ListEditor label="Geographies" value={activeProfile.geographies} onChange={(items) => updateProfile({ geographies: items })} />
              <ListEditor label="Blocked categories" value={activeProfile.blocked_categories} onChange={(items) => updateProfile({ blocked_categories: items })} />
            </div>

            <div className="space-y-2">
              <Label>Profile notes</Label>
              <Textarea value={activeProfile.prompt_notes} onChange={(e) => updateProfile({ prompt_notes: e.target.value })} className="min-h-24" />
            </div>
          </section>

          <section className="space-y-4 rounded-lg border bg-muted/15 p-4">
            <div>
              <h3 className="flex items-center text-sm font-semibold"><Target className="mr-2 h-4 w-4" />Thresholds and caps</h3>
              <p className="text-xs text-muted-foreground">Score must meet the class threshold after the class cap is applied.</p>
            </div>
            <div className="space-y-3">
              {(Object.keys(CLASS_LABELS) as AudienceClass[]).map((klass) => (
                <div key={klass} className="rounded-md border bg-background/50 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <Label>{CLASS_LABELS[klass]}</Label>
                    <Badge variant="outline">&gt;={activeProfile.thresholds[klass].threshold} / cap {activeProfile.thresholds[klass].cap}</Badge>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SliderBlock label="Threshold" value={activeProfile.thresholds[klass].threshold} min={1} max={klass === 'off_topic' ? 99 : 20} onChange={(v) => updateThreshold(klass, 'threshold', v)} />
                    <SliderBlock label="Cap" value={activeProfile.thresholds[klass].cap} min={1} max={20} onChange={(v) => updateThreshold(klass, 'cap', v)} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4 rounded-lg border bg-muted/15 p-4">
            <h3 className="flex items-center text-sm font-semibold"><SlidersHorizontal className="mr-2 h-4 w-4" />Neutral axis weights</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {SCORING_V2_AXIS_KEYS.map((axis) => (
                <SliderBlock key={axis} label={AXIS_LABELS[axis]} value={activeProfile.axis_weights[axis]} min={0} max={5} step={0.1} onChange={(v) => updateAxisWeight(axis, v)} />
              ))}
            </div>
          </div>

          <div className="space-y-4 rounded-lg border bg-muted/15 p-4">
            <h3 className="text-sm font-semibold">Global exceptions</h3>
            <div className="space-y-3">
              {activeProfile.global_exceptions.map((rule) => (
                <div key={rule.id} className="rounded-md border bg-background/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{rule.label}</p>
                    <Badge variant="outline">&gt;={rule.threshold} / cap {rule.cap}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{rule.description}</p>
                  <p className="mt-2 text-xs"><span className="text-muted-foreground">Examples:</span> {rule.examples.join(', ')}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-lg border bg-muted/15 p-4">
            <h3 className="flex items-center text-sm font-semibold"><FlaskConical className="mr-2 h-4 w-4" />Preview scoring</h3>
            <Input value={previewAuthor} onChange={(e) => setPreviewAuthor(e.target.value)} placeholder="Optional author handle" />
            <Textarea value={previewText} onChange={(e) => setPreviewText(e.target.value)} className="min-h-28" />
            <Button type="button" variant="outline" onClick={preview} disabled={previewing}>
              {previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Preview with GPT-5.4 Mini
            </Button>
            {previewResult && (
              <div className="rounded-md border bg-background/60 p-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge>{String(previewResult.audience_class ?? 'unknown')}</Badge>
                  <Badge variant="outline">Score {String(previewResult.final_score ?? '--')} / &gt;={String(previewResult.threshold ?? '--')}</Badge>
                  <Badge variant="outline">Confidence {String(previewResult.audience_confidence ?? '--')}</Badge>
                </div>
                <p className="mt-2 text-muted-foreground">{String(previewResult.audience_reason ?? 'No reason')}</p>
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-lg border bg-muted/15 p-4">
            <h3 className="text-sm font-semibold">Shadow checks</h3>
            <p className="text-sm text-muted-foreground">Use dry-runs before switching v2 to active gating. These do not call X.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="button" variant="outline" onClick={dryRunBackfill}>Dry-run 48h backfill</Button>
              <Button type="button" variant="outline" onClick={runEval}>Run 10-case eval</Button>
            </div>
            {dryRunState && <p className="rounded-md border bg-background/60 p-3 text-sm">{dryRunState}</p>}
          </div>
        </section>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" onClick={save} disabled={saveMutation.isPending} className="bg-gradient-primary text-white hover:opacity-90">
            {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Scoring Policy
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ListEditor({ label, value, onChange }: { label: string; value: string[]; onChange: (items: string[]) => void }) {
  const [text, setText] = useState(listToText(value));

  useEffect(() => {
    setText(listToText(value));
  }, [value]);

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(textToList(e.target.value));
        }}
        className="min-h-20 text-sm"
        placeholder="Comma-separated values"
      />
    </div>
  );
}

function SliderBlock({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        <Badge variant="outline" className="font-mono">{Number.isInteger(value) ? value : value.toFixed(1)}</Badge>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([next]) => onChange(next)} />
    </div>
  );
}
