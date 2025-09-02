import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Plus, ExternalLink, TestTube, Loader2, Rss, Edit, Trash2 } from 'lucide-react';

interface Feed {
  id: string;
  name: string;
  rssapp_feed_id: string | null;
  rss_url: string | null;
  enabled: boolean;
  created_at: string;
}

export default function Feeds() {
  const { toast } = useToast();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingFeed, setEditingFeed] = useState<Feed | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    rssapp_feed_id: '',
    rss_url: '',
    enabled: true,
  });

  useEffect(() => {
    fetchFeeds();
  }, []);

  const fetchFeeds = async () => {
    try {
      const { data, error } = await supabase
        .from('feeds')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setFeeds(data || []);
    } catch (error) {
      console.error('Error fetching feeds:', error);
      toast({
        title: "Error loading feeds",
        description: "Failed to fetch feeds. Please try again.",
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
      if (editingFeed) {
        const { error } = await supabase
          .from('feeds')
          .update(formData)
          .eq('id', editingFeed.id);

        if (error) throw error;
        toast({ title: "Feed updated successfully" });
      } else {
        const { error } = await supabase
          .from('feeds')
          .insert([formData]);

        if (error) throw error;
        toast({ title: "Feed created successfully" });
      }

      setIsDialogOpen(false);
      setEditingFeed(null);
      setFormData({ name: '', rssapp_feed_id: '', rss_url: '', enabled: true });
      fetchFeeds();
    } catch (error) {
      console.error('Error saving feed:', error);
      toast({
        title: "Error saving feed",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (feed: Feed) => {
    setEditingFeed(feed);
    setFormData({
      name: feed.name,
      rssapp_feed_id: feed.rssapp_feed_id || '',
      rss_url: feed.rss_url || '',
      enabled: feed.enabled,
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (feedId: string) => {
    if (!confirm('Are you sure you want to delete this feed?')) return;

    try {
      const { error } = await supabase
        .from('feeds')
        .delete()
        .eq('id', feedId);

      if (error) throw error;
      toast({ title: "Feed deleted successfully" });
      fetchFeeds();
    } catch (error) {
      console.error('Error deleting feed:', error);
      toast({
        title: "Error deleting feed",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleToggleEnabled = async (feedId: string, enabled: boolean) => {
    try {
      const { error } = await supabase
        .from('feeds')
        .update({ enabled })
        .eq('id', feedId);

      if (error) throw error;
      toast({ title: `Feed ${enabled ? 'enabled' : 'disabled'} successfully` });
      fetchFeeds();
    } catch (error) {
      console.error('Error updating feed:', error);
      toast({
        title: "Error updating feed",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-glass-foreground">RSS Feeds</h1>
          <p className="text-muted-foreground mt-1">Manage your RSS.app feed connections</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-primary hover:opacity-90 text-white">
              <Plus className="w-4 h-4 mr-2" />
              Add Feed
            </Button>
          </DialogTrigger>
          <DialogContent className="glass-panel border-glass-border">
            <DialogHeader>
              <DialogTitle className="text-glass-foreground">
                {editingFeed ? 'Edit Feed' : 'Add New Feed'}
              </DialogTitle>
              <DialogDescription>
                Configure RSS feed settings for content ingestion
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Feed Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="glass-input"
                  placeholder="e.g., Tech News Feed"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rssapp_feed_id">RSS.app Feed ID</Label>
                <Input
                  id="rssapp_feed_id"
                  value={formData.rssapp_feed_id}
                  onChange={(e) => setFormData(prev => ({ ...prev, rssapp_feed_id: e.target.value }))}
                  className="glass-input"
                  placeholder="12345"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rss_url">RSS URL</Label>
                <Input
                  id="rss_url"
                  value={formData.rss_url}
                  onChange={(e) => setFormData(prev => ({ ...prev, rss_url: e.target.value }))}
                  className="glass-input"
                  placeholder="https://feeds.example.com/rss"
                  type="url"
                />
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="enabled"
                  checked={formData.enabled}
                  onCheckedChange={(enabled) => setFormData(prev => ({ ...prev, enabled }))}
                />
                <Label htmlFor="enabled" className="text-glass-foreground">
                  Enable feed processing
                </Label>
              </div>
              <div className="flex space-x-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsDialogOpen(false);
                    setEditingFeed(null);
                    setFormData({ name: '', rssapp_feed_id: '', rss_url: '', enabled: true });
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
                  {editingFeed ? 'Update Feed' : 'Create Feed'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Feeds Table */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-xl font-display text-glass-foreground flex items-center">
            <Rss className="w-5 h-5 mr-2" />
            Configured Feeds
          </CardTitle>
          <CardDescription>
            RSS feeds that are being monitored for new content
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : feeds.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="border-glass-border hover:bg-glass-border/20">
                  <TableHead className="text-glass-foreground">Name</TableHead>
                  <TableHead className="text-glass-foreground">RSS.app ID</TableHead>
                  <TableHead className="text-glass-foreground">URL</TableHead>
                  <TableHead className="text-glass-foreground">Status</TableHead>
                  <TableHead className="text-glass-foreground">Created</TableHead>
                  <TableHead className="text-glass-foreground">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feeds.map((feed) => (
                  <TableRow key={feed.id} className="border-glass-border hover:bg-glass-border/20">
                    <TableCell className="font-medium text-glass-foreground">
                      {feed.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {feed.rssapp_feed_id || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate">
                      {feed.rss_url ? (
                        <a
                          href={feed.rss_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline flex items-center"
                        >
                          {feed.rss_url}
                          <ExternalLink className="w-3 h-3 ml-1" />
                        </a>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Switch
                          checked={feed.enabled}
                          onCheckedChange={(enabled) => handleToggleEnabled(feed.id, enabled)}
                        />
                        <Badge className={feed.enabled ? 'status-success' : 'status-pending'}>
                          {feed.enabled ? 'Active' : 'Disabled'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(feed.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleEdit(feed)}
                          className="glass-button h-8 w-8 p-0"
                        >
                          <Edit className="w-3 h-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="glass-button h-8 w-8 p-0 text-warning hover:bg-warning/20"
                        >
                          <TestTube className="w-3 h-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(feed.id)}
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
              <Rss className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-medium text-glass-foreground mb-2">No feeds configured</h3>
              <p>Add your first RSS feed to start monitoring content</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}