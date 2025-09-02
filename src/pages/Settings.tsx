import { useState, useEffect } from 'react';
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
import { Settings as SettingsIcon, Key, Send, Globe, Shield, Brain, MessageSquare, Eye, Code, Sparkles } from 'lucide-react';

export default function Settings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [sampleTweets, setSampleTweets] = useState([]);
  const [selectedSample, setSelectedSample] = useState(0);
  const [translationSettings, setTranslationSettings] = useState({
    system_prompt: '',
    user_prompt_template: '',
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_completion_tokens: 1000,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0
  });
  const [openaiSettings, setOpenaiSettings] = useState({
    api_key: '',
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_completion_tokens: 1000
  });
  const [telegramSettings, setTelegramSettings] = useState({
    bot_token: '',
    chat_id: '',
    parse_mode: 'Markdown'
  });

  // Available OpenAI models with their specifications
  const openaiModels = [
    {
      id: 'gpt-5-2025-08-07',
      name: 'GPT-5',
      description: 'Most capable model',
      supports: ['text', 'vision'],
      maxTokens: 200000,
      useMaxCompletionTokens: true,
      supportsTemperature: false
    },
    {
      id: 'gpt-5-mini-2025-08-07',
      name: 'GPT-5 Mini',
      description: 'Fast and efficient version of GPT-5',
      supports: ['text', 'vision'],
      maxTokens: 200000,
      useMaxCompletionTokens: true,
      supportsTemperature: false
    },
    {
      id: 'gpt-5-nano-2025-08-07',
      name: 'GPT-5 Nano',
      description: 'Fastest, cheapest version',
      supports: ['text'],
      maxTokens: 200000,
      useMaxCompletionTokens: true,
      supportsTemperature: false
    },
    {
      id: 'gpt-4.1-2025-04-14',
      name: 'GPT-4.1',
      description: 'Flagship GPT-4 model',
      supports: ['text', 'vision'],
      maxTokens: 128000,
      useMaxCompletionTokens: true,
      supportsTemperature: false
    },
    {
      id: 'gpt-4.1-mini-2025-04-14',
      name: 'GPT-4.1 Mini',
      description: 'Efficient GPT-4 model',
      supports: ['text', 'vision'],
      maxTokens: 128000,
      useMaxCompletionTokens: true,
      supportsTemperature: false
    },
    {
      id: 'o3-2025-04-16',
      name: 'O3',
      description: 'Powerful reasoning model',
      supports: ['text', 'code', 'vision'],
      maxTokens: 200000,
      useMaxCompletionTokens: true,
      supportsTemperature: false
    },
    {
      id: 'o4-mini-2025-04-16',
      name: 'O4 Mini',
      description: 'Fast reasoning model',
      supports: ['text', 'code', 'vision'],
      maxTokens: 200000,
      useMaxCompletionTokens: true,
      supportsTemperature: false
    },
    {
      id: 'gpt-4o-mini',
      name: 'GPT-4o Mini (Legacy)',
      description: 'Fast and cheap legacy model',
      supports: ['text', 'vision'],
      maxTokens: 16384,
      useMaxCompletionTokens: false,
      supportsTemperature: true
    },
    {
      id: 'gpt-4o',
      name: 'GPT-4o (Legacy)',
      description: 'Powerful legacy model',
      supports: ['text', 'vision'],
      maxTokens: 4096,
      useMaxCompletionTokens: false,
      supportsTemperature: true
    }
  ];

  // Placeholder definitions with real data mapping
  const placeholders = [
    { key: '{content}', description: 'Original tweet text content', example: 'tweet.text_original' },
    { key: '{author_handle}', description: 'Twitter handle (@username)', example: 'account.handle' },
    { key: '{author_name}', description: 'Display name of the author', example: 'account.display_name' },
    { key: '{tweet_url}', description: 'URL to the original tweet', example: 'tweet.url' },
    { key: '{published_date}', description: 'When the tweet was published', example: 'tweet.tweeted_at' },
    { key: '{has_media}', description: 'Whether tweet contains media', example: 'tweet.has_media' },
    { key: '{media_count}', description: 'Number of media items', example: 'media.length' },
    { key: '{original_language}', description: 'Detected original language', example: 'tweet.lang_original' }
  ];

  useEffect(() => {
    loadSettings();
    loadSampleTweets();
  }, []);

  const loadSampleTweets = async () => {
    try {
      const { data, error } = await supabase
        .from('posts')
        .select(`
          *,
          accounts!inner(handle, display_name)
        `)
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      setSampleTweets(data || []);
    } catch (error) {
      console.error('Error loading sample tweets:', error);
    }
  };

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('*');

      if (error) throw error;

      data.forEach(setting => {
        switch (setting.key) {
          case 'translation_prompt':
            if (setting.value && typeof setting.value === 'object') {
              setTranslationSettings(setting.value as any);
            }
            break;
          case 'openai_config':
            if (setting.value && typeof setting.value === 'object') {
              setOpenaiSettings(setting.value as any);
            }
            break;
          case 'telegram_config':
            if (setting.value && typeof setting.value === 'object') {
              setTelegramSettings(setting.value as any);
            }
            break;
        }
      });
    } catch (error) {
      console.error('Error loading settings:', error);
      toast({ 
        title: "Error loading settings", 
        description: "Could not load current settings from database",
        variant: "destructive" 
      });
    }
  };

  const saveSettings = async (key: string, value: any) => {
    try {
      setLoading(true);
      const { error } = await supabase
        .from('settings')
        .upsert({ key, value }, { onConflict: 'key' });

      if (error) throw error;

      toast({ title: "Settings saved successfully" });
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({ 
        title: "Error saving settings", 
        description: "Could not save settings to database",
        variant: "destructive" 
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveTranslation = () => {
    saveSettings('translation_prompt', translationSettings);
  };

  const handleSaveOpenAI = () => {
    saveSettings('openai_config', openaiSettings);
  };

  const handleSaveTelegram = () => {
    saveSettings('telegram_config', telegramSettings);
  };

  const selectedModel = openaiModels.find(m => m.id === translationSettings.model);

  const insertPlaceholder = (placeholder: string) => {
    const textarea = document.getElementById('user_prompt_template') as HTMLTextAreaElement;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = translationSettings.user_prompt_template;
      const before = text.substring(0, start);
      const after = text.substring(end);
      const newText = before + placeholder + after;
      setTranslationSettings(prev => ({ ...prev, user_prompt_template: newText }));
      
      // Set cursor position after inserted placeholder
      setTimeout(() => {
        textarea.setSelectionRange(start + placeholder.length, start + placeholder.length);
        textarea.focus();
      }, 0);
    }
  };

  const getPlaceholderValue = (placeholder: any, tweet: any) => {
    switch (placeholder.key) {
      case '{content}': return tweet?.text_original || 'Sample tweet content...';
      case '{author_handle}': return tweet?.accounts?.handle || '@sample_handle';
      case '{author_name}': return tweet?.accounts?.display_name || 'Sample Author';
      case '{tweet_url}': return tweet?.url || 'https://twitter.com/sample/status/123';
      case '{published_date}': return tweet?.tweeted_at || new Date().toISOString();
      case '{has_media}': return tweet?.has_media?.toString() || 'false';
      case '{media_count}': return '0';
      case '{original_language}': return tweet?.lang_original || 'en';
      default: return placeholder.key;
    }
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-3xl font-display font-bold text-glass-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure your pipeline integrations and translation prompts</p>
      </div>

      <Tabs defaultValue="translation" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="translation" className="flex items-center gap-2">
            <Brain className="w-4 h-4" />
            Translation
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

        <TabsContent value="translation" className="space-y-6">
          {/* Model Selection Card */}
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
                <Select 
                  value={translationSettings.model} 
                  onValueChange={(value) => setTranslationSettings(prev => ({ ...prev, model: value }))}
                >
                  <SelectTrigger className="glass-input">
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {openaiModels.map(model => (
                      <SelectItem key={model.id} value={model.id}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{model.name}</span>
                          <div className="flex gap-1">
                            {model.supports.map(support => (
                              <Badge key={support} variant="secondary" className="text-xs">
                                {support}
                              </Badge>
                            ))}
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
                      <span>Temperature: {selectedModel.supportsTemperature ? 'Yes' : 'No'}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Model Parameters */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="max_completion_tokens">
                    {selectedModel?.useMaxCompletionTokens ? 'Max Completion Tokens' : 'Max Tokens'}
                  </Label>
                  <Input
                    id="max_completion_tokens"
                    type="number"
                    min="1"
                    max={selectedModel?.maxTokens || 4096}
                    value={translationSettings.max_completion_tokens}
                    onChange={(e) => setTranslationSettings(prev => ({ ...prev, max_completion_tokens: parseInt(e.target.value) }))}
                    className="glass-input"
                  />
                </div>
                
                {selectedModel?.supportsTemperature && (
                  <div className="space-y-2">
                    <Label htmlFor="temperature">Temperature</Label>
                    <Input
                      id="temperature"
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={translationSettings.temperature}
                      onChange={(e) => setTranslationSettings(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                      className="glass-input"
                    />
                  </div>
                )}
              </div>

              {selectedModel?.supportsTemperature && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="top_p">Top P</Label>
                    <Input
                      id="top_p"
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      value={translationSettings.top_p}
                      onChange={(e) => setTranslationSettings(prev => ({ ...prev, top_p: parseFloat(e.target.value) }))}
                      className="glass-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="frequency_penalty">Frequency Penalty</Label>
                    <Input
                      id="frequency_penalty"
                      type="number"
                      step="0.1"
                      min="-2"
                      max="2"
                      value={translationSettings.frequency_penalty}
                      onChange={(e) => setTranslationSettings(prev => ({ ...prev, frequency_penalty: parseFloat(e.target.value) }))}
                      className="glass-input"
                    />
                  </div>
                </div>
              )}

              {selectedModel?.supportsTemperature && (
                <div className="space-y-2">
                  <Label htmlFor="presence_penalty">Presence Penalty</Label>
                  <Input
                    id="presence_penalty"
                    type="number"
                    step="0.1"
                    min="-2"
                    max="2"
                    value={translationSettings.presence_penalty}
                    onChange={(e) => setTranslationSettings(prev => ({ ...prev, presence_penalty: parseFloat(e.target.value) }))}
                    className="glass-input"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Prompt Configuration Card */}
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
                <Textarea
                  id="system_prompt"
                  value={translationSettings.system_prompt}
                  onChange={(e) => setTranslationSettings(prev => ({ ...prev, system_prompt: e.target.value }))}
                  className="glass-input min-h-[200px] font-mono text-sm"
                  placeholder="Enter the system prompt for translation..."
                />
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
                
                {/* Placeholders Reference */}
                <div className="grid grid-cols-2 gap-2">
                  {placeholders.map(placeholder => (
                    <Button
                      key={placeholder.key}
                      variant="outline"
                      size="sm"
                      onClick={() => insertPlaceholder(placeholder.key)}
                      className="justify-start h-auto p-3"
                    >
                      <div className="text-left">
                        <div className="font-mono text-xs text-primary">{placeholder.key}</div>
                        <div className="text-xs text-muted-foreground">{placeholder.description}</div>
                      </div>
                    </Button>
                  ))}
                </div>

                <Textarea
                  id="user_prompt_template"
                  value={translationSettings.user_prompt_template}
                  onChange={(e) => setTranslationSettings(prev => ({ ...prev, user_prompt_template: e.target.value }))}
                  className="glass-input min-h-[120px] font-mono text-sm"
                  placeholder="Enter the user prompt template. Click placeholders above to insert them..."
                />
              </div>

              <Separator />

              {/* Sample Data Preview */}
              {sampleTweets.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <Code className="w-4 h-4" />
                      Prompt Preview with Real Data
                    </Label>
                    <Select
                      value={selectedSample.toString()}
                      onValueChange={(value) => setSelectedSample(parseInt(value))}
                    >
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {sampleTweets.map((tweet: any, index) => (
                          <SelectItem key={index} value={index.toString()}>
                            Sample Tweet {index + 1}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <div className="text-sm font-medium mb-2">Preview of User Prompt:</div>
                    <div className="text-sm font-mono bg-background p-3 rounded border whitespace-pre-wrap">
                      {placeholders.reduce((template, placeholder) => {
                        return template.replace(
                          new RegExp(placeholder.key.replace(/[{}]/g, '\\$&'), 'g'),
                          getPlaceholderValue(placeholder, sampleTweets[selectedSample])
                        );
                      }, translationSettings.user_prompt_template)}
                    </div>
                  </div>
                </div>
              )}

              <Button 
                onClick={handleSaveTranslation} 
                disabled={loading}
                className="bg-gradient-primary hover:opacity-90 text-white w-full"
              >
                Save Translation Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="openai" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground">
                <Key className="w-5 h-5 mr-2" />
                OpenAI Configuration
              </CardTitle>
              <CardDescription>Configure OpenAI API settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="openai_key">API Key</Label>
                <Input
                  id="openai_key"
                  type="password"
                  value={openaiSettings.api_key}
                  onChange={(e) => setOpenaiSettings(prev => ({ ...prev, api_key: e.target.value }))}
                  className="glass-input"
                  placeholder="sk-..."
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="openai_model">Model</Label>
                  <Input
                    id="openai_model"
                    value={openaiSettings.model}
                    onChange={(e) => setOpenaiSettings(prev => ({ ...prev, model: e.target.value }))}
                    className="glass-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="openai_temperature">Temperature</Label>
                  <Input
                    id="openai_temperature"
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={openaiSettings.temperature}
                    onChange={(e) => setOpenaiSettings(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                    className="glass-input"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="openai_max_tokens">Max Tokens</Label>
                  <Input
                    id="openai_max_tokens"
                    type="number"
                    value={openaiSettings.max_completion_tokens}
                    onChange={(e) => setOpenaiSettings(prev => ({ ...prev, max_completion_tokens: parseInt(e.target.value) }))}
                    className="glass-input"
                  />
                </div>
              </div>
              <Button 
                onClick={handleSaveOpenAI} 
                disabled={loading}
                className="bg-gradient-primary hover:opacity-90 text-white"
              >
                Save OpenAI Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

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
              <div className="space-y-2">
                <Label htmlFor="bot_token">Bot Token</Label>
                <Input
                  id="bot_token"
                  type="password"
                  value={telegramSettings.bot_token}
                  onChange={(e) => setTelegramSettings(prev => ({ ...prev, bot_token: e.target.value }))}
                  className="glass-input"
                  placeholder="123456:ABC-DEF..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="chat_id">Channel ID</Label>
                <Input
                  id="chat_id"
                  value={telegramSettings.chat_id}
                  onChange={(e) => setTelegramSettings(prev => ({ ...prev, chat_id: e.target.value }))}
                  className="glass-input"
                  placeholder="@channel_name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="parse_mode">Parse Mode</Label>
                <Input
                  id="parse_mode"
                  value={telegramSettings.parse_mode}
                  onChange={(e) => setTelegramSettings(prev => ({ ...prev, parse_mode: e.target.value }))}
                  className="glass-input"
                  placeholder="Markdown"
                />
              </div>
              <Button 
                onClick={handleSaveTelegram} 
                disabled={loading}
                className="bg-gradient-primary hover:opacity-90 text-white"
              >
                Save Telegram Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}