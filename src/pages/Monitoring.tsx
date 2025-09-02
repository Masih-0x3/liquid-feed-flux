import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { 
  Search, 
  RefreshCw, 
  Send, 
  Edit, 
  Check, 
  X, 
  Clock, 
  ExternalLink,
  Filter,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { format } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface MonitoringEntry {
  tweet_id: string;
  account_id: string;
  text_original: string;
  text_translated: string;
  lang_original: string;
  url: string;
  tweeted_at: string;
  has_media: boolean;
  created_at: string;
  account_handle: string;
  account_display_name: string;
  delivery_status: string;
  delivery_error: string;
  telegram_message_ids: string[];
  translation_status: string;
  job_attempts: number;
  translation_success: boolean;
  delivery_success: boolean;
  delivered_without_translation: boolean;
  translation_failed: boolean;
}

export default function Monitoring() {
  const [searchParams] = useSearchParams();
  const [entries, setEntries] = useState<MonitoringEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState(searchParams.get('filter') || "all");
  const [editingEntry, setEditingEntry] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
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

      // Get job status for each post
      const { data: jobsData, error: jobsError } = await supabase
        .from('jobs')
        .select('*')
        .order('created_at', { ascending: false });

      if (jobsError) throw jobsError;

      // Combine the data
      const combinedData: MonitoringEntry[] = postsData.map(post => {
        const delivery = deliveriesData.find(d => d.subject_id === post.tweet_id);
        const translateJob = jobsData.find(j => 
          j.type === 'translate' && 
          j.payload && 
          typeof j.payload === 'object' && 
          'tweet_id' in j.payload &&
          (j.payload as any).tweet_id === post.tweet_id
        );
        const deliverJob = jobsData.find(j => 
          j.type === 'deliver' && 
          j.payload &&
          typeof j.payload === 'object' && 
          'tweet_id' in j.payload &&
          (j.payload as any).tweet_id === post.tweet_id
        );

        const translationSuccess = post.text_translated && 
                                 post.text_translated.trim() !== '' && 
                                 post.text_translated !== post.text_original;
        const deliverySuccess = delivery?.status === 'posted';
        const translationFailed = translateJob?.status === 'failed' || 
                                 (deliverySuccess && !translationSuccess);
        
        return {
          tweet_id: post.tweet_id,
          account_id: post.account_id,
          text_original: post.text_original || '',
          text_translated: post.text_translated || '',
          lang_original: post.lang_original || 'en',
          url: post.url || '',
          tweeted_at: post.tweeted_at,
          has_media: post.has_media || false,
          created_at: post.created_at,
          account_handle: post.accounts.handle,
          account_display_name: post.accounts.display_name,
          delivery_status: delivery?.status || 'pending',
          delivery_error: delivery?.last_error || '',
          telegram_message_ids: delivery?.telegram_message_ids || [],
          translation_status: translateJob?.status || (translationSuccess ? 'completed' : (translationFailed ? 'failed' : 'pending')),
          job_attempts: Math.max(translateJob?.attempts || 0, deliverJob?.attempts || 0),
          translation_success: translationSuccess,
          delivery_success: deliverySuccess,
          delivered_without_translation: deliverySuccess && !translationSuccess,
          translation_failed: translationFailed
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
        description: "Content updated successfully",
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
      // For posts delivered without translation, we want to translate and then resend
      const entry = entries.find(e => e.tweet_id === tweetId);
      
      // Create a new translation job
      const { error: translationError } = await supabase
        .from('jobs')
        .insert({
          type: 'translate',
          payload: { tweet_id: tweetId },
          status: 'pending',
          attempts: 0
        });

      if (translationError) throw translationError;

      // If this was delivered without translation, also create a delivery job to resend with translation
      if (entry?.delivered_without_translation) {
        const { error: deliveryError } = await supabase
          .from('jobs')
          .insert({
            type: 'deliver',
            payload: { tweet_id: tweetId },
            status: 'pending',
            attempts: 0
          });

        if (deliveryError) throw deliveryError;
        
        toast({
          title: "Success",
          description: "Translation and resend jobs queued",
        });
      } else {
        toast({
          title: "Success",
          description: "Translation job queued for retry",
        });
      }

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

  const handleRetryDelivery = async (tweetId: string) => {
    try {
      // Create a new delivery job
      const { error } = await supabase
        .from('jobs')
        .insert({
          type: 'deliver',
          payload: { tweet_id: tweetId },
          status: 'pending',
          attempts: 0
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Delivery job queued for retry",
      });

      fetchMonitoringData();
    } catch (error) {
      console.error('Error retrying delivery:', error);
      toast({
        title: "Error",
        description: "Failed to retry delivery",
        variant: "destructive",
      });
    }
  };

  const handleResendToTelegram = async (tweetId: string) => {
    try {
      const { error } = await supabase.functions.invoke('admin-retry', {
        body: { 
          action: 'resend_delivery',
          tweet_id: tweetId
        }
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Resent to Telegram successfully",
      });

      fetchMonitoringData();
    } catch (error) {
      console.error('Error resending to Telegram:', error);
      toast({
        title: "Error",
        description: "Failed to resend to Telegram",
        variant: "destructive",
      });
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'completed':
      case 'posted':
        return 'default';
      case 'pending':
        return 'secondary';
      case 'failed':
      case 'error':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
      case 'posted':
        return <Check className="w-3 h-3" />;
      case 'pending':
        return <Clock className="w-3 h-3" />;
      case 'failed':
      case 'error':
        return <X className="w-3 h-3" />;
      default:
        return <Clock className="w-3 h-3" />;
    }
  };

  const toggleExpanded = (tweetId: string) => {
    const newExpanded = new Set(expandedEntries);
    if (newExpanded.has(tweetId)) {
      newExpanded.delete(tweetId);
    } else {
      newExpanded.add(tweetId);
    }
    setExpandedEntries(newExpanded);
  };

  const filteredEntries = entries.filter(entry => {
    const matchesSearch = 
      entry.text_original.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.text_translated.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.account_handle.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesFilter = 
      statusFilter === 'all' ||
      (statusFilter === 'delivered' && entry.delivery_status === 'posted') ||
      (statusFilter === 'pending' && (entry.delivery_status === 'pending' || entry.translation_status === 'pending')) ||
      (statusFilter === 'failed' && (entry.delivery_status === 'failed' || entry.translation_status === 'failed'));

    return matchesSearch && matchesFilter;
  });

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
            Monitor RSS feeds, translations, and Telegram deliveries
          </p>
        </div>
        <Button onClick={fetchMonitoringData} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Pipeline Status Summary */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Posts</p>
                <p className="text-2xl font-bold">{entries.length}</p>
              </div>
              <Badge variant="outline" className="text-xs">Recent</Badge>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Fully Successful</p>
                <p className="text-2xl font-bold text-green-600">
                  {entries.filter(e => e.translation_success && e.delivery_success).length}
                </p>
                <p className="text-xs text-muted-foreground">Translated + Delivered</p>
              </div>
              <Badge variant="default" className="text-xs">Perfect</Badge>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">English Delivered</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {entries.filter(e => e.delivered_without_translation).length}
                </p>
                <p className="text-xs text-muted-foreground">No translation</p>
              </div>
              <Badge variant="secondary" className="text-xs">Partial</Badge>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Translation Failed</p>
                <p className="text-2xl font-bold text-red-600">
                  {entries.filter(e => e.translation_failed).length}
                </p>
              </div>
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => {
                  entries.filter(e => e.translation_failed).forEach(entry => {
                    handleRetryTranslation(entry.tweet_id);
                  });
                }}
                disabled={entries.filter(e => e.translation_failed).length === 0}
              >
                Retry All
              </Button>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Delivery Failed</p>
                <p className="text-2xl font-bold text-red-600">
                  {entries.filter(e => e.delivery_status === 'failed').length}
                </p>
              </div>
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => {
                  entries.filter(e => e.delivery_status === 'failed').forEach(entry => {
                    handleRetryDelivery(entry.tweet_id);
                  });
                }}
                disabled={entries.filter(e => e.delivery_status === 'failed').length === 0}
              >
                Retry All
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex gap-4 items-center">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder="Search content or account..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Filter className="w-4 h-4 mr-2" />
                  {statusFilter === 'all' ? 'All Status' : 
                   statusFilter === 'delivered' ? 'Delivered' :
                   statusFilter === 'pending' ? 'Pending' : 'Failed'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => setStatusFilter('all')}>
                  All Status
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStatusFilter('delivered')}>
                  Delivered
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStatusFilter('pending')}>
                  Pending
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStatusFilter('failed')}>
                  Failed
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      {/* Entries */}
      <div className="space-y-4">
        {filteredEntries.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">No entries found matching your criteria</p>
            </CardContent>
          </Card>
        ) : (
          filteredEntries.map((entry) => {
            const isExpanded = expandedEntries.has(entry.tweet_id);
            const isEditing = editingEntry === entry.tweet_id;
            
            return (
              <Card key={entry.tweet_id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <span>@{entry.account_handle}</span>
                        <Badge variant="outline" className="text-xs">
                          {entry.lang_original}
                        </Badge>
                      </CardTitle>
                      <CardDescription>
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
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={getStatusBadgeVariant(entry.translation_status)} className="flex items-center gap-1">
                        {getStatusIcon(entry.translation_status)}
                        Translation
                      </Badge>
                      <Badge variant={getStatusBadgeVariant(entry.delivery_status)} className="flex items-center gap-1">
                        {getStatusIcon(entry.delivery_status)}
                        Delivery
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleExpanded(entry.tweet_id)}
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                
                <CardContent>
                  {/* Original Content */}
                  <div className="mb-4">
                    <h4 className="font-medium mb-2 text-sm text-muted-foreground">Original Content</h4>
                    <p className="text-sm bg-muted/50 p-3 rounded border">
                      {entry.text_original || "[No content]"}
                    </p>
                  </div>

                  {/* Translated Content */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-sm text-muted-foreground">Translated Content</h4>
                      <div className="flex items-center gap-2">
                        {/* Show warning for delivered without translation */}
                        {entry.delivered_without_translation && (
                          <Badge variant="secondary" className="text-xs">
                            ⚠️ Delivered in English
                          </Badge>
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
                          placeholder="Enter translated content..."
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
                         entry.delivered_without_translation 
                           ? 'bg-yellow-50 border-yellow-200' 
                           : 'bg-muted/50'
                       }`}>
                         <div className="whitespace-pre-wrap break-words">
                           {entry.text_translated && entry.text_translated.trim() ? 
                             entry.text_translated : 
                             (entry.delivered_without_translation 
                               ? "[Delivered in English - translation failed]" 
                               : "[Not translated yet]")}
                         </div>
                       </div>
                     )}
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <>
                      <Separator className="my-4" />
                      <div className="space-y-4">
                        {/* Delivery Info */}
                        <div>
                          <h4 className="font-medium mb-2 text-sm">Delivery Information</h4>
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="text-muted-foreground">Status:</span>
                              <Badge variant={getStatusBadgeVariant(entry.delivery_status)} className="ml-2">
                                {entry.delivery_status}
                              </Badge>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Attempts:</span>
                              <span className="ml-2">{entry.job_attempts}</span>
                            </div>
                            {entry.telegram_message_ids.length > 0 && (
                              <div>
                                <span className="text-muted-foreground">Telegram IDs:</span>
                                <span className="ml-2">{entry.telegram_message_ids.join(', ')}</span>
                              </div>
                            )}
                            {entry.delivery_error && (
                              <div className="col-span-2">
                                <span className="text-muted-foreground">Error:</span>
                                <p className="text-red-600 text-xs mt-1 bg-red-50 p-2 rounded border">
                                  {entry.delivery_error}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2 flex-wrap">
                          {/* Smart Translation Actions */}
                          {(entry.translation_status === 'failed' || entry.delivered_without_translation) && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRetryTranslation(entry.tweet_id)}
                            >
                              <RefreshCw className="w-3 h-3 mr-1" />
                              {entry.delivered_without_translation ? 'Translate & Resend' : 'Retry Translation'}
                            </Button>
                          )}
                          
                          {/* Delivery Actions */}
                          {entry.delivery_status === 'failed' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRetryDelivery(entry.tweet_id)}
                            >
                              <RefreshCw className="w-3 h-3 mr-1" />
                              Retry Delivery
                            </Button>
                          )}
                          
                          {/* Force Resend (works for any status except pending) */}
                          {entry.delivery_status !== 'pending' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleResendToTelegram(entry.tweet_id)}
                            >
                              <Send className="w-3 h-3 mr-1" />
                              Force Resend
                            </Button>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}