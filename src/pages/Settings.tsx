import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Settings as SettingsIcon, Key, Send, Globe, Shield } from 'lucide-react';

export default function Settings() {
  const { toast } = useToast();
  const [settings, setSettings] = useState({
    openai_api_key: '',
    openai_model: 'gpt-4o-mini',
    telegram_bot_token: '',
    telegram_chat_id: '',
    target_language: 'en',
    webhook_secret: '',
    rate_limit: '100',
  });

  const handleSave = () => {
    toast({ title: "Settings saved successfully" });
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-3xl font-display font-bold text-glass-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure your pipeline integrations</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center text-glass-foreground">
              <Key className="w-5 h-5 mr-2" />
              OpenAI Configuration
            </CardTitle>
            <CardDescription>Configure AI translation settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="openai_key">API Key</Label>
              <Input
                id="openai_key"
                type="password"
                value={settings.openai_api_key}
                onChange={(e) => setSettings(prev => ({ ...prev, openai_api_key: e.target.value }))}
                className="glass-input"
                placeholder="sk-..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Input
                id="model"
                value={settings.openai_model}
                onChange={(e) => setSettings(prev => ({ ...prev, openai_model: e.target.value }))}
                className="glass-input"
              />
            </div>
          </CardContent>
        </Card>

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
                value={settings.telegram_bot_token}
                onChange={(e) => setSettings(prev => ({ ...prev, telegram_bot_token: e.target.value }))}
                className="glass-input"
                placeholder="123456:ABC-DEF..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="chat_id">Channel ID</Label>
              <Input
                id="chat_id"
                value={settings.telegram_chat_id}
                onChange={(e) => setSettings(prev => ({ ...prev, telegram_chat_id: e.target.value }))}
                className="glass-input"
                placeholder="@channel_name"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Button onClick={handleSave} className="bg-gradient-primary hover:opacity-90 text-white">
        Save Configuration
      </Button>
    </div>
  );
}