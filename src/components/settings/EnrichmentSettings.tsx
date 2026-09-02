import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, ChevronDown, Plus, X, Sparkles, Search, PenTool, Wand2, Layout, BookOpen, Loader2, RefreshCw, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { invokeAdminAction } from '@/api/adminActions';
import { fetchSettingsRows, saveSetting } from '@/api/settingsData';

interface EnrichmentConfig {
  enabled: boolean;
  model: string;
  version: string;
  mode: 'creator_analysis' | 'legacy';
  pipeline_mode: 'manual_only' | 'shadow_review' | 'required_for_x';
  review_mode: 'shadow_review' | 'auto_high_confidence' | 'manual_only';
  source_attribution_policy: 'compact' | 'always' | 'none';
  analyst_prompt: string;
  researcher_prompt: string;
  humanizer_prompt: string;
  archivist_prompt: string;
  composer_prompt: string;
  critic_prompt: string;
  max_research_tokens: number;
  max_analysis_tokens: number;
  max_humanizer_tokens: number;
  max_archivist_tokens: number;
  max_composer_tokens: number;
  max_critic_tokens: number;
  skip_research_below_score: number;
  archivist_lookback_days: number;
  archivist_max_posts: number;
  require_approval: boolean;
  thread_above_score: number;
  banned_phrases: string[];
  aggregator_review_threshold: number;
  aggregator_reject_threshold: number;
  ai_voice_review_threshold: number;
  ai_voice_reject_threshold: number;
  same_source_window_hours: number;
  same_source_review_threshold: number;
  research_cache_hours: number;
  min_creator_angle_chars: number;
}

interface VoiceSamples {
  samples: string[];
  updated_at: string | null;
}

interface VoiceGuide {
  guide: string;
  updated_at: string | null;
}

interface PersonalVoiceProfile {
  version?: string;
  summary?: string;
  language_rules?: string[];
  tone_rules?: string[];
  intent_rules?: Record<string, string>;
  avoid_rules?: string[];
  risk_notes?: string[];
  hashtags?: string[];
  updated_at?: string | null;
}

const DEFAULT_MASIH_VOICE_GUIDE = `X Voice & Style Guide for @masihh

Core identity: @masihh amplifies Iranian opposition voices, political prisoners, anti-regime protests, and Iran/Israel/US current events.

Overall voice:
- Direct, bold, unfiltered, passionate.
- Activist energy; never neutral or diplomatic.
- Sharp, sarcastic, blunt when calling out opponents.
- Serious political analysis mixed with raw immediate reaction.

Language rules:
- Choose one language per X draft. Do not mix English and Persian in the same post.
- Default to Persian for the core Iranian audience unless an English-only draft is clearly intentional.
- Use Persian for emotional impact, slogans, and short political punches.
- Use English-only drafts for explanations, international audience, detailed arguments, and clapbacks.
- Prefer short, punchy statements. Use emojis sparingly, especially flags.

Tone:
- Critical of the Islamic Republic, IRGC, judiciary, and political Islam.
- Supportive of Iranian opposition and resistance.
- Critical of performative activism, empty rhetoric, and hypocrisy.
- Direct and confrontational in replies.

Common modes: clapback, solidarity, political analysis, blunt observation, news reaction.
Hashtags: #KingRezaPahlaviForIran #IranRevolution2026 #Iran #DigitalBlackOutIran

Required enrichment structure:
- Put the factual news first.
- Then add the author's take as a separate postscript.
- Persian format: خبر: ... then پ.ن: ...
- English format: News: ... then P.S.: ...

Avoid: soft diplomatic tone, generic activist language, long meandering explanations, excessive positivity, performative intellectual flourishes.`;

