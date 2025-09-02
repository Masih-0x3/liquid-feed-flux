import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Settings as SettingsIcon, Key, Send, Globe, Shield, Brain, MessageSquare } from 'lucide-react';

export default function Settings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [translationSettings, setTranslationSettings] = useState({
    system_prompt: '',
    user_prompt_template: '',
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_completion_tokens: 1000
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

  useEffect(() => {
    loadSettings();
  }, []);

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
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center text-glass-foreground">
                <MessageSquare className="w-5 h-5 mr-2" />
                Translation Prompt Configuration
              </CardTitle>
              <CardDescription>Configure the AI translation prompts and parameters</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="system_prompt">System Prompt</Label>
                <Textarea
                  id="system_prompt"
                  value={translationSettings.system_prompt}
                  onChange={(e) => setTranslationSettings(prev => ({ ...prev, system_prompt: e.target.value }))}
                  className="glass-input min-h-[200px]"
                  placeholder="Enter the system prompt for translation..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="user_prompt_template">User Prompt Template</Label>
                <Textarea
                  id="user_prompt_template"
                  value={translationSettings.user_prompt_template}
                  onChange={(e) => setTranslationSettings(prev => ({ ...prev, user_prompt_template: e.target.value }))}
                  className="glass-input min-h-[100px]"
                  placeholder="Enter the user prompt template (use {content} as placeholder)..."
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="trans_model">Model</Label>
                  <Input
                    id="trans_model"
                    value={translationSettings.model}
                    onChange={(e) => setTranslationSettings(prev => ({ ...prev, model: e.target.value }))}
                    className="glass-input"
                    placeholder="gpt-4o-mini"
                  />
                </div>
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
                <div className="space-y-2">
                  <Label htmlFor="max_tokens">Max Tokens</Label>
                  <Input
                    id="max_tokens"
                    type="number"
                    value={translationSettings.max_completion_tokens}
                    onChange={(e) => setTranslationSettings(prev => ({ ...prev, max_completion_tokens: parseInt(e.target.value) }))}
                    className="glass-input"
                  />
                </div>
              </div>
              <Button 
                onClick={handleSaveTranslation} 
                disabled={loading}
                className="bg-gradient-primary hover:opacity-90 text-white"
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