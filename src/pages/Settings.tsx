import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Brain, MessageSquare, Eye, Code, Sparkles, Send, Key, Shield } from 'lucide-react';

// ===== Types =====
interface TranslationSettings {
  system_prompt: string;
  user_prompt_template: string;
  model: string;
  temperature: number;
  max_completion_tokens: number;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
}

interface OpenAISettings {
  model: string;
  temperature: number;
  max_completion_tokens: number;
}

interface TelegramSettings {
  parse_mode: string;
}

interface MessageTemplateSettings {
  template: string;
  include_source_link: boolean;
  include_hashtags: boolean;
  include_media_caption: boolean;
  source_link_text: string;
  custom_hashtags: string;
}

interface OpenAIModel {
  id: string;
  name: string;
  description: string;
  supports: string[];
  maxTokens: number;
  useMaxCompletionTokens: boolean;
  supportsTemperature: boolean;
}

// ===== Constants =====
const openaiModels: OpenAIModel[] = [
  { id: 'gpt-5-2025-08-07', name: 'GPT-5', description: 'Most capable model', supports: ['text', 'vision'], maxTokens: 200000, useMaxCompletionTokens: true, supportsTemperature: false },
  { id: 'gpt-5-mini-2025-08-07', name: 'GPT-5 Mini', description: 'Fast and efficient version of GPT-5', supports: ['text', 'vision'], maxTokens: 200000, useMaxCompletionTokens: true, supportsTemperature: false },
  { id: 'gpt-5-nano-2025-08-07', name: 'GPT-5 Nano', description: 'Fastest, cheapest version', supports: ['text'], maxTokens: 200000, useMaxCompletionTokens: true, supportsTemperature: false },
  { id: 'gpt-4.1-2025-04-14', name: 'GPT-4.1', description: 'Flagship GPT-4 model', supports: ['text', 'vision'], maxTokens: 128000, useMaxCompletionTokens: true, supportsTemperature: false },
  { id: 'gpt-4.1-mini-2025-04-14', name: 'GPT-4.1 Mini', description: 'Efficient GPT-4 model', supports: ['text', 'vision'], maxTokens: 128000, useMaxCompletionTokens: true, supportsTemperature: false },
  { id: 'o3-2025-04-16', name: 'O3', description: 'Powerful reasoning model', supports: ['text', 'code', 'vision'], maxTokens: 200000, useMaxCompletionTokens: true, supportsTemperature: false },
  { id: 'o4-mini-2025-04-16', name: 'O4 Mini', description: 'Fast reasoning model', supports: ['text', 'code', 'vision'], maxTokens: 200000, useMaxCompletionTokens: true, supportsTemperature: false },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Legacy)', description: 'Fast and cheap legacy model', supports: ['text', 'vision'], maxTokens: 16384, useMaxCompletionTokens: false, supportsTemperature: true },
  { id: 'gpt-4o', name: 'GPT-4o (Legacy)', description: 'Powerful legacy model', supports: ['text', 'vision'], maxTokens: 4096, useMaxCompletionTokens: false, supportsTemperature: true },
];

const messagePlaceholders = [
  { key: '{translated_text}', description: 'The translated tweet content' },
  { key: '{original_text}', description: 'Original tweet text' },
  { key: '{author_handle}', description: 'Twitter handle (@username)' },
  { key: '{author_name}', description: 'Display name of the author' },
  { key: '{source_link}', description: 'Link to original tweet' },
  { key: '{published_date}', description: 'Publication date' },
  { key: '{published_time}', description: 'Publication time' },
  { key: '{hashtags}', description: 'Custom hashtags' },
  { key: '{media_info}', description: 'Media information if present' },
];

const promptPlaceholders = [
  { key: '{content}', description: 'Original tweet text content' },
  { key: '{author_handle}', description: 'Twitter handle (@username)' },
  { key: '{author_name}', description: 'Display name of the author' },
  { key: '{tweet_url}', description: 'URL to the original tweet' },
  { key: '{published_date}', description: 'When the tweet was published' },
  { key: '{has_media}', description: 'Whether tweet contains media' },
  { key: '{media_count}', description: 'Number of media items' },
  { key: '{original_language}', description: 'Detected original language' },
];

// ===== Helper: save via admin-actions edge function =====
async function saveSettingsViaEdge(key: string, value: unknown): Promise<void> {
  const { error } = await supabase.functions.invoke('admin-actions', {
    body: { action: 'save_settings', key, value },
  });
  if (error) throw error;
}

// ===== Main Component =====
export default function Settings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [sampleTweets, setSampleTweets] = useState<Record<string, unknown>[]>([]);
  const [selectedSample, setSelectedSample] = useState(0);

  const [translationSettings, setTranslationSettings] = useState<TranslationSettings>({
    system_prompt: '',
    user_prompt_template: '',
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_completion_tokens: 1000,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });

  const [openaiSettings, setOpenaiSettings] = useState<OpenAISettings>({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_completion_tokens: 1000,
  });

  const [telegramSettings, setTelegramSettings] = useState<TelegramSettings>({
    parse_mode: 'Markdown',
  });

  const [messageTemplate, setMessageTemplate] = useState<MessageTemplateSettings>({
    template: '{translated_text}\n\n\u{1F4F0} #\u0627\u062E\u0628\u0627\u0631',
    include_source_link: true,
    include_hashtags: true,
    include_media_caption: true,
    source_link_text: 'View original',
    custom_hashtags: '#\u0627\u062E\u0628\u0627\u0631',
  });

  const loadSampleTweets = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('posts')
        .select('tweet_id, text_original, text_translated, url, tweeted_at, has_media, accounts!inner(handle, display_name)')
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      setSampleTweets(data || []);
    } catch (error) {
      console.error('Error loading sample tweets:', error);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('key, value');
      if (error) throw error;

      (data || []).forEach((setting: { key: string; value: unknown }) => {
        const val = setting.value;
        if (!val || typeof val !== 'object') return;
        switch (setting.key) {
          case 'translation_prompt':
            setTranslationSettings(val as TranslationSettings);
            break;
          case 'openai_config':
            setOpenaiSettings(val as OpenAISettings);
            break;
          case 'telegram_config':
            setTelegramSettings(val as TelegramSettings);
            break;
          case 'message_template':
            setMessageTemplate(val as MessageTemplateSettings);
            break;
        }
      });
    } catch (error) {
      console.error('Error loading settings:', error);
      toast({ title: 'Error loading settings', description: 'Could not load current settings', variant: 'destructive' });
    }
  }, [toast]);

  useEffect(() => {
    loadSettings();
    loadSampleTweets();
  }, [loadSettings, loadSampleTweets]);

  const handleSave = async (key: string, value: unknown) => {
    try {
      setLoading(true);
      await saveSettingsViaEdge(key, value);
      toast({ title: 'Settings saved successfully' });
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({ title: 'Error saving settings', description: 'Could not save settings', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const selectedModel = openaiModels.find(m => m.id === translationSettings.model);

  const insertPlaceholder = (placeholder: string, textareaId: string, getter: string, setter: (val: string) => void) => {
    const textarea = document.getElementById(textareaId) as HTMLTextAreaElement;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const before = getter.substring(0, start);
      const after = getter.substring(end);
      setter(before + placeholder + after);
      setTimeout(() => {
        textarea.setSelectionRange(start + placeholder.length, start + placeholder.length);
        textarea.focus();
      }, 0);
    }
  };

  const getPlaceholderValue = (key: string, tweet: Record<string, unknown>) => {
    const accounts = tweet?.accounts as Record<string, unknown> | undefined;
    switch (key) {
      case '{content}': {
        const text = tweet?.text_original as string;
        return text && text !== 'RSS Item' ? text : '[Tweet content]';
      }
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
      case '{source_link}': return messageTemplate.include_source_link ? `<a href="${(tweet?.url as string) || '#'}">${messageTemplate.source_link_text}</a>` : '';
      case '{published_date}': return tweet?.tweeted_at ? new Date(tweet.tweeted_at as string).toLocaleDateString('fa-IR') : '\u06F1\u06F4\u06F0\u06F4/\u06F6/\u06F1\u06F2';
      case '{published_time}': return tweet?.tweeted_at ? new Date(tweet.tweeted_at as string).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : '\u06F2\u06F1:\u06F3\u06F5';
      case '{hashtags}': return messageTemplate.custom_hashtags;
      case '{media_info}': return (tweet?.has_media as boolean) ? '\u{1F4F8} \u062A\u0635\u0648\u06CC\u0631' : '';
      default: return key;
    }
  };

  const renderMessagePreview = () => {
    const sampleTweet = sampleTweets[selectedSample];
    if (!sampleTweet) return '';
    return messagePlaceholders.reduce((tpl, p) => {
      return tpl.replace(new RegExp(p.key.replace(/[{}]/g, '\\$&'), 'g'), getMessagePlaceholderValue(p.key, sampleTweet));
    }, messageTemplate.template);
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-3xl font-display font-bold text-glass-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure your pipeline integrations and translation prompts</p>
      </div>

      <Tabs defaultValue="translation" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="translation" className="flex items-center gap-2">
            <Brain className="w-4 h-4" />
            Translation
          </TabsTrigger>
          <TabsTrigger value="messages" className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Messages
          </TabsTrigger>
          <TabsTrigger value="openai" className="flex items-center gap-2">
            <Key className="w-4 h-4" />
            OpenAI
          </TabsTrigger>
          <TabsTrigger value="telegram" className="flex items-center gap-2">
            <Send className="w-4 h-4" />
            Telegram
          </TabsTrigger>
        </TabsList>

        {/* ===== Translation Tab ===== */}
        <TabsContent value="translation" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground">
                <Sparkles className="w-5 h-5 mr-2" />
                AI Model Selection
              </CardTitle>
              <CardDescription>Choose the OpenAI model and configure its parameters</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="model_select">Model</Label>
                <Select value={translationSettings.model} onValueChange={(v) => setTranslationSettings(prev => ({ ...prev, model: v }))}>
                  <SelectTrigger className="glass-input"><SelectValue placeholder="Select a model" /></SelectTrigger>
                  <SelectContent>
                    {openaiModels.map(model => (
                      <SelectItem key={model.id} value={model.id}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{model.name}</span>
                          <div className="flex gap-1">
                            {model.supports.map(s => <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>)}
                          </div>
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
                  <Input type="number" min="1" max={selectedModel?.maxTokens || 4096} value={translationSettings.max_completion_tokens} onChange={(e) => setTranslationSettings(prev => ({ ...prev, max_completion_tokens: parseInt(e.target.value) || 1000 }))} className="glass-input" />
                </div>
                {selectedModel?.supportsTemperature && (
                  <div className="space-y-2">
                    <Label>Temperature</Label>
                    <Input type="number" step="0.1" min="0" max="2" value={translationSettings.temperature} onChange={(e) => setTranslationSettings(prev => ({ ...prev, temperature: parseFloat(e.target.value) || 0 }))} className="glass-input" />
                  </div>
                )}
              </div>

              {selectedModel?.supportsTemperature && (
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Top P</Label>
                    <Input type="number" step="0.1" min="0" max="1" value={translationSettings.top_p} onChange={(e) => setTranslationSettings(prev => ({ ...prev, top_p: parseFloat(e.target.value) || 1 }))} className="glass-input" />
                  </div>
                  <div className="space-y-2">
                    <Label>Frequency Penalty</Label>
                    <Input type="number" step="0.1" min="-2" max="2" value={translationSettings.frequency_penalty} onChange={(e) => setTranslationSettings(prev => ({ ...prev, frequency_penalty: parseFloat(e.target.value) || 0 }))} className="glass-input" />
                  </div>
                  <div className="space-y-2">
                    <Label>Presence Penalty</Label>
                    <Input type="number" step="0.1" min="-2" max="2" value={translationSettings.presence_penalty} onChange={(e) => setTranslationSettings(prev => ({ ...prev, presence_penalty: parseFloat(e.target.value) || 0 }))} className="glass-input" />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground">
                <MessageSquare className="w-5 h-5 mr-2" />
                Translation Prompt Configuration
              </CardTitle>
              <CardDescription>Configure the AI translation prompts with dynamic placeholders</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="system_prompt">System Prompt</Label>
                <Textarea id="system_prompt" value={translationSettings.system_prompt} onChange={(e) => setTranslationSettings(prev => ({ ...prev, system_prompt: e.target.value }))} className="glass-input min-h-[200px] font-mono text-sm" placeholder="Enter the system prompt for translation..." />
              </div>

              <Separator />

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="user_prompt_template">User Prompt Template</Label>
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4" />
                    <span className="text-sm text-muted-foreground">Available Placeholders</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {promptPlaceholders.map(p => (
                    <Button key={p.key} variant="outline" size="sm" onClick={() => insertPlaceholder(p.key, 'user_prompt_template', translationSettings.user_prompt_template, (v) => setTranslationSettings(prev => ({ ...prev, user_prompt_template: v })))} className="justify-start h-auto p-3">
                      <div className="text-left">
                        <div className="font-mono text-xs text-primary">{p.key}</div>
                        <div className="text-xs text-muted-foreground">{p.description}</div>
                      </div>
                    </Button>
                  ))}
                </div>

                <Textarea id="user_prompt_template" value={translationSettings.user_prompt_template} onChange={(e) => setTranslationSettings(prev => ({ ...prev, user_prompt_template: e.target.value }))} className="glass-input min-h-[120px] font-mono text-sm" placeholder="Enter the user prompt template..." />
              </div>

              <Separator />

              {sampleTweets.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <Code className="w-4 h-4" />
                      Prompt Preview with Real Data
                    </Label>
                    <Select value={selectedSample.toString()} onValueChange={(v) => setSelectedSample(parseInt(v))}>
                      <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {sampleTweets.map((_, i) => <SelectItem key={i} value={i.toString()}>Sample Tweet {i + 1}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <div className="text-sm font-medium mb-2">Preview of User Prompt:</div>
                    <div className="text-sm font-mono bg-background p-3 rounded border whitespace-pre-wrap">
                      {promptPlaceholders.reduce((tpl, p) => tpl.replace(new RegExp(p.key.replace(/[{}]/g, '\\$&'), 'g'), getPlaceholderValue(p.key, sampleTweets[selectedSample])), translationSettings.user_prompt_template)}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <Button onClick={() => handleSave('translation_prompt', translationSettings)} disabled={loading} className="bg-gradient-primary hover:opacity-90 text-white flex-1">
                  Save Translation Settings
                </Button>
                <Button onClick={async () => {
                  try {
                    const { error } = await supabase.functions.invoke('admin-retry', { body: { action: 'test_webhook' } });
                    if (error) throw error;
                    toast({ title: 'Test webhook sent!', description: 'Check the Posts page for new sample content' });
                    setTimeout(() => loadSampleTweets(), 2000);
                  } catch { toast({ title: 'Test failed', variant: 'destructive' }); }
                }} variant="outline" disabled={loading} className="border-primary/50 hover:bg-primary/10">
                  Test Pipeline
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Messages Tab ===== */}
        <TabsContent value="messages" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground">
                <MessageSquare className="w-5 h-5 mr-2" />
                Telegram Message Template
              </CardTitle>
              <CardDescription>Configure how your translated messages appear in Telegram</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="message_template">Message Template</Label>
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4" />
                    <span className="text-sm text-muted-foreground">Available Placeholders</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {messagePlaceholders.map(p => (
                    <Button key={p.key} variant="outline" size="sm" onClick={() => insertPlaceholder(p.key, 'message_template', messageTemplate.template, (v) => setMessageTemplate(prev => ({ ...prev, template: v })))} className="justify-start h-auto p-3">
                      <div className="text-left">
                        <div className="font-mono text-xs text-primary">{p.key}</div>
                        <div className="text-xs text-muted-foreground">{p.description}</div>
                      </div>
                    </Button>
                  ))}
                </div>

                <Textarea id="message_template" value={messageTemplate.template} onChange={(e) => setMessageTemplate(prev => ({ ...prev, template: e.target.value }))} className="glass-input min-h-[150px] font-mono text-sm" placeholder="Enter your message template..." />
              </div>

              <Separator />

              <div className="space-y-4">
                <Label className="text-base font-medium">Message Options</Label>
                <div className="grid grid-cols-2 gap-4">
                  <Label className="flex items-center gap-2">
                    <input type="checkbox" checked={messageTemplate.include_source_link} onChange={(e) => setMessageTemplate(prev => ({ ...prev, include_source_link: e.target.checked }))} className="rounded" />
                    Include Source Link
                  </Label>
                  <Label className="flex items-center gap-2">
                    <input type="checkbox" checked={messageTemplate.include_media_caption} onChange={(e) => setMessageTemplate(prev => ({ ...prev, include_media_caption: e.target.checked }))} className="rounded" />
                    Include Media Caption
                  </Label>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Source Link Text</Label>
                    <Input value={messageTemplate.source_link_text} onChange={(e) => setMessageTemplate(prev => ({ ...prev, source_link_text: e.target.value }))} className="glass-input" />
                  </div>
                  <div className="space-y-2">
                    <Label>Custom Hashtags</Label>
                    <Input value={messageTemplate.custom_hashtags} onChange={(e) => setMessageTemplate(prev => ({ ...prev, custom_hashtags: e.target.value }))} className="glass-input" />
                  </div>
                </div>
              </div>

              <Separator />

              {sampleTweets.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <Eye className="w-4 h-4" />
                      Telegram Message Preview
                    </Label>
                    <Select value={selectedSample.toString()} onValueChange={(v) => setSelectedSample(parseInt(v))}>
                      <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {sampleTweets.map((_, i) => <SelectItem key={i} value={i.toString()}>Sample Tweet {i + 1}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg border-2 border-dashed border-muted-foreground/20">
                    <div className="text-sm font-medium mb-2 flex items-center gap-2">
                      <Send className="w-4 h-4" />
                      How it will appear in Telegram:
                    </div>
                    <div className="text-sm bg-background p-4 rounded border whitespace-pre-wrap font-sans">
                      {renderMessagePreview()}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <Button onClick={() => handleSave('message_template', messageTemplate)} disabled={loading} className="bg-gradient-primary hover:opacity-90 text-white flex-1">
                  Save Message Template
                </Button>
                <Button onClick={async () => {
                  try {
                    const { error } = await supabase.functions.invoke('admin-retry', {
                      body: { action: 'test_template', post: sampleTweets[selectedSample], template: messageTemplate.template, settings: { include_source_links: messageTemplate.include_source_link, custom_hashtags: messageTemplate.custom_hashtags } },
                    });
                    if (error) throw error;
                    toast({ title: 'Test message sent!', description: 'Check your Telegram channel' });
                  } catch { toast({ title: 'Test failed', variant: 'destructive' }); }
                }} variant="outline" disabled={loading || sampleTweets.length === 0} className="border-primary/50 hover:bg-primary/10">
                  Test Message
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== OpenAI Tab ===== */}
        <TabsContent value="openai" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground">
                <Key className="w-5 h-5 mr-2" />
                OpenAI Configuration
              </CardTitle>
              <CardDescription>Configure the OpenAI integration parameters</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-muted/50 rounded-lg border border-dashed border-muted-foreground/30 flex items-start gap-3">
                <Shield className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-glass-foreground">API Key managed securely</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your OpenAI API key is stored as a Supabase secret and is never exposed to the browser.
                    To update it, go to your Supabase project &rarr; Edge Function Secrets &rarr; OPENAI_API_KEY.
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Model</Label>
                <Select value={openaiSettings.model} onValueChange={(v) => setOpenaiSettings(prev => ({ ...prev, model: v }))}>
                  <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {openaiModels.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Temperature</Label>
                  <Input type="number" step="0.1" min="0" max="2" value={openaiSettings.temperature} onChange={(e) => setOpenaiSettings(prev => ({ ...prev, temperature: parseFloat(e.target.value) || 0 }))} className="glass-input" />
                </div>
                <div className="space-y-2">
                  <Label>Max Completion Tokens</Label>
                  <Input type="number" min="1" value={openaiSettings.max_completion_tokens} onChange={(e) => setOpenaiSettings(prev => ({ ...prev, max_completion_tokens: parseInt(e.target.value) || 1000 }))} className="glass-input" />
                </div>
              </div>
              <Button onClick={() => handleSave('openai_config', openaiSettings)} disabled={loading} className="bg-gradient-primary hover:opacity-90 text-white w-full">
                Save OpenAI Config
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Telegram Tab ===== */}
        <TabsContent value="telegram" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground">
                <Send className="w-5 h-5 mr-2" />
                Telegram Configuration
              </CardTitle>
              <CardDescription>Configure Telegram delivery settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-muted/50 rounded-lg border border-dashed border-muted-foreground/30 flex items-start gap-3">
                <Shield className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-glass-foreground">Bot Token &amp; Chat ID managed securely</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Your Telegram credentials are stored as Supabase secrets (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID).
                    To update them, go to your Supabase project &rarr; Edge Function Secrets.
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Parse Mode</Label>
                <Select value={telegramSettings.parse_mode} onValueChange={(v) => setTelegramSettings(prev => ({ ...prev, parse_mode: v }))}>
                  <SelectTrigger className="glass-input"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Markdown">Markdown</SelectItem>
                    <SelectItem value="MarkdownV2">MarkdownV2</SelectItem>
                    <SelectItem value="HTML">HTML</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => handleSave('telegram_config', telegramSettings)} disabled={loading} className="bg-gradient-primary hover:opacity-90 text-white w-full">
                Save Telegram Config
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