const DEFAULT_CONFIG: EnrichmentConfig = {
  enabled: false,
  model: 'gpt-5.4-mini',
  version: 'creator-analysis-v2',
  mode: 'creator_analysis',
  pipeline_mode: 'manual_only',
  review_mode: 'shadow_review',
  source_attribution_policy: 'compact',
  analyst_prompt: `You are the editorial voice of a Persian-language X account that amplifies Iranians the Islamic Republic tries to silence. Your core worldview:
- The IRI (Islamic Republic of Iran) is an illegitimate terrorist theocracy. Not reformable -- must collapse entirely. You support full regime change, not reform.
- You champion Reza Pahlavi and a Pahlavi-led secular, democratic transition for Iran. جاویدشاه is not nostalgia -- it is active political advocacy.
- You are hawkish on foreign policy: pro-maximum-pressure sanctions, pro-Israel, pro-US military action against IRI proxies (Hezbollah, Hamas, Houthis). Anything that weakens the regime is good news.
- Human rights are central: women's rights (Woman Life Freedom), ethnic minorities (Kurds, Lurs, Baluch), political prisoners, due process. You name specific prisoners and their conditions.
- You despise Western left hypocrisy: groups like NIAC, Code Pink that protest US/Israeli pressure while staying silent on the regime's torture, rape, and executions of Iranians.
- You support Trump-era maximum pressure policy. You mock appeasement and failed nuclear deals.
- "Death to America/Death to Israel" is not rhetoric to you -- it is literal IRI policy.
- You sound like a real person with fire in their belly, not a diplomatic news reader. Sharp, direct, sometimes sarcastic. Never flowery.

CRITICAL EDITORIAL GUIDELINES:
- When the source is critical of Israel or Netanyahu: DO NOT adopt that framing. Instead, question the critic's motives, point out their hypocrisy (e.g., Arab states criticizing Israel while having terrible human rights records), or redirect to the IRI threat.
- You may criticize Netanyahu's domestic politics but NEVER echo anti-Israel framing from IRI allies, Arab states, or Western leftists.
- When IRI proxies or Arab states attack Israel: frame it as aggression by the IRI axis, not legitimate resistance.
- When reporting on Gaza/Palestine: focus on Hamas as an IRI proxy that uses Palestinians as human shields. Do NOT adopt "genocide" or "war criminal" framing from IRI-aligned sources.
- Default stance: Israel is a strategic ally against the IRI and its terror network. Protect this framing consistently.`,
  researcher_prompt: 'You are a senior news researcher specializing in Iran, the Middle East, US foreign policy toward Iran, Israeli/Gulf security dynamics, and Iranian human rights. Given a news item in English, search the web for: background context, related recent events, key figures involved, and any connection to the IRI regime, its proxies, or the Iranian opposition movement. Return structured facts in English -- no opinions, no analysis.',
  humanizer_prompt: `You are a rewriter that transforms AI-generated Persian text into something that sounds like a real Iranian activist/commentator typed it on their phone. The author is passionate, blunt, sometimes sarcastic. They use colloquial Persian (اینکه, همونطور, ینی). They mix formal political vocabulary with street-level directness. They do NOT sound like a news anchor or a diplomatic statement. Match the provided voice samples closely.`,
  archivist_prompt: 'You are an editorial archivist for a Persian opposition news account. Given a new story (in English) and recent posts, find narrative connections that reinforce the account\'s ongoing themes: regime oppression patterns, prisoner updates, proxy war developments, Western policy shifts on Iran, and the Iranian freedom movement. Only suggest a callback if it genuinely enriches the new post. callback_suggestion must be in natural colloquial Persian.',
  composer_prompt: 'You are a social media editor for a Persian opposition news account on X. Compose the full manual-review draft with factual news first, then the author take as a clearly separated postscript. Persian drafts use خبر: and پ.ن:. English drafts use News: and P.S. Never mix English and Persian in one draft.',
  critic_prompt: 'You are a strict X creator-quality critic. Judge whether this Persian post adds original creator value, avoids aggregator/clickbait patterns, and is likely to earn healthy replies, reposts, dwell, profile clicks, and follows without causing mute/block/report/not-interested reactions. Be conservative.',
  max_research_tokens: 4000,
  max_analysis_tokens: 2000,
  max_humanizer_tokens: 2000,
  max_archivist_tokens: 2000,
  max_composer_tokens: 2000,
  max_critic_tokens: 2000,
  skip_research_below_score: 16,
  archivist_lookback_days: 3,
  archivist_max_posts: 10,
  require_approval: true,
  thread_above_score: 18,
  banned_phrases: ['BREAKING', 'Breaking', 'فوری', 'قابل توجه است', 'جالب است که', 'لازم به ذکر است', 'در همین راستا'],
  aggregator_review_threshold: 35,
  aggregator_reject_threshold: 70,
  ai_voice_review_threshold: 35,
  ai_voice_reject_threshold: 70,
  same_source_window_hours: 6,
  same_source_review_threshold: 3,
  research_cache_hours: 24,
  min_creator_angle_chars: 80,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;

  const parsed: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    parsed.push(item);
  }
  return parsed;
}

function parseStringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;

  const parsed: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') return null;
    Object.defineProperty(parsed, key, {
      value: item,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return parsed;
}

function parsePersonalVoiceProfile(value: unknown): PersonalVoiceProfile | null {
  if (!isRecord(value)) return null;

  const profile: PersonalVoiceProfile = {};
  for (const key of ['version', 'summary'] as const) {
    const field = value[key];
    if (field === undefined) continue;
    if (typeof field !== 'string') return null;
    profile[key] = field;
  }

  for (const key of ['language_rules', 'tone_rules', 'avoid_rules', 'risk_notes', 'hashtags'] as const) {
    const field = value[key];
    if (field === undefined) continue;
    const rules = parseStringArray(field);
    if (!rules) return null;
    profile[key] = rules;
  }

  if (value.intent_rules !== undefined) {
    const intentRules = parseStringRecord(value.intent_rules);
    if (!intentRules) return null;
    profile.intent_rules = intentRules;
  }

  const updatedAt = value.updated_at;
  if (updatedAt !== undefined) {
    if (updatedAt === null) {
      profile.updated_at = null;
    } else if (typeof updatedAt === 'string') {
      profile.updated_at = updatedAt;
    } else {
      return null;
    }
  }

  return profile;
}

function parseEnrichmentConfig(value: unknown): EnrichmentConfig | null {
  if (!isRecord(value)) return null;

  const parsed: EnrichmentConfig = {
    ...DEFAULT_CONFIG,
    banned_phrases: [...DEFAULT_CONFIG.banned_phrases],
  };
  const target = parsed as unknown as Record<string, unknown>;
  const strings = [
    'model',
    'version',
    'analyst_prompt',
    'researcher_prompt',
    'humanizer_prompt',
    'archivist_prompt',
    'composer_prompt',
    'critic_prompt',
  ];
  const numbers = [
    'max_research_tokens',
    'max_analysis_tokens',
    'max_humanizer_tokens',
    'max_archivist_tokens',
    'max_composer_tokens',
    'max_critic_tokens',
    'skip_research_below_score',
    'archivist_lookback_days',
    'archivist_max_posts',
    'thread_above_score',
    'aggregator_review_threshold',
    'aggregator_reject_threshold',
    'ai_voice_review_threshold',
    'ai_voice_reject_threshold',
    'same_source_window_hours',
    'same_source_review_threshold',
    'research_cache_hours',
    'min_creator_angle_chars',
  ];

  for (const key of strings) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string') return null;
    target[key] = value[key];
  }
  for (const key of numbers) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) return null;
    target[key] = value[key];
  }
  for (const key of ['enabled', 'require_approval']) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'boolean') return null;
    target[key] = value[key];
  }

  const enumFields: Array<[string, readonly string[]]> = [
    ['mode', ['creator_analysis', 'legacy']],
    ['pipeline_mode', ['manual_only', 'shadow_review', 'required_for_x']],
    ['review_mode', ['shadow_review', 'auto_high_confidence', 'manual_only']],
    ['source_attribution_policy', ['compact', 'always', 'none']],
  ];
  for (const [key, allowed] of enumFields) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string' || !allowed.includes(value[key] as string)) return null;
    target[key] = value[key];
  }

  if (value.banned_phrases !== undefined) {
    if (!Array.isArray(value.banned_phrases) || !value.banned_phrases.every((phrase) => typeof phrase === 'string')) {
      return null;
    }
    parsed.banned_phrases = [...value.banned_phrases];
  }

  return parsed;
}

export default function EnrichmentSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatingProfile, setGeneratingProfile] = useState(false);
  const [config, setConfig] = useState<EnrichmentConfig | null>(null);
  const [usingDefaultBaseline, setUsingDefaultBaseline] = useState(false);
  const [voiceSamples, setVoiceSamples] = useState<VoiceSamples>({ samples: [], updated_at: null });
  const [voiceGuide, setVoiceGuide] = useState<VoiceGuide>({ guide: DEFAULT_MASIH_VOICE_GUIDE, updated_at: null });
  const [voiceProfile, setVoiceProfile] = useState<PersonalVoiceProfile | null>(null);
  const [newSample, setNewSample] = useState('');
  const [newBannedPhrase, setNewBannedPhrase] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    setLoadError(false);
    setConfig(null);
    setUsingDefaultBaseline(false);
    setVoiceSamples({ samples: [], updated_at: null });
    setVoiceGuide({ guide: DEFAULT_MASIH_VOICE_GUIDE, updated_at: null });
    setVoiceProfile(null);
    try {
      const data = await fetchSettingsRows(['enrichment_config', 'voice_samples', 'voice_guide', 'personal_voice_profile']);
      const byKey = new Map(data.map((row) => [row.key, row.value]));
      const enrichmentConfig = byKey.get('enrichment_config');
      const parsedConfig = enrichmentConfig === undefined || enrichmentConfig === null
        ? {
            ...DEFAULT_CONFIG,
            banned_phrases: [...DEFAULT_CONFIG.banned_phrases],
          }
        : parseEnrichmentConfig(enrichmentConfig);
      if (!parsedConfig) {
        throw new Error('invalid_enrichment_config');
      }
      setConfig(parsedConfig);
      setUsingDefaultBaseline(enrichmentConfig === undefined || enrichmentConfig === null);

      const samples = byKey.get('voice_samples');
      if (samples !== undefined && samples !== null) {
        if (!isRecord(samples) || !Array.isArray(samples.samples) || !samples.samples.every((sample) => typeof sample === 'string')) {
          throw new Error('invalid_voice_samples');
        }
        setVoiceSamples({
          samples: samples.samples,
          updated_at: typeof samples.updated_at === 'string' ? samples.updated_at : null,
        });
      }

      const guide = byKey.get('voice_guide');
      if (guide !== undefined && guide !== null) {
        if (!isRecord(guide) || (guide.guide !== undefined && typeof guide.guide !== 'string')) {
          throw new Error('invalid_voice_guide');
        }
        setVoiceGuide({
          guide: typeof guide.guide === 'string' && guide.guide.trim() ? guide.guide : DEFAULT_MASIH_VOICE_GUIDE,
          updated_at: typeof guide.updated_at === 'string' ? guide.updated_at : null,
        });
      }

      const profile = byKey.get('personal_voice_profile');
      if (profile !== undefined && profile !== null) {
        const parsedProfile = parsePersonalVoiceProfile(profile);
        if (!parsedProfile) throw new Error('invalid_personal_voice_profile');
        setVoiceProfile(parsedProfile);
      }
    } catch {
      setConfig(null);
      setUsingDefaultBaseline(false);
      setLoadError(true);
      console.warn(JSON.stringify({ component: 'EnrichmentSettings', action: 'settings_load_failed' }));
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    if (!config) return;
    setSaving(true);
    try {
      await saveSetting({ key: 'enrichment_config', value: config });
      toast({ title: 'Saved', description: 'Enrichment configuration updated.' });
    } catch (e) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
    setSaving(false);
  }

  async function saveVoiceSamples(samples: string[]) {
    const updated = { samples, updated_at: new Date().toISOString() };
    setVoiceSamples(updated);
    try {
      await saveSetting({ key: 'voice_samples', value: updated });
      toast({ title: 'Saved', description: 'Voice samples updated.' });
    } catch (e) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
  }

  async function saveVoiceGuideOnly() {
    const updated = { guide: voiceGuide.guide.trim() || DEFAULT_MASIH_VOICE_GUIDE, updated_at: new Date().toISOString() };
    setVoiceGuide(updated);
    try {
      await saveSetting({ key: 'voice_guide', value: updated });
      toast({ title: 'Saved', description: '@masihh voice guide updated.' });
    } catch (e) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    }
  }

  async function generateVoiceProfile() {
    setGeneratingProfile(true);
    try {
      const data = await invokeAdminAction<{ ok?: boolean; error?: string; profile?: unknown; usage?: unknown }>(
        { action: 'generate_voice_profile', guide: voiceGuide.guide },
        { throwOnFailure: false },
      );
      if (data?.ok === false) throw new Error(data.error ?? 'Voice profile generation failed');
      const profile = parsePersonalVoiceProfile(data?.profile);
      if (!profile) throw new Error('invalid_personal_voice_profile');
      setVoiceProfile(profile);
      setVoiceGuide({ guide: voiceGuide.guide, updated_at: new Date().toISOString() });
      toast({ title: 'Profile generated', description: `GPT-5.4 Mini used ${data.usage ?? 'unknown'} tokens.` });
    } catch (e) {
      toast({ title: 'Profile failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setGeneratingProfile(false);
    }
  }

  function addSample() {
    if (!newSample.trim()) return;
    const updated = [...voiceSamples.samples, newSample.trim()];
    setNewSample('');
    saveVoiceSamples(updated);
  }

  function removeSample(idx: number) {
    const updated = voiceSamples.samples.filter((_, i) => i !== idx);
    saveVoiceSamples(updated);
  }

  function addBannedPhrase() {
    if (!config) return;
    const phrase = newBannedPhrase.trim();
    if (!phrase || config.banned_phrases.includes(phrase)) return;
    setConfig({ ...config, banned_phrases: [...config.banned_phrases, phrase] });
    setNewBannedPhrase('');
  }

  function removeBannedPhrase(phrase: string) {
    if (!config) return;
    setConfig({ ...config, banned_phrases: config.banned_phrases.filter((item) => item !== phrase) });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (loadError || !config) {
    return (
      <Card className="glass-card border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-glass-foreground">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Enrichment settings are unavailable
          </CardTitle>
          <CardDescription>
            An authoritative configuration baseline could not be loaded. Editing and provider actions remain disabled.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={() => { void loadSettings(); }} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Retry loading settings
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {usingDefaultBaseline && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-muted-foreground">
          No saved enrichment configuration exists yet. You are viewing the authoritative default baseline; saving will create the first record.
        </div>
      )}

      {/* Master Toggle */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                AI Commentary Pipeline
              </CardTitle>
              <CardDescription>
                Creator-analysis drafts are separate from normal Telegram/X delivery. Manual-only mode lets X keep using plain translations.
              </CardDescription>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(enabled) => setConfig({ ...config, enabled })}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Model</Label>
              <Input value={config.model} onChange={(e) => setConfig({ ...config, model: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Require Approval Before Posting</Label>
              <div
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${config.require_approval ? 'border-green-500/40 bg-green-500/5' : 'border-red-500/40 bg-red-500/5'}`}
                onClick={() => setConfig({ ...config, require_approval: !config.require_approval })}
              >
                <Switch
                  checked={config.require_approval}
                  onCheckedChange={(require_approval) => setConfig({ ...config, require_approval })}
                />
                <div className="text-sm">
                  {config.require_approval ? (
                    <span className="text-green-400 font-medium">Enabled -- enriched drafts must be approved before their text is used on X</span>
                  ) : (
                    <span className="text-red-400 font-medium">Disabled -- only auto mode can use approved critic output without review</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Creator Analysis Mode */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            Creator Analysis Mode
          </CardTitle>
          <CardDescription>
            Controls the X-facing enrichment posture. Telegram remains translation-first.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label>Mode</Label>
            <Select value={config.mode} onValueChange={(mode) => setConfig({ ...config, mode: mode as EnrichmentConfig['mode'] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="creator_analysis">Creator analysis</SelectItem>
                <SelectItem value="legacy">Legacy commentary</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Pipeline Mode</Label>
            <Select value={config.pipeline_mode} onValueChange={(pipeline_mode) => setConfig({ ...config, pipeline_mode: pipeline_mode as EnrichmentConfig['pipeline_mode'] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual_only">Manual only</SelectItem>
                <SelectItem value="shadow_review">Shadow + review</SelectItem>
                <SelectItem value="required_for_x">Required for X</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Manual only does not auto-enrich or block plain X posting. Required for X should stay off until enrichment is production-ready.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Draft Review</Label>
            <Select value={config.review_mode} onValueChange={(review_mode) => setConfig({ ...config, review_mode: review_mode as EnrichmentConfig['review_mode'] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="shadow_review">Shadow + review</SelectItem>
                <SelectItem value="auto_high_confidence">Auto high-confidence</SelectItem>
                <SelectItem value="manual_only">Manual only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Source Attribution</Label>
            <Select value={config.source_attribution_policy} onValueChange={(source_attribution_policy) => setConfig({ ...config, source_attribution_policy: source_attribution_policy as EnrichmentConfig['source_attribution_policy'] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="compact">Compact attribution</SelectItem>
                <SelectItem value="always">Always cite source</SelectItem>
                <SelectItem value="none">Internal only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Anti-Aggregator Guard */}
      <Card>
        <CardHeader>
          <CardTitle>Anti-Aggregator Guard</CardTitle>
          <CardDescription>
            Flags drafts that look like rapid-fire aggregation, copied translation, or formulaic clickbait.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Aggregator Review / Reject</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" value={config.aggregator_review_threshold} onChange={(e) => setConfig({ ...config, aggregator_review_threshold: +e.target.value })} />
                <Input type="number" value={config.aggregator_reject_threshold} onChange={(e) => setConfig({ ...config, aggregator_reject_threshold: +e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>AI Voice Review / Reject</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" value={config.ai_voice_review_threshold} onChange={(e) => setConfig({ ...config, ai_voice_review_threshold: +e.target.value })} />
                <Input type="number" value={config.ai_voice_reject_threshold} onChange={(e) => setConfig({ ...config, ai_voice_reject_threshold: +e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Same Source Window / Count</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" value={config.same_source_window_hours} onChange={(e) => setConfig({ ...config, same_source_window_hours: +e.target.value })} />
                <Input type="number" value={config.same_source_review_threshold} onChange={(e) => setConfig({ ...config, same_source_review_threshold: +e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Minimum Creator Angle Characters</Label>
              <Input type="number" value={config.min_creator_angle_chars} onChange={(e) => setConfig({ ...config, min_creator_angle_chars: +e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Banned Phrases</Label>
            <div className="flex flex-wrap gap-2">
              {config.banned_phrases.map((phrase) => (
                <Badge key={phrase} variant="outline" className="gap-1">
                  {phrase}
                  <button type="button" onClick={() => removeBannedPhrase(phrase)} aria-label={`Remove ${phrase}`}>
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={newBannedPhrase} onChange={(e) => setNewBannedPhrase(e.target.value)} placeholder="Add phrase to avoid..." />
              <Button type="button" variant="outline" onClick={addBannedPhrase} disabled={!newBannedPhrase.trim()}>
                <Plus className="w-4 h-4 mr-1" />Add
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* @masihh Voice Guide */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PenTool className="w-5 h-5" />
            @masihh Voice Guide
          </CardTitle>
          <CardDescription>
            Canonical style source for manual enrichment. GPT-5.4 Mini turns this into a structured voice profile; drafts still require review before X uses them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={voiceGuide.guide}
            onChange={(e) => setVoiceGuide({ ...voiceGuide, guide: e.target.value })}
            rows={12}
            placeholder="Paste your X Voice & Style Guide here..."
            className="font-mono text-xs"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={saveVoiceGuideOnly}>
              <Save className="w-4 h-4 mr-2" />Save guide
            </Button>
            <Button type="button" onClick={generateVoiceProfile} disabled={generatingProfile || !voiceGuide.guide.trim()}>
              {generatingProfile ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
              Generate profile
            </Button>
          </div>
          {voiceProfile && (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">Profile summary</p>
                <p className="mt-1 text-sm">{voiceProfile.summary || 'No summary yet.'}</p>
                {voiceProfile.version && <Badge variant="outline" className="mt-2">{voiceProfile.version}</Badge>}
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">Tone rules</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {(voiceProfile.tone_rules || []).slice(0, 5).map((rule) => <li key={rule}>{rule}</li>)}
                </ul>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">Language rules</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {(voiceProfile.language_rules || []).slice(0, 5).map((rule) => <li key={rule}>{rule}</li>)}
                </ul>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">Risk notes</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {(voiceProfile.risk_notes || []).slice(0, 5).map((rule) => <li key={rule}>{rule}</li>)}
                </ul>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Voice / Persona */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PenTool className="w-5 h-5" />
            Your Voice / Persona
          </CardTitle>
          <CardDescription>
            Describe how you write and what your positions are. The Analyst agent uses this to write in your style.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={config.analyst_prompt}
            onChange={(e) => setConfig({ ...config, analyst_prompt: e.target.value })}
            rows={6}
            placeholder="You are [name], an Iranian political commentator. You are blunt, sarcastic when appropriate..."
          />
        </CardContent>
      </Card>

      {/* Voice Samples Library */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            Voice Samples
          </CardTitle>
          <CardDescription>
            Paste 5-10 of your real tweets. The Humanizer agent uses these to match your exact writing style.
            <br />
            <span className="text-xs text-muted-foreground">{voiceSamples.samples.length}/10 samples provided</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {voiceSamples.samples.map((sample, i) => (
            <div key={i} className="flex items-start gap-2 p-3 bg-muted/40 rounded-lg border">
              <p dir="auto" className="text-sm flex-1 text-right">{sample}</p>
              <Button variant="ghost" size="icon" className="shrink-0" onClick={() => removeSample(i)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
          {voiceSamples.samples.length < 10 && (
            <div className="flex gap-2">
              <Textarea
                value={newSample}
                onChange={(e) => setNewSample(e.target.value)}
                rows={2}
                placeholder="Paste one of your real tweets here..."
                dir="auto"
                className="flex-1"
              />
              <Button onClick={addSample} disabled={!newSample.trim()} className="shrink-0">
                <Plus className="w-4 h-4 mr-1" />Add
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Archivist Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            Archivist (Narrative Memory)
          </CardTitle>
          <CardDescription>
            Searches your recent posts for narrative connections to reference in new posts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Lookback Window (days)</Label>
              <div className="flex items-center gap-3">
                <Slider
                  value={[config.archivist_lookback_days]}
                  onValueChange={([v]) => setConfig({ ...config, archivist_lookback_days: v })}
                  min={1} max={7} step={1} className="flex-1"
                />
                <span className="text-sm font-mono w-6 text-center">{config.archivist_lookback_days}</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Max Posts to Consider</Label>
              <div className="flex items-center gap-3">
                <Slider
                  value={[config.archivist_max_posts]}
                  onValueChange={([v]) => setConfig({ ...config, archivist_max_posts: v })}
                  min={3} max={20} step={1} className="flex-1"
                />
                <span className="text-sm font-mono w-6 text-center">{config.archivist_max_posts}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Thresholds */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="w-5 h-5" />
            Thresholds
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Skip Research Below Score</Label>
              <div className="flex items-center gap-3">
                <Slider
                  value={[config.skip_research_below_score]}
                  onValueChange={([v]) => setConfig({ ...config, skip_research_below_score: v })}
                  min={8} max={20} step={1} className="flex-1"
                />
                <span className="text-sm font-mono w-6 text-center">{config.skip_research_below_score}</span>
              </div>
              <p className="text-xs text-muted-foreground">Posts below this score get commentary but no web research (saves tokens)</p>
            </div>
            <div className="space-y-2">
              <Label>Auto-Thread Above Score</Label>
              <div className="flex items-center gap-3">
                <Slider
                  value={[config.thread_above_score]}
                  onValueChange={([v]) => setConfig({ ...config, thread_above_score: v })}
                  min={14} max={20} step={1} className="flex-1"
                />
                <span className="text-sm font-mono w-6 text-center">{config.thread_above_score}</span>
              </div>
              <p className="text-xs text-muted-foreground">High-scoring posts may be composed as threads (2 tweets)</p>
            </div>
            <div className="space-y-2">
              <Label>Research Cache Hours</Label>
              <Input type="number" value={config.research_cache_hours} onChange={(e) => setConfig({ ...config, research_cache_hours: +e.target.value })} />
              <p className="text-xs text-muted-foreground">Reuses web research per source/story to avoid repeated web calls.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Advanced: Agent Prompts */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <Card>
          <CardHeader>
            <CollapsibleTrigger className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <Layout className="w-5 h-5" />
                <CardTitle className="text-base">Agent Prompts (Advanced)</CardTitle>
              </div>
              <ChevronDown className={`w-4 h-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Researcher Prompt</Label>
                <Textarea
                  value={config.researcher_prompt}
                  onChange={(e) => setConfig({ ...config, researcher_prompt: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Humanizer Prompt</Label>
                <Textarea
                  value={config.humanizer_prompt}
                  onChange={(e) => setConfig({ ...config, humanizer_prompt: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Archivist Prompt</Label>
                <Textarea
                  value={config.archivist_prompt}
                  onChange={(e) => setConfig({ ...config, archivist_prompt: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Composer Prompt</Label>
                <Textarea
                  value={config.composer_prompt}
                  onChange={(e) => setConfig({ ...config, composer_prompt: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Critic Prompt</Label>
                <Textarea
                  value={config.critic_prompt}
                  onChange={(e) => setConfig({ ...config, critic_prompt: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <div className="space-y-1">
                  <Label className="text-xs">Research Tokens</Label>
                  <Input type="number" value={config.max_research_tokens} onChange={(e) => setConfig({ ...config, max_research_tokens: +e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Analysis Tokens</Label>
                  <Input type="number" value={config.max_analysis_tokens} onChange={(e) => setConfig({ ...config, max_analysis_tokens: +e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Humanizer Tokens</Label>
                  <Input type="number" value={config.max_humanizer_tokens} onChange={(e) => setConfig({ ...config, max_humanizer_tokens: +e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Archivist Tokens</Label>
                  <Input type="number" value={config.max_archivist_tokens} onChange={(e) => setConfig({ ...config, max_archivist_tokens: +e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Composer Tokens</Label>
                  <Input type="number" value={config.max_composer_tokens} onChange={(e) => setConfig({ ...config, max_composer_tokens: +e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Critic Tokens</Label>
                  <Input type="number" value={config.max_critic_tokens} onChange={(e) => setConfig({ ...config, max_critic_tokens: +e.target.value })} />
                </div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Save Button */}
      <Button onClick={saveConfig} disabled={saving} className="w-full bg-gradient-primary hover:opacity-90 text-white">
        {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : <><Save className="w-4 h-4 mr-2" />Save Enrichment Settings</>}
      </Button>
    </div>
  );
}
