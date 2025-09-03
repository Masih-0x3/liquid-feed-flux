import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { 
  Search, 
  RefreshCw, 
  Edit, 
  Check, 
  X, 
  ExternalLink
} from "lucide-react";
import { format } from "date-fns";

interface MonitoringEntry {
  tweet_id: string;
  text_original: string;
  text_translated: string;
  url: string;
  created_at: string;
  account_handle: string;
  delivery_status: string;
  telegram_message_ids: string[];
  is_translated: boolean;
  is_delivered: boolean;
}

export default function Monitoring() {
  const [entries, setEntries] = useState<MonitoringEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [editingEntry, setEditingEntry] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    fetchMonitoringData();
  }, []);

  const fetchMonitoringData = async () => {
    setLoading(true);
    try {
      // Get posts with account info
      const { data: postsData, error: postsError } = await supabase
        .from('posts')
        .select(`
          *,
          accounts!inner(handle, display_name)
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (postsError) throw postsError;

      // Get delivery status for each post
      const { data: deliveriesData, error: deliveriesError } = await supabase
        .from('deliveries')
        .select('*')
        .eq('subject_type', 'post');

      if (deliveriesError) throw deliveriesError;

      // Combine the data - simplified
      const combinedData: MonitoringEntry[] = postsData.map(post => {
        const delivery = deliveriesData.find(d => d.subject_id === post.tweet_id);
        const isTranslated = !!(post.text_translated && post.text_translated.trim() && post.text_translated !== post.text_original);
        const isDelivered = delivery?.status === 'posted';
        
        return {
          tweet_id: post.tweet_id,
          text_original: post.text_original || '',
          text_translated: post.text_translated || '',
          url: post.url || '',
          created_at: post.created_at,
          account_handle: post.accounts.handle,
          delivery_status: delivery?.status || 'pending',
          telegram_message_ids: delivery?.telegram_message_ids || [],
          is_translated: isTranslated,
          is_delivered: isDelivered
        };
      });

      setEntries(combinedData);
    } catch (error) {
      console.error('Error fetching monitoring data:', error);
      toast({
        title: "Error",
        description: "Failed to fetch monitoring data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEditContent = (entry: MonitoringEntry) => {
    setEditingEntry(entry.tweet_id);
    setEditedContent(entry.text_translated || entry.text_original);
  };

  const handleSaveEdit = async () => {
    if (!editingEntry) return;

    try {
      const { error } = await supabase
        .from('posts')
        .update({ text_translated: editedContent })
        .eq('tweet_id', editingEntry);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Translation updated successfully",
      });

      setEditingEntry(null);
      setEditedContent("");
      fetchMonitoringData();
    } catch (error) {
      console.error('Error updating content:', error);
      toast({
        title: "Error",
        description: "Failed to update content",
        variant: "destructive",
      });
    }
  };

  const handleCancelEdit = () => {
    setEditingEntry(null);
    setEditedContent("");
  };

  const handleRetryTranslation = async (tweetId: string) => {
    try {
      // Create a simple translation job
      const { error } = await supabase
        .from('jobs')
        .insert({
          type: 'translate',
          payload: { tweet_id: tweetId },
          status: 'pending'
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Translation job queued",
      });

      fetchMonitoringData();
    } catch (error) {
      console.error('Error retrying translation:', error);
      toast({
        title: "Error",
        description: "Failed to retry translation",
        variant: "destructive",
      });
    }
  };

  const filteredEntries = entries.filter(entry => 
    entry.text_original.toLowerCase().includes(searchTerm.toLowerCase()) ||
    entry.text_translated.toLowerCase().includes(searchTerm.toLowerCase()) ||
    entry.account_handle.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Simple stats
  const totalPosts = entries.length;
  const translatedPosts = entries.filter(e => e.is_translated).length;
  const deliveredPosts = entries.filter(e => e.is_delivered).length;
  const needsTranslation = entries.filter(e => !e.is_translated).length;

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <RefreshCw className="w-8 h-8 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Content Monitoring</h1>
          <p className="text-muted-foreground">
            English → Persian translation pipeline
          </p>
        </div>
        <Button onClick={fetchMonitoringData} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Simple Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-2xl font-bold">{totalPosts}</p>
              <p className="text-sm text-muted-foreground">Total Posts</p>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">{translatedPosts}</p>
              <p className="text-sm text-muted-foreground">Translated</p>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-600">{deliveredPosts}</p>
              <p className="text-sm text-muted-foreground">Delivered</p>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-orange-600">{needsTranslation}</p>
              <p className="text-sm text-muted-foreground">Needs Translation</p>
              {needsTranslation > 0 && (
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="mt-2"
                  onClick={() => {
                    entries.filter(e => !e.is_translated).forEach(entry => {
                      handleRetryTranslation(entry.tweet_id);
                    });
                  }}
                >
                  Retry All
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Search content..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Entries */}
      <div className="space-y-4">
        {filteredEntries.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">No entries found</p>
            </CardContent>
          </Card>
        ) : (
          filteredEntries.map((entry) => {
            const isEditing = editingEntry === entry.tweet_id;
            
            return (
              <Card key={entry.tweet_id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg">@{entry.account_handle}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(entry.created_at), 'MMM dd, yyyy HH:mm')}
                        {entry.url && (
                          <>
                            {" • "}
                            <a 
                              href={entry.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 hover:underline"
                            >
                              Source <ExternalLink className="w-3 h-3" />
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={entry.is_translated ? "default" : "secondary"}>
                        {entry.is_translated ? "Translated" : "Original"}
                      </Badge>
                      <Badge variant={entry.is_delivered ? "default" : "outline"}>
                        {entry.is_delivered ? "Delivered" : "Pending"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                
                <CardContent>
                  {/* Original Content */}
                  <div className="mb-4">
                    <h4 className="font-medium mb-2 text-sm text-muted-foreground">English</h4>
                    <p className="text-sm bg-muted/50 p-3 rounded border">
                      {entry.text_original || "[No content]"}
                    </p>
                  </div>

                  {/* Translated Content */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-sm text-muted-foreground">Persian</h4>
                      <div className="flex items-center gap-2">
                        {!entry.is_translated && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRetryTranslation(entry.tweet_id)}
                          >
                            Translate
                          </Button>
                        )}
                        {!isEditing && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEditContent(entry)}
                          >
                            <Edit className="w-3 h-3 mr-1" />
                            Edit
                          </Button>
                        )}
                      </div>
                    </div>
                    
                    {isEditing ? (
                      <div className="space-y-3">
                        <Textarea
                          value={editedContent}
                          onChange={(e) => setEditedContent(e.target.value)}
                          className="min-h-[100px]"
                          placeholder="Enter Persian translation..."
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={handleSaveEdit}>
                            <Check className="w-3 h-3 mr-1" />
                            Save
                          </Button>
                          <Button size="sm" variant="outline" onClick={handleCancelEdit}>
                            <X className="w-3 h-3 mr-1" />
                            Cancel
                          </Button>
                        </div>
                      </div>
                     ) : (
                       <div className={`text-sm p-3 rounded border ${
                         !entry.is_translated ? 'bg-orange-50 border-orange-200' : 'bg-muted/50'
                       }`}>
                         <div className="whitespace-pre-wrap break-words" dir="rtl">
                           {entry.text_translated || "[Not translated yet]"}
                         </div>
                       </div>
                     )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}