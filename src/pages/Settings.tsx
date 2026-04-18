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
import { Brain, MessageSquare, Eye, Code, Sparkles, Send, Key, Shield, Loader2, Filter, Newspaper } from 'lucide-react';
import {
  useSettingsData, useSaveSettings, openaiModels, messagePlaceholders, promptPlaceholders,
  type TranslationSettings, type OpenAISettings, type TelegramSettings, type MessageTemplateSettings, type DigestSettings,
} from '@/hooks/useSettingsData';
import ContentFilterSettings, { type ContentFilterConfig } from '@/components/settings/ContentFilterSettings';

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
  const [openaiSettings, setOpenaiSettings] = useState<OpenAISettings | null>(null);
  const [telegramSettings, setTelegramSettings] = useState<TelegramSettings | null>(null);
  const [messageTemplate, setMessageTemplate] = useState<MessageTemplateSettings | null>(null);
  const [digestSettings, setDigestSettings] = useState<DigestSettings | null>(null);
  const [digestTestLoading, setDigestTestLoading] = useState(false);
  const [digestTestResult, setDigestTestResult] = useState<any>(null);

  // Sync from server on first load
  const ts = translationSettings ?? settings?.translation_prompt;
  const os = openaiSettings ?? settings?.openai_config;
  const tgs = telegramSettings ?? settings?.telegram_config;
  const mt = messageTemplate ?? settings?.message_template;
  const ds = digestSettings ?? settings?.digest_config;

  if (settingsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!ts || !os || !tgs || !mt || !ds) return null;

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
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="translation" className="flex items-center gap-2"><Brain className="w-4 h-4" />Translation</TabsTrigger>
          <TabsTrigger value="filter" className="flex items-center gap-2"><Filter className="w-4 h-4" />Content Filter</TabsTrigger>
          <TabsTrigger value="messages" className="flex items-center gap-2"><MessageSquare className="w-4 h-4" />Messages</TabsTrigger>
          <TabsTrigger value="openai" className="flex items-center gap-2"><Key className="w-4 h-4" />OpenAI</TabsTrigger>
          <TabsTrigger value="telegram" className="flex items-center gap-2"><Send className="w-4 h-4" />Telegram</TabsTrigger>
          <TabsTrigger value="digest" className="flex items-center gap-2"><Newspaper className="w-4 h-4" />Digest</TabsTrigger>
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
                  </div>
                )}
              </div>
              {selectedModel?.supportsTemperature && (
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2"><Label>Top P</Label><Input type="number" step="0.1" min="0" max="1" value={ts.top_p} onChange={(e) => setTranslationSettings({ ...ts, top_p: parseFloat(e.target.value) || 1 })} className="glass-input" /></div>
                  <div className="space-y-2"><Label>Frequency Penalty</Label><Input type="number" step="0.1" min="-2" max="2" value={ts.frequency_penalty} onChange={(e) => setTranslationSettings({ ...ts, frequency_penalty: parseFloat(e.target.value) || 0 })} className="glass-input" /></div>
                  <div className="space-y-2"><Label>Presence Penalty</Label><Input type="number" step="0.1" min="-2" max="2" value={ts.presence_penalty} onChange={(e) => setTranslationSettings({ ...ts, presence_penalty: parseFloat(e.target.value) || 0 })} className="glass-input" /></div>
                </div>
              )}
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
                <Textarea id="system_prompt" value={ts.system_prompt} onChange={(e) => setTranslationSettings({ ...ts, system_prompt: e.target.value })} className="glass-input min-h-[200px] font-mono text-sm" placeholder="Enter the system prompt for translation..." />
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
                <Textarea id="user_prompt_template" value={ts.user_prompt_template} onChange={(e) => setTranslationSettings({ ...ts, user_prompt_template: e.target.value })} className="glass-input min-h-[120px] font-mono text-sm" placeholder="Enter the user prompt template..." />
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
        </TabsContent>

        {/* Content Filter Tab */}
        <TabsContent value="filter" className="space-y-6">
          <ContentFilterSettings initialConfig={settings?.content_filter as ContentFilterConfig | undefined} />
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

        {/* OpenAI Tab */}
        <TabsContent value="openai" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground"><Key className="w-5 h-5 mr-2" />OpenAI Configuration</CardTitle>
              <CardDescription>Configure the OpenAI integration parameters</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-muted/50 rounded-lg border border-dashed border-muted-foreground/30 flex items-start gap-3">
                <Shield className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-glass-foreground">API Key managed securely</p>
                  <p className="text-xs text-muted-foreground mt-1">Your OpenAI API key is stored as a Supabase secret and is never exposed to the browser. To update it, go to your Supabase project → Edge Function Secrets → OPENAI_API_KEY.</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Model</Label>
                <Select value={os.model} onValueChange={(v) => setOpenaiSettings({ ...os, model: v })}>
                  <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                  <SelectContent>{openaiModels.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Temperature</Label><Input type="number" step="0.1" min="0" max="2" value={os.temperature} onChange={(e) => setOpenaiSettings({ ...os, temperature: parseFloat(e.target.value) || 0 })} className="glass-input" /></div>
                <div className="space-y-2"><Label>Max Completion Tokens</Label><Input type="number" min="1" value={os.max_completion_tokens} onChange={(e) => setOpenaiSettings({ ...os, max_completion_tokens: parseInt(e.target.value) || 1000 })} className="glass-input" /></div>
              </div>
              <Button onClick={() => saveMutation.mutate({ key: 'openai_config', value: os })} disabled={saveMutation.isPending} className="bg-gradient-primary hover:opacity-90 text-white w-full">Save OpenAI Config</Button>
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

        {/* Digest Tab */}
        <TabsContent value="digest" className="space-y-6">
         <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground"><Key className="w-5 h-5 mr-2" />Twitter/X API Credentials</CardTitle>
              <CardDescription>Twitter API credentials are now managed as Supabase Edge Function secrets for improved security. Set them in the Supabase dashboard under Edge Function settings.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Required secrets: <code>TWITTER_CONSUMER_KEY</code>, <code>TWITTER_CONSUMER_SECRET</code>, <code>TWITTER_ACCESS_TOKEN</code>, <code>TWITTER_ACCESS_TOKEN_SECRET</code>
              </p>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground"><Sparkles className="w-5 h-5 mr-2" />Tweet Hydration (X API)</CardTitle>
              <CardDescription>When RSS delivers a truncated tweet, fetch the full text from the X API v2 before translation. Uses the same Twitter credentials configured above.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div>
                  <Label htmlFor="hydration_enabled" className="font-medium">Hydrate truncated tweets</Label>
                  <p className="text-xs text-muted-foreground mt-1">When off, truncated tweets will be translated as-is.</p>
                </div>
                <Checkbox
                  id="hydration_enabled"
                  checked={settings?.twitter_hydration?.enabled !== false}
                  onCheckedChange={(checked) => {
                    const next = { ...(settings?.twitter_hydration ?? { enabled: true, max_attempts: 3 }), enabled: !!checked };
                    saveMutation.mutate({ key: 'twitter_hydration', value: next });
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="p-3 bg-muted/30 rounded-lg">
                  <p className="text-xs text-muted-foreground">X API calls (last 24h)</p>
                  <p className="text-2xl font-bold text-glass-foreground">
                    {Array.isArray(settings?.x_api_usage?.calls_24h)
                      ? (settings.x_api_usage.calls_24h as string[]).filter((ts) => {
                          try { return new Date(ts).getTime() > Date.now() - 24 * 60 * 60 * 1000; } catch { return false; }
                        }).length
                      : 0}
                  </p>
                </div>
                <div className="p-3 bg-muted/30 rounded-lg">
                  <p className="text-xs text-muted-foreground">Total calls (all time)</p>
                  <p className="text-2xl font-bold text-glass-foreground">{settings?.x_api_usage?.total ?? 0}</p>
                  {settings?.x_api_usage?.last_call_at && (
                    <p className="text-xs text-muted-foreground mt-1">Last: {new Date(settings.x_api_usage.last_call_at as string).toLocaleString()}</p>
                  )}
                </div>
              </div>
              {settings?.x_api_usage?.last_error && (
                <p className="text-xs text-destructive">Last error: {String(settings.x_api_usage.last_error)}</p>
              )}
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground"><Newspaper className="w-5 h-5 mr-2" />Digest Preferences</CardTitle>
              <CardDescription>Configure how frequently digests are compiled and their format</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Frequency</Label>
                  <Select value={ds.frequency_minutes.toString()} onValueChange={(v) => setDigestSettings({ ...ds, frequency_minutes: parseInt(v) })}>
                    <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">Every 30 minutes</SelectItem>
                      <SelectItem value="60">Every 1 hour</SelectItem>
                      <SelectItem value="120">Every 2 hours</SelectItem>
                      <SelectItem value="240">Every 4 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Max Bullet Points</Label>
                  <Input type="number" min="1" max="20" value={ds.max_bullets} onChange={(e) => setDigestSettings({ ...ds, max_bullets: parseInt(e.target.value) || 10 })} className="glass-input" />
                </div>
                <div className="space-y-2">
                  <Label>Min Posts to Trigger</Label>
                  <Input type="number" min="1" max="50" value={ds.min_posts} onChange={(e) => setDigestSettings({ ...ds, min_posts: parseInt(e.target.value) || 2 })} className="glass-input" />
                </div>
                <div className="space-y-2">
                  <Label>Header Format</Label>
                  <Input value={ds.header_format} onChange={(e) => setDigestSettings({ ...ds, header_format: e.target.value })} className="glass-input" placeholder="📰 News Digest — {time}" />
                  <p className="text-xs text-muted-foreground">Use {'{time}'} for the current time</p>
                </div>
              </div>
              <Button onClick={() => saveMutation.mutate({ key: 'digest_config', value: ds })} disabled={saveMutation.isPending} className="bg-gradient-primary hover:opacity-90 text-white w-full">
                Save Digest Settings
              </Button>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground"><Eye className="w-5 h-5 mr-2" />Digest Dry Run</CardTitle>
              <CardDescription>Test the digest pipeline without posting to Twitter. Shows posts, OpenAI prompt, summary, and formatted tweets.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={async () => {
                  setDigestTestLoading(true);
                  setDigestTestResult(null);
                  try {
                    const { data, error } = await supabase.functions.invoke('digest-compiler', {
                      body: {
                        dry_run: true,
                        config: {
                          frequency_minutes: ds.frequency_minutes,
                          max_bullets: ds.max_bullets,
                          min_posts: ds.min_posts,
                          header_format: ds.header_format,
                        },
                      },
                    });
                    if (error) throw error;
                    setDigestTestResult(data);
                  } catch (e: any) {
                    toast({ title: 'Dry run failed', description: e.message, variant: 'destructive' });
                  } finally {
                    setDigestTestLoading(false);
                  }
                }}
                disabled={digestTestLoading}
                variant="outline"
                className="border-primary/50 hover:bg-primary/10 w-full"
              >
                {digestTestLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Running Dry Test...</> : <>🧪 Run Dry Test (No Posting)</>}
              </Button>

              {digestTestResult && (
                <div className="space-y-4 mt-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <Badge variant="secondary">{digestTestResult.post_count ?? 0} posts</Badge>
                    {digestTestResult.period_start && digestTestResult.period_end && (
                      <span>from {new Date(digestTestResult.period_start).toLocaleTimeString()} → {new Date(digestTestResult.period_end).toLocaleTimeString()}</span>
                    )}
                    {digestTestResult.reason && <Badge variant="outline">{digestTestResult.reason}</Badge>}
                    {digestTestResult.openai_finish_reason && <Badge variant="outline">finish: {digestTestResult.openai_finish_reason}</Badge>}
                  </div>

                  {digestTestResult.warning && (
                    <div className="rounded-lg border border-primary/30 bg-muted/50 p-3 text-sm text-muted-foreground">
                      {digestTestResult.warning}
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">📥 Posts Found ({digestTestResult.post_count ?? 0})</Label>
                    <div className="max-h-56 overflow-y-auto bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
                      {digestTestResult.posts?.length > 0 ? digestTestResult.posts.map((p: any, i: number) => (
                        <div key={i} className="p-2 bg-background rounded border">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs text-primary">@{p.author_handle || 'unknown'}</span>
                            {p.created_at && <span className="text-[10px] text-muted-foreground">{new Date(p.created_at).toLocaleTimeString()}</span>}
                          </div>
                          <p className="text-xs mt-1 whitespace-pre-wrap">{p.text_translated || p.text_original || '(empty post text)'}</p>
                        </div>
                      )) : <p className="text-xs text-muted-foreground italic">No posts found in this period.</p>}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">🤖 OpenAI Request</Label>
                    <div className="bg-muted/50 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap border max-h-56 overflow-y-auto">{JSON.stringify(digestTestResult.openai_request ?? {}, null, 2)}</div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">🧠 OpenAI System Prompt</Label>
                    <div className="bg-muted/50 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap border">{digestTestResult.openai_system_prompt || '(empty)'}</div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">📝 OpenAI User Prompt</Label>
                    <div className="bg-muted/50 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap border max-h-56 overflow-y-auto">{digestTestResult.openai_user_prompt || '(empty)'}</div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">✨ OpenAI Outcome</Label>
                    <div className="bg-muted/50 rounded-lg p-3 text-sm whitespace-pre-wrap border min-h-[80px]">{digestTestResult.openai_response || '(empty response text)'}</div>
                    {digestTestResult.openai_usage && (
                      <div className="text-xs text-muted-foreground font-mono">{JSON.stringify(digestTestResult.openai_usage)}</div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">🐦 Formatted Tweets ({digestTestResult.formatted_tweets?.length ?? 0})</Label>
                    {digestTestResult.formatted_tweets?.length > 0 ? (
                      <div className="space-y-2">
                        {digestTestResult.formatted_tweets.map((tweet: string, i: number) => (
                          <div key={i} className="p-3 bg-background rounded-lg border">
                            <div className="flex items-center justify-between mb-1">
                              <Badge variant="outline" className="text-xs">Tweet {i + 1}</Badge>
                              <span className="text-xs text-muted-foreground">{tweet.length}/280 chars</span>
                            </div>
                            <p className="text-sm whitespace-pre-wrap">{tweet}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground border">No tweet chunks generated yet.</div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
