import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Plus, Users, Edit, Trash2, Loader2, Globe } from 'lucide-react';

interface Account {
  id: string;
  handle: string;
  display_name: string | null;
  lang_src: string;
  lang_dst: string;
  enabled: boolean;
  last_seen_item_id: string | null;
  created_at: string;
}

const languages = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese' },
];

export default function Accounts() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [formData, setFormData] = useState({
    handle: '',
    display_name: '',
    lang_src: 'en',
    lang_dst: 'en',
    enabled: true,
  });

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    try {
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAccounts(data || []);
    } catch (error) {
      console.error('Error fetching accounts:', error);
      toast({
        title: "Error loading accounts",
        description: "Failed to fetch accounts. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (editingAccount) {
        const { error } = await supabase
          .from('accounts')
          .update(formData)
          .eq('id', editingAccount.id);

        if (error) throw error;
        toast({ title: "Account updated successfully" });
      } else {
        const { error } = await supabase
          .from('accounts')
          .insert([formData]);

        if (error) throw error;
        toast({ title: "Account created successfully" });
      }

      setIsDialogOpen(false);
      setEditingAccount(null);
      setFormData({ handle: '', display_name: '', lang_src: 'en', lang_dst: 'en', enabled: true });
      fetchAccounts();
    } catch (error) {
      console.error('Error saving account:', error);
      toast({
        title: "Error saving account",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (account: Account) => {
    setEditingAccount(account);
    setFormData({
      handle: account.handle,
      display_name: account.display_name || '',
      lang_src: account.lang_src,
      lang_dst: account.lang_dst,
      enabled: account.enabled,
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (accountId: string) => {
    if (!confirm('Are you sure you want to delete this account? This will also delete all associated posts.')) return;

    try {
      const { error } = await supabase
        .from('accounts')
        .delete()
        .eq('id', accountId);

      if (error) throw error;
      toast({ title: "Account deleted successfully" });
      fetchAccounts();
    } catch (error) {
      console.error('Error deleting account:', error);
      toast({
        title: "Error deleting account",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleToggleEnabled = async (accountId: string, enabled: boolean) => {
    try {
      const { error } = await supabase
        .from('accounts')
        .update({ enabled })
        .eq('id', accountId);

      if (error) throw error;
      toast({ title: `Account ${enabled ? 'enabled' : 'disabled'} successfully` });
      fetchAccounts();
    } catch (error) {
      console.error('Error updating account:', error);
      toast({
        title: "Error updating account",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const getLanguageName = (code: string) => {
    return languages.find(lang => lang.code === code)?.name || code;
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-glass-foreground">Accounts</h1>
          <p className="text-muted-foreground mt-1">Manage social media accounts for content ingestion</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-primary hover:opacity-90 text-white">
              <Plus className="w-4 h-4 mr-2" />
              Add Account
            </Button>
          </DialogTrigger>
          <DialogContent className="glass-panel border-glass-border">
            <DialogHeader>
              <DialogTitle className="text-glass-foreground">
                {editingAccount ? 'Edit Account' : 'Add New Account'}
              </DialogTitle>
              <DialogDescription>
                Configure social media account settings for content monitoring
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="handle">Handle</Label>
                <Input
                  id="handle"
                  value={formData.handle}
                  onChange={(e) => setFormData(prev => ({ ...prev, handle: e.target.value }))}
                  className="glass-input"
                  placeholder="@username"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="display_name">Display Name</Label>
                <Input
                  id="display_name"
                  value={formData.display_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, display_name: e.target.value }))}
                  className="glass-input"
                  placeholder="Full Name"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="lang_src">Source Language</Label>
                  <Select
                    value={formData.lang_src}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, lang_src: value }))}
                  >
                    <SelectTrigger className="glass-input">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="glass-panel border-glass-border">
                      {languages.map((lang) => (
                        <SelectItem key={lang.code} value={lang.code}>
                          {lang.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lang_dst">Target Language</Label>
                  <Select
                    value={formData.lang_dst}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, lang_dst: value }))}
                  >
                    <SelectTrigger className="glass-input">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="glass-panel border-glass-border">
                      {languages.map((lang) => (
                        <SelectItem key={lang.code} value={lang.code}>
                          {lang.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="enabled"
                  checked={formData.enabled}
                  onCheckedChange={(enabled) => setFormData(prev => ({ ...prev, enabled }))}
                />
                <Label htmlFor="enabled" className="text-glass-foreground">
                  Enable account monitoring
                </Label>
              </div>
              <div className="flex space-x-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsDialogOpen(false);
                    setEditingAccount(null);
                    setFormData({ handle: '', display_name: '', lang_src: 'en', lang_dst: 'en', enabled: true });
                  }}
                  className="glass-button"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={loading}
                  className="bg-gradient-primary hover:opacity-90 text-white flex-1"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : null}
                  {editingAccount ? 'Update Account' : 'Create Account'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Accounts Table */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-xl font-display text-glass-foreground flex items-center">
            <Users className="w-5 h-5 mr-2" />
            Monitored Accounts
          </CardTitle>
          <CardDescription>
            Social media accounts being tracked for content
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : accounts.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="border-glass-border hover:bg-glass-border/20">
                  <TableHead className="text-glass-foreground">Handle</TableHead>
                  <TableHead className="text-glass-foreground">Display Name</TableHead>
                  <TableHead className="text-glass-foreground">Languages</TableHead>
                  <TableHead className="text-glass-foreground">Status</TableHead>
                  <TableHead className="text-glass-foreground">Last Seen</TableHead>
                  <TableHead className="text-glass-foreground">Created</TableHead>
                  <TableHead className="text-glass-foreground">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => (
                  <TableRow key={account.id} className="border-glass-border hover:bg-glass-border/20">
                    <TableCell className="font-medium text-glass-foreground">
                      {account.handle}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {account.display_name || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <div className="flex items-center space-x-2">
                        <Badge variant="outline" className="text-xs">
                          {getLanguageName(account.lang_src)}
                        </Badge>
                        <span className="text-muted-foreground">→</span>
                        <Badge variant="outline" className="text-xs">
                          {getLanguageName(account.lang_dst)}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Switch
                          checked={account.enabled}
                          onCheckedChange={(enabled) => handleToggleEnabled(account.id, enabled)}
                        />
                        <Badge className={account.enabled ? 'status-success' : 'status-pending'}>
                          {account.enabled ? 'Active' : 'Disabled'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {account.last_seen_item_id ? (
                        <span className="text-xs">{account.last_seen_item_id.substring(0, 8)}...</span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(account.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleEdit(account)}
                          className="glass-button h-8 w-8 p-0"
                        >
                          <Edit className="w-3 h-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(account.id)}
                          className="glass-button h-8 w-8 p-0 text-destructive hover:bg-destructive/20"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-medium text-glass-foreground mb-2">No accounts configured</h3>
              <p>Add your first social media account to start monitoring</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}