import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Filter, Shield, Users, Sparkles, X, Plus, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSaveSettings } from '@/hooks/useSettingsData';

export interface ContentFilterConfig {
  enabled: boolean;
  score_only?: boolean;
  default_threshold: number;
  editorial_guidelines: string;
  priority_topics: string[];
  low_priority_topics: string[];
  author_rules: Record<string, { rule: string; threshold?: number }>;
}

const defaultConfig: ContentFilterConfig = {
  enabled: false,
  score_only: false,
  default_threshold: 12,
  editorial_guidelines: '',
  priority_topics: [],
  low_priority_topics: [],
  author_rules: {},
};

interface Props {
  initialConfig?: ContentFilterConfig;
}

export default function ContentFilterSettings({ initialConfig }: Props) {
  const [config, setConfig] = useState<ContentFilterConfig>({ ...defaultConfig, ...initialConfig });
  const [newPriorityTopic, setNewPriorityTopic] = useState('');
  const [newLowPriorityTopic, setNewLowPriorityTopic] = useState('');
  const saveMutation = useSaveSettings();

  useEffect(() => {
    if (initialConfig) {
      setConfig({ ...defaultConfig, ...initialConfig });
    }
  }, [initialConfig]);

  // Fetch distinct authors with post counts
  const authorsQuery = useQuery({
    queryKey: ['author-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('posts')
        .select('author_handle')
        .not('author_handle', 'is', null);
      if (error) throw error;
      // Count manually since we can't do GROUP BY via PostgREST easily
      const counts: Record<string, number> = {};
      for (const row of data || []) {
        const handle = row.author_handle as string;
        if (handle) counts[handle] = (counts[handle] || 0) + 1;
      }
      return Object.entries(counts)
        .map(([handle, count]) => ({ handle, count }))
        .sort((a, b) => b.count - a.count);
    },
    staleTime: 120_000,
  });

  const authors = authorsQuery.data || [];

  const addTopic = (type: 'priority' | 'low_priority') => {
    const value = type === 'priority' ? newPriorityTopic.trim() : newLowPriorityTopic.trim();
    if (!value) return;
    const key = type === 'priority' ? 'priority_topics' : 'low_priority_topics';
    if (!config[key].includes(value)) {
      setConfig({ ...config, [key]: [...config[key], value] });
    }
    if (type === 'priority') setNewPriorityTopic('');
    else setNewLowPriorityTopic('');
  };

  const removeTopic = (type: 'priority' | 'low_priority', topic: string) => {
    const key = type === 'priority' ? 'priority_topics' : 'low_priority_topics';
    setConfig({ ...config, [key]: config[key].filter(t => t !== topic) });
  };

  const setAuthorRule = (handle: string, rule: string, threshold?: number) => {
    const newRules = { ...config.author_rules };
    if (rule === 'ai_scoring') {
      delete newRules[handle];
    } else {
      newRules[handle] = { rule, ...(threshold != null ? { threshold } : {}) };
    }
    setConfig({ ...config, author_rules: newRules });
  };

  const getAuthorRule = (handle: string) => {
    return config.author_rules[handle]?.rule || 'ai_scoring';
  };

  const getAuthorThreshold = (handle: string) => {
    return config.author_rules[handle]?.threshold ?? config.default_threshold;
  };

  return (
    <div className="space-y-6">
      {/* Master Toggle */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center text-glass-foreground">
            <Filter className="w-5 h-5 mr-2" />Content Filtering
          </CardTitle>
          <CardDescription>
            Control which posts get delivered to Telegram based on AI importance scoring
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
            <div>
              <Label className="text-base font-medium">Enable Content Filtering</Label>
              <p className="text-sm text-muted-foreground mt-1">
                When off, all posts are delivered. When on, AI scores each post and only high-importance ones are sent.
              </p>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(checked) => setConfig({ ...config, enabled: checked, ...(checked ? { score_only: false } : {}) })}
            />
          </div>

          {!config.enabled && (
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
              <div>
                <Label className="text-base font-medium">Score Only (Preview Mode)</Label>
                <p className="text-sm text-muted-foreground mt-1">
                  AI scores each post but everything still gets delivered. Use this to preview scores in Monitoring before enabling the filter.
                </p>
              </div>
              <Switch
                checked={config.score_only ?? false}
                onCheckedChange={(checked) => setConfig({ ...config, score_only: checked })}
              />
            </div>
          )}

          {config.enabled && (
            <>
              <Separator />
              
              {/* Default Threshold - only when actively filtering */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base font-medium">Default Importance Threshold</Label>
                    <p className="text-sm text-muted-foreground">Posts scoring below this are skipped (1 = deliver almost everything, 20 = only critical breaking news)</p>
                  </div>
                  <Badge variant="outline" className="text-lg px-3 py-1">{config.default_threshold}/20</Badge>
                </div>
                <Slider
                  value={[config.default_threshold]}
                  onValueChange={([v]) => setConfig({ ...config, default_threshold: v })}
                  min={1}
                  max={20}
                  step={1}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1 — Deliver all</span>
                  <span>5 — Low bar</span>
                  <span>10 — Balanced</span>
                  <span>15 — Selective</span>
                  <span>20 — Critical only</span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {(config.enabled || config.score_only) && (
        <>
          {/* Editorial Guidelines */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground">
                <Sparkles className="w-5 h-5 mr-2" />Editorial Guidelines
              </CardTitle>
              <CardDescription>
                Tell the AI what matters to your audience in plain language. This is injected directly into the scoring prompt.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={config.editorial_guidelines}
                onChange={(e) => setConfig({ ...config, editorial_guidelines: e.target.value })}
                className="glass-input min-h-[120px]"
                placeholder="e.g., Prioritize anything related to Iran, the war, GCC countries, sanctions, and military developments..."
              />

              {/* Priority Topics */}
              <div className="space-y-2">
                <Label>High Priority Topics (boost score)</Label>
                <div className="flex gap-2">
                  <Input
                    value={newPriorityTopic}
                    onChange={(e) => setNewPriorityTopic(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addTopic('priority')}
                    placeholder="Add topic..."
                    className="glass-input"
                  />
                  <Button variant="outline" size="icon" onClick={() => addTopic('priority')}><Plus className="w-4 h-4" /></Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {config.priority_topics.map(topic => (
                    <Badge key={topic} className="bg-green-500/20 text-green-400 border-green-500/30 gap-1">
                      {topic}
                      <X className="w-3 h-3 cursor-pointer" onClick={() => removeTopic('priority', topic)} />
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Low Priority Topics */}
              <div className="space-y-2">
                <Label>Low Priority Topics (lower score)</Label>
                <div className="flex gap-2">
                  <Input
                    value={newLowPriorityTopic}
                    onChange={(e) => setNewLowPriorityTopic(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addTopic('low_priority')}
                    placeholder="Add topic..."
                    className="glass-input"
                  />
                  <Button variant="outline" size="icon" onClick={() => addTopic('low_priority')}><Plus className="w-4 h-4" /></Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {config.low_priority_topics.map(topic => (
                    <Badge key={topic} className="bg-orange-500/20 text-orange-400 border-orange-500/30 gap-1">
                      {topic}
                      <X className="w-3 h-3 cursor-pointer" onClick={() => removeTopic('low_priority', topic)} />
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Author Rules */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground">
                <Users className="w-5 h-5 mr-2" />Per-Author Rules
              </CardTitle>
              <CardDescription>
                Override filtering for specific Twitter authors. Authors are auto-discovered from your feed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {authorsQuery.isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : authors.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No authors found yet. They will appear as posts are ingested.</p>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Author</TableHead>
                        <TableHead className="text-right">Posts</TableHead>
                        <TableHead>Rule</TableHead>
                        <TableHead>Threshold</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {authors.slice(0, 50).map(({ handle, count }) => {
                        const rule = getAuthorRule(handle);
                        return (
                          <TableRow key={handle}>
                            <TableCell className="font-mono text-sm">@{handle}</TableCell>
                            <TableCell className="text-right text-muted-foreground">{count.toLocaleString()}</TableCell>
                            <TableCell>
                              <Select value={rule} onValueChange={(v) => setAuthorRule(handle, v)}>
                                <SelectTrigger className="w-[180px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="ai_scoring">Use AI scoring</SelectItem>
                                  <SelectItem value="always_deliver">Always deliver</SelectItem>
                                  <SelectItem value="always_skip">Always skip</SelectItem>
                                  <SelectItem value="custom_threshold">Custom threshold</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              {rule === 'custom_threshold' ? (
                                <div className="flex items-center gap-2">
                                  <Slider
                                    value={[getAuthorThreshold(handle)]}
                                    onValueChange={([v]) => setAuthorRule(handle, 'custom_threshold', v)}
                                    min={1}
                                    max={10}
                                    step={1}
                                    className="w-24"
                                  />
                                  <Badge variant="outline">{getAuthorThreshold(handle)}</Badge>
                                </div>
                              ) : rule === 'always_deliver' ? (
                                <Badge className="bg-green-500/20 text-green-400 border-green-500/30">All</Badge>
                              ) : rule === 'always_skip' ? (
                                <Badge className="bg-red-500/20 text-red-400 border-red-500/30">None</Badge>
                              ) : (
                                <span className="text-sm text-muted-foreground">Default ({config.default_threshold})</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Save Button */}
      <Button
        onClick={() => saveMutation.mutate({ key: 'content_filter', value: config })}
        disabled={saveMutation.isPending}
        className="bg-gradient-primary hover:opacity-90 text-white w-full"
      >
        {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Shield className="w-4 h-4 mr-2" />}
        Save Content Filter Settings
      </Button>
    </div>
  );
}
