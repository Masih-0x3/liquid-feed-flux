import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Brain, MessageSquare, Eye, Code, Sparkles, Send, Shield, Loader2, Filter, AtSign, ChevronDown } from 'lucide-react';
import {
  useSettingsData, useSaveSettings, openaiModels, messagePlaceholders, promptPlaceholders,
  type TranslationSettings, type TelegramSettings, type MessageTemplateSettings,
} from '@/hooks/useSettingsData';
import ContentFilterSettings, { type ContentFilterConfig } from '@/components/settings/ContentFilterSettings';
import XAutomationSettings from '@/components/settings/XAutomationSettings';
import TranslationPlayground from '@/components/settings/TranslationPlayground';
import PromptEditor from '@/components/settings/PromptEditor';

function insertPlaceholder(placeholder: string, textareaId: string, getter: string, setter: (val: string) => void) {
  const textarea = document.getElementById(textareaId) as HTMLTextAreaElement;
  if (textarea) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    setter(getter.substring(0, start) + placeholder + getter.substring(end));
    setTimeout(() => { textarea.setSelectionRange(start + placeholder.length, start + placeholder.length); textarea.focus(); }, 0);
  }
}

export default function Settings() {
  const { toast } = useToast();
  const { settingsQuery, samplesQuery } = useSettingsData();
  const saveMutation = useSaveSettings();
  const [selectedSample, setSelectedSample] = useState(0);

  // Local state for editing (initialized from query data)
  const settings = settingsQuery.data;
  const sampleTweets = samplesQuery.data || [];

  const [translationSettings, setTranslationSettings] = useState<TranslationSettings | null>(null);
  const [telegramSettings, setTelegramSettings] = useState<TelegramSettings | null>(null);
  const [messageTemplate, setMessageTemplate] = useState<MessageTemplateSettings | null>(null);

  // Sync from server on first load
  const ts = translationSettings ?? settings?.translation_prompt;
  const tgs = telegramSettings ?? settings?.telegram_config;
  const mt = messageTemplate ?? settings?.message_template;

  if (settingsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!ts || !tgs || !mt) return null;

  const selectedModel = openaiModels.find(m => m.id === ts.model);

  const getPlaceholderValue = (key: string, tweet: Record<string, unknown>) => {
    const accounts = tweet?.accounts as Record<string, unknown> | undefined;
    switch (key) {
      case '{content}': { const text = tweet?.text_original as string; return text && text !== 'RSS Item' ? text : '[Tweet content]'; }
      case '{author_handle}': return (accounts?.handle as string) || '[author_handle]';
      case '{author_name}': return (accounts?.display_name as string) || '[author_name]';
      case '{tweet_url}': return (tweet?.url as string) || '[tweet_url]';
      case '{published_date}': return tweet?.tweeted_at ? new Date(tweet.tweeted_at as string).toLocaleDateString() : '[date]';
      case '{has_media}': return (tweet?.has_media as boolean)?.toString() || 'false';
      case '{media_count}': return tweet?.has_media ? '[count]' : '0';
      case '{original_language}': return (tweet?.lang_original as string) || '[lang]';
      default: return key;
    }
  };

  const getMessagePlaceholderValue = (key: string, tweet: Record<string, unknown>) => {
    const accounts = tweet?.accounts as Record<string, unknown> | undefined;
    switch (key) {
      case '{translated_text}': return (tweet?.text_translated as string) || '\u062F\u0648\u0644\u062A \u062A\u0631\u0627\u0645\u067E \u0627\u0639\u0644\u0627\u0645 \u06A9\u0631\u062F...';
      case '{original_text}': return (tweet?.text_original as string) || 'Sample original text';
      case '{author_handle}': return (accounts?.handle as string) || '@sample';
      case '{author_name}': return (accounts?.display_name as string) || 'Sample Author';
      case '{source_link}': return mt.include_source_link ? `<a href="${(tweet?.url as string) || '#'}">${mt.source_link_text}</a>` : '';
      case '{published_date}': return tweet?.tweeted_at ? new Date(tweet.tweeted_at as string).toLocaleDateString('fa-IR') : '\u06F1\u06F4\u06F0\u06F4/\u06F6/\u06F1\u06F2';
      case '{published_time}': return tweet?.tweeted_at ? new Date(tweet.tweeted_at as string).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : '\u06F2\u06F1:\u06F3\u06F5';
      case '{hashtags}': return mt.custom_hashtags;
      case '{media_info}': return (tweet?.has_media as boolean) ? '\u{1F4F8} \u062A\u0635\u0648\u06CC\u0631' : '';
      default: return key;
    }
  };

  const renderMessagePreview = () => {
    const sampleTweet = sampleTweets[selectedSample];
    if (!sampleTweet) return '';
    return messagePlaceholders.reduce((tpl, p) => tpl.replace(new RegExp(p.key.replace(/[{}]/g, '\\$&'), 'g'), getMessagePlaceholderValue(p.key, sampleTweet)), mt.template);
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-3xl font-display font-bold text-glass-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure your pipeline integrations and translation prompts</p>
      </div>

      <Tabs defaultValue="translation" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="translation" className="flex items-center gap-2"><Brain className="w-4 h-4" />Translation</TabsTrigger>
          <TabsTrigger value="filter" className="flex items-center gap-2"><Filter className="w-4 h-4" />Content Filter</TabsTrigger>
          <TabsTrigger value="messages" className="flex items-center gap-2"><MessageSquare className="w-4 h-4" />Messages</TabsTrigger>
          <TabsTrigger value="telegram" className="flex items-center gap-2"><Send className="w-4 h-4" />Telegram</TabsTrigger>
          <TabsTrigger value="x-automation" className="flex items-center gap-2"><AtSign className="w-4 h-4" />X Automation</TabsTrigger>
        </TabsList>

        {/* Translation Tab */}
        <TabsContent value="translation" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground"><Sparkles className="w-5 h-5 mr-2" />AI Model Selection</CardTitle>
              <CardDescription>Choose the OpenAI model and configure its parameters</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="model_select">Model</Label>
                <Select value={ts.model} onValueChange={(v) => setTranslationSettings({ ...ts, model: v })}>
                  <SelectTrigger className="glass-input"><SelectValue placeholder="Select a model" /></SelectTrigger>
                  <SelectContent>
                    {openaiModels.map(model => (
                      <SelectItem key={model.id} value={model.id}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{model.name}</span>
                          <Badge variant={model.tier === 'latest' ? 'default' : model.tier === 'legacy' ? 'outline' : 'secondary'} className="text-[10px] uppercase">{model.tier}</Badge>
                          <div className="flex gap-1">{model.supports.map(s => <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>)}</div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedModel && (
                  <div className="mt-2 p-3 bg-muted/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">{selectedModel.description}</p>
                    <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                      <span>Max Tokens: {selectedModel.maxTokens.toLocaleString()}</span>
                      <span>Supports: {selectedModel.supports.join(', ')}</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{selectedModel?.useMaxCompletionTokens ? 'Max Completion Tokens' : 'Max Tokens'}</Label>
                  <Input type="number" min="1" max={selectedModel?.maxTokens || 4096} value={ts.max_completion_tokens} onChange={(e) => setTranslationSettings({ ...ts, max_completion_tokens: parseInt(e.target.value) || 1000 })} className="glass-input" />
                </div>
                {selectedModel?.supportsTemperature && (
                  <div className="space-y-2">
                    <Label>Temperature</Label>
                    <Input type="number" step="0.1" min="0" max="2" value={ts.temperature} onChange={(e) => setTranslationSettings({ ...ts, temperature: parseFloat(e.target.value) || 0 })} className="glass-input" />
                    <p className="text-xs text-muted-foreground">0 = deterministic, 2 = very random.</p>
                  </div>
                )}
                {selectedModel?.supportsReasoningEffort && (
                  <div className="space-y-2">
                    <Label>Reasoning effort</Label>
                    <Select value={ts.reasoning_effort ?? 'medium'} onValueChange={(v) => setTranslationSettings({ ...ts, reasoning_effort: v as 'minimal' | 'low' | 'medium' | 'high' })}>
                      <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="minimal">Minimal — fastest, cheapest</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium (recommended)</SelectItem>
                        <SelectItem value="high">High — deepest, slowest</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">How much hidden reasoning the model performs before answering.</p>
                  </div>
                )}
                {selectedModel?.supportsVerbosity && (
                  <div className="space-y-2">
                    <Label>Verbosity</Label>
                    <Select value={ts.verbosity ?? 'medium'} onValueChange={(v) => setTranslationSettings({ ...ts, verbosity: v as 'low' | 'medium' | 'high' })}>
                      <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low — terse output</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High — expansive</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Controls visible answer length, independent of reasoning depth.</p>
                  </div>
                )}
              </div>
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between text-xs text-muted-foreground hover:text-foreground border border-dashed border-border">
                    <span className="flex items-center gap-2"><Code className="w-3.5 h-3.5" />Advanced sampling parameters</span>
                    <ChevronDown className="w-4 h-4 transition-transform [&[data-state=open]]:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 pt-4">
                  <div className="grid grid-cols-3 gap-4">
                    {selectedModel?.supportsTopP && (
                      <div className="space-y-2">
                        <Label>Top P</Label>
                        <Input type="number" step="0.05" min="0" max="1" value={ts.top_p} onChange={(e) => setTranslationSettings({ ...ts, top_p: parseFloat(e.target.value) || 1 })} className="glass-input" />
                      </div>
                    )}
                    {selectedModel?.supportsPenalties && (
                      <>
                        <div className="space-y-2"><Label>Frequency Penalty</Label><Input type="number" step="0.1" min="-2" max="2" value={ts.frequency_penalty} onChange={(e) => setTranslationSettings({ ...ts, frequency_penalty: parseFloat(e.target.value) || 0 })} className="glass-input" /></div>
                        <div className="space-y-2"><Label>Presence Penalty</Label><Input type="number" step="0.1" min="-2" max="2" value={ts.presence_penalty} onChange={(e) => setTranslationSettings({ ...ts, presence_penalty: parseFloat(e.target.value) || 0 })} className="glass-input" /></div>
                      </>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    {selectedModel?.supportsSeed && (
                      <div className="space-y-2">
                        <Label>Seed (optional)</Label>
                        <Input
                          type="number"
                          placeholder="leave blank for random"
                          value={ts.seed ?? ''}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            setTranslationSettings({ ...ts, seed: raw === '' ? null : parseInt(raw) });
                          }}
                          className="glass-input"
                        />
                        <p className="text-xs text-muted-foreground">Same seed + same prompt → reproducible output.</p>
                      </div>
                    )}
                    {selectedModel?.supportsServiceTier && (
                      <div className="space-y-2">
                        <Label>Service tier</Label>
                        <Select value={ts.service_tier ?? 'auto'} onValueChange={(v) => setTranslationSettings({ ...ts, service_tier: v as 'auto' | 'default' | 'flex' | 'priority' })}>
                          <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Auto</SelectItem>
                            <SelectItem value="default">Default</SelectItem>
                            <SelectItem value="flex">Flex (cheaper, slower)</SelectItem>
                            <SelectItem value="priority">Priority (faster, costlier)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {selectedModel?.supportsParallelToolCalls && (
                      <div className="space-y-2">
                        <Label>Parallel tool calls</Label>
                        <Select value={String(ts.parallel_tool_calls ?? true)} onValueChange={(v) => setTranslationSettings({ ...ts, parallel_tool_calls: v === 'true' })}>
                          <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="true">Enabled</SelectItem>
                            <SelectItem value="false">Disabled (force single call)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <Button size="sm" variant="outline" onClick={() => saveMutation.mutate({ key: 'translation_prompt', value: ts })} disabled={saveMutation.isPending}>
                      Save model parameters
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground"><MessageSquare className="w-5 h-5 mr-2" />Translation Prompt Configuration</CardTitle>
              <CardDescription>Configure the AI translation prompts with dynamic placeholders</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="system_prompt">System Prompt</Label>
                <PromptEditor
                  id="system_prompt"
                  value={ts.system_prompt}
                  onChange={(v) => setTranslationSettings({ ...ts, system_prompt: v })}
                  placeholder="Enter the system prompt for translation..."
                  minHeight={360}
                  maxLength={20000}
                  title="System Prompt"
                />
              </div>
              <Separator />
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="user_prompt_template">User Prompt Template</Label>
                  <div className="flex items-center gap-2"><Eye className="w-4 h-4" /><span className="text-sm text-muted-foreground">Available Placeholders</span></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {promptPlaceholders.map(p => (
                    <Button key={p.key} variant="outline" size="sm" onClick={() => insertPlaceholder(p.key, 'user_prompt_template', ts.user_prompt_template, (v) => setTranslationSettings({ ...ts, user_prompt_template: v }))} className="justify-start h-auto p-3">
                      <div className="text-left"><div className="font-mono text-xs text-primary">{p.key}</div><div className="text-xs text-muted-foreground">{p.description}</div></div>
                    </Button>
                  ))}
                </div>
                <PromptEditor
                  id="user_prompt_template"
                  value={ts.user_prompt_template}
                  onChange={(v) => setTranslationSettings({ ...ts, user_prompt_template: v })}
                  placeholder="Enter the user prompt template..."
                  minHeight={240}
                  maxLength={10000}
                  title="User Prompt Template"
                />
              </div>
              <Separator />
              {sampleTweets.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2"><Code className="w-4 h-4" />Prompt Preview with Real Data</Label>
                    <Select value={selectedSample.toString()} onValueChange={(v) => setSelectedSample(parseInt(v))}>
                      <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>{sampleTweets.map((_, i) => <SelectItem key={i} value={i.toString()}>Sample Tweet {i + 1}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <div className="text-sm font-medium mb-2">Preview of User Prompt:</div>
                    <div className="text-sm font-mono bg-background p-3 rounded border whitespace-pre-wrap">
                      {promptPlaceholders.reduce((tpl, p) => tpl.replace(new RegExp(p.key.replace(/[{}]/g, '\\$&'), 'g'), getPlaceholderValue(p.key, sampleTweets[selectedSample])), ts.user_prompt_template)}
                    </div>
                  </div>
                </div>
              )}
              <div className="flex gap-3">
                <Button onClick={() => saveMutation.mutate({ key: 'translation_prompt', value: ts })} disabled={saveMutation.isPending} className="bg-gradient-primary hover:opacity-90 text-white flex-1">
                  Save Translation Settings
                </Button>
                <Button onClick={async () => {
                  try {
                    const { error } = await supabase.functions.invoke('admin-retry', { body: { action: 'test_webhook' } });
                    if (error) throw error;
                    toast({ title: 'Test webhook sent!', description: 'Check the Posts page for new sample content' });
                  } catch { toast({ title: 'Test failed', variant: 'destructive' }); }
                }} variant="outline" disabled={saveMutation.isPending} className="border-primary/50 hover:bg-primary/10">
                  Test Pipeline
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Scoring rubric + classifier tool schema have moved to the Content Filter tab,
              where they conceptually belong (they only run when filtering/scoring is active). */}

          {/* Live Translation Playground */}
          <TranslationPlayground
            translationSettings={ts}
            contentFilter={(settings?.content_filter ?? { enabled: false }) as ContentFilterConfig}
            sampleTweets={sampleTweets}
          />
        </TabsContent>

        {/* Content Filter Tab */}
        <TabsContent value="filter" className="space-y-6">
          <ContentFilterSettings
            initialConfig={settings?.content_filter as ContentFilterConfig | undefined}
            translationSettings={ts}
            onTranslationSettingsChange={setTranslationSettings}
          />
        </TabsContent>

        <TabsContent value="messages" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground"><MessageSquare className="w-5 h-5 mr-2" />Telegram Message Template</CardTitle>
              <CardDescription>Configure how your translated messages appear in Telegram</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="message_template">Message Template</Label>
                  <div className="flex items-center gap-2"><Eye className="w-4 h-4" /><span className="text-sm text-muted-foreground">Available Placeholders</span></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {messagePlaceholders.map(p => (
                    <Button key={p.key} variant="outline" size="sm" onClick={() => insertPlaceholder(p.key, 'message_template', mt.template, (v) => setMessageTemplate({ ...mt, template: v }))} className="justify-start h-auto p-3">
                      <div className="text-left"><div className="font-mono text-xs text-primary">{p.key}</div><div className="text-xs text-muted-foreground">{p.description}</div></div>
                    </Button>
                  ))}
                </div>
                <Textarea id="message_template" value={mt.template} onChange={(e) => setMessageTemplate({ ...mt, template: e.target.value })} className="glass-input min-h-[150px] font-mono text-sm" placeholder="Enter your message template..." />
              </div>
              <Separator />
              <div className="space-y-4">
                <Label className="text-base font-medium">Message Options</Label>
                <div className="grid grid-cols-2 gap-4">
                  <Label className="flex items-center gap-2"><input type="checkbox" checked={mt.include_source_link} onChange={(e) => setMessageTemplate({ ...mt, include_source_link: e.target.checked })} className="rounded" />Include Source Link</Label>
                  <Label className="flex items-center gap-2"><input type="checkbox" checked={mt.include_media_caption} onChange={(e) => setMessageTemplate({ ...mt, include_media_caption: e.target.checked })} className="rounded" />Include Media Caption</Label>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Source Link Text</Label><Input value={mt.source_link_text} onChange={(e) => setMessageTemplate({ ...mt, source_link_text: e.target.value })} className="glass-input" /></div>
                  <div className="space-y-2"><Label>Custom Hashtags</Label><Input value={mt.custom_hashtags} onChange={(e) => setMessageTemplate({ ...mt, custom_hashtags: e.target.value })} className="glass-input" /></div>
                </div>
              </div>
              <Separator />
              {sampleTweets.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2"><Eye className="w-4 h-4" />Telegram Message Preview</Label>
                    <Select value={selectedSample.toString()} onValueChange={(v) => setSelectedSample(parseInt(v))}>
                      <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>{sampleTweets.map((_, i) => <SelectItem key={i} value={i.toString()}>Sample Tweet {i + 1}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg border-2 border-dashed border-muted-foreground/20">
                    <div className="text-sm font-medium mb-2 flex items-center gap-2"><Send className="w-4 h-4" />How it will appear in Telegram:</div>
                    <div className="text-sm bg-background p-4 rounded border whitespace-pre-wrap font-sans">{renderMessagePreview()}</div>
                  </div>
                </div>
              )}
              <div className="flex gap-3">
                <Button onClick={() => saveMutation.mutate({ key: 'message_template', value: mt })} disabled={saveMutation.isPending} className="bg-gradient-primary hover:opacity-90 text-white flex-1">Save Message Template</Button>
                <Button onClick={async () => {
                  try {
                    const { error } = await supabase.functions.invoke('admin-retry', {
                      body: { action: 'test_template', post: sampleTweets[selectedSample], template: mt.template, settings: { include_source_links: mt.include_source_link, custom_hashtags: mt.custom_hashtags } },
                    });
                    if (error) throw error;
                    toast({ title: 'Test message sent!', description: 'Check your Telegram channel' });
                  } catch { toast({ title: 'Test failed', variant: 'destructive' }); }
                }} variant="outline" disabled={saveMutation.isPending || sampleTweets.length === 0} className="border-primary/50 hover:bg-primary/10">
                  Test Message
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Telegram Tab */}
        <TabsContent value="telegram" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground"><Send className="w-5 h-5 mr-2" />Telegram Configuration</CardTitle>
              <CardDescription>Configure Telegram delivery settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-muted/50 rounded-lg border border-dashed border-muted-foreground/30 flex items-start gap-3">
                <Shield className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-glass-foreground">Bot Token &amp; Chat ID managed securely</p>
                  <p className="text-xs text-muted-foreground mt-1">Your Telegram credentials are stored as Supabase secrets (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID). To update them, go to your Supabase project → Edge Function Secrets.</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Parse Mode</Label>
                <Select value={tgs.parse_mode} onValueChange={(v) => setTelegramSettings({ ...tgs, parse_mode: v })}>
                  <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Markdown">Markdown</SelectItem>
                    <SelectItem value="MarkdownV2">MarkdownV2</SelectItem>
                    <SelectItem value="HTML">HTML</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => saveMutation.mutate({ key: 'telegram_config', value: tgs })} disabled={saveMutation.isPending} className="bg-gradient-primary hover:opacity-90 text-white w-full">Save Telegram Config</Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* X Automation Tab */}
        <TabsContent value="x-automation" className="space-y-6">
          <XAutomationSettings
            twitterHydration={settings?.twitter_hydration as { enabled?: boolean; max_attempts?: number } | undefined}
            xApiUsage={settings?.x_api_usage as { total?: number; calls_24h?: string[]; last_call_at?: string | null; last_error?: string | null; posts_24h?: string[]; media_uploads_24h?: string[] } | undefined}
            xPostingConfig={settings?.x_posting_config as Record<string, unknown> | undefined}
            xRateLimits={settings?.x_rate_limits as Record<string, unknown> | undefined}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

