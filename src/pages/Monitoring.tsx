import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { 
  Search, 
  RefreshCw, 
  Edit, 
  Check, 
  X, 
  ExternalLink,
  RotateCcw
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

interface JobStatus {
  id: string;
  type: string;
  status: string;
  tweet_id: string;
  created_at: string;
  attempts: number;
  last_error: string;
}

export default function Monitoring() {
  const [entries, setEntries] = useState<MonitoringEntry[]>([]);
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [editingEntry, setEditingEntry] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [selectedTweets, setSelectedTweets] = useState<Set<string>>(new Set());
  const [isReprocessing, setIsReprocessing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchMonitoringData();
    setupRealtimeSubscriptions();
  }, []);

  const setupRealtimeSubscriptions = () => {
    // Subscribe to posts changes
    const postsChannel = supabase
      .channel('posts-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'posts'
        },
        () => {
          console.log('Posts updated, refreshing data...');
          fetchMonitoringData();
        }
      )
      .subscribe();

    // Subscribe to jobs changes for live queue status
    const jobsChannel = supabase
      .channel('jobs-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'jobs'
        },
        () => {
          console.log('Jobs updated, refreshing data...');
          fetchJobsData();
        }
      )
      .subscribe();

    // Subscribe to deliveries changes
    const deliveriesChannel = supabase
      .channel('deliveries-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'deliveries'
        },
        () => {
          console.log('Deliveries updated, refreshing data...');
          fetchMonitoringData();
        }
      )
      .subscribe();

    // Cleanup function
    return () => {
      supabase.removeChannel(postsChannel);
      supabase.removeChannel(jobsChannel);
      supabase.removeChannel(deliveriesChannel);
    };
  };

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
      await fetchJobsData();
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

  const fetchJobsData = async () => {
    try {
      // Get recent jobs for queue monitoring
      const { data: jobsData, error: jobsError } = await supabase
        .from('jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (jobsError) throw jobsError;

      const formattedJobs: JobStatus[] = jobsData.map(job => ({
        id: job.id,
        type: job.type,
        status: job.status,
        tweet_id: (job.payload as any)?.tweet_id || 'Unknown',
        created_at: job.created_at,
        attempts: job.attempts || 0,
        last_error: job.last_error || ''
      }));

      setJobs(formattedJobs);
    } catch (error) {
      console.error('Error fetching jobs data:', error);
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

  const handleSelectTweet = (tweetId: string, checked: boolean) => {
    const newSelected = new Set(selectedTweets);
    if (checked) {
      newSelected.add(tweetId);
    } else {
      newSelected.delete(tweetId);
    }
    setSelectedTweets(newSelected);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedTweets(new Set(filteredEntries.map(entry => entry.tweet_id)));
    } else {
      setSelectedTweets(new Set());
    }
  };

  const handleReprocessSelected = async () => {
    if (selectedTweets.size === 0) {
      toast({
        title: "No Selection",
        description: "Please select tweets to reprocess",
        variant: "destructive",
      });
      return;
    }

    setIsReprocessing(true);
    try {
      // Create translation jobs for all selected tweets
      const jobs = Array.from(selectedTweets).map(tweetId => ({
        type: 'translate',
        payload: { tweet_id: tweetId },
        status: 'pending'
      }));

      const { error } = await supabase
        .from('jobs')
        .insert(jobs);

      if (error) throw error;

      toast({
        title: "Success",
        description: `${selectedTweets.size} tweets queued for reprocessing`,
      });

      // Clear selection
      setSelectedTweets(new Set());
      fetchMonitoringData();
    } catch (error) {
      console.error('Error reprocessing tweets:', error);
      toast({
        title: "Error",
        description: "Failed to reprocess selected tweets",
        variant: "destructive",
      });
    } finally {
      setIsReprocessing(false);
    }
  };

  const filteredEntries = entries.filter(entry => 
    entry.text_original.toLowerCase().includes(searchTerm.toLowerCase()) ||
    entry.text_translated.toLowerCase().includes(searchTerm.toLowerCase()) ||
    entry.account_handle.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Live stats
  const totalPosts = entries.length;
  const translatedPosts = entries.filter(e => e.is_translated).length;
  const deliveredPosts = entries.filter(e => e.is_delivered).length;
  const needsTranslation = entries.filter(e => !e.is_translated).length;

  // Live job stats
  const pendingJobs = jobs.filter(j => j.status === 'pending').length;
  const runningJobs = jobs.filter(j => j.status === 'running').length;
  const failedJobs = jobs.filter(j => j.status === 'failed').length;

  const getJobStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'text-yellow-600';
      case 'running': return 'text-blue-600';
      case 'completed': return 'text-green-600';
      case 'failed': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

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
            English → Persian translation pipeline • Live updates enabled
          </p>
        </div>
        <Button onClick={fetchMonitoringData} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Live Stats */}
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

      {/* Live Job Queue Status */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Live Job Queue
            {(pendingJobs > 0 || runningJobs > 0) && (
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-sm font-normal text-muted-foreground">Processing</span>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div className="text-center">
              <p className="text-xl font-bold text-yellow-600">{pendingJobs}</p>
              <p className="text-sm text-muted-foreground">Pending</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-blue-600">{runningJobs}</p>
              <p className="text-sm text-muted-foreground">Running</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-green-600">
                {jobs.filter(j => j.status === 'completed').length}
              </p>
              <p className="text-sm text-muted-foreground">Completed</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-red-600">{failedJobs}</p>
              <p className="text-sm text-muted-foreground">Failed</p>
            </div>
          </div>
          
          {/* Recent Jobs List */}
          {jobs.length > 0 && (
            <div className="space-y-2 max-h-32 overflow-y-auto">
              <h4 className="font-medium text-sm text-muted-foreground mb-2">Recent Jobs</h4>
              {jobs.slice(0, 10).map((job) => (
                <div key={job.id} className="flex items-center justify-between text-sm p-2 bg-muted/50 rounded">
                  <div className="flex items-center gap-2">
                    <Badge variant={job.status === 'completed' ? 'default' : 
                                  job.status === 'failed' ? 'destructive' : 
                                  job.status === 'running' ? 'secondary' : 'outline'}>
                      {job.type}
                    </Badge>
                    <span className="truncate max-w-[200px]">
                      {job.tweet_id.split('/').pop()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`font-medium ${getJobStatusColor(job.status)}`}>
                      {job.status}
                    </span>
                    {job.attempts > 1 && (
                      <Badge variant="outline" className="text-xs">
                        Attempt {job.attempts}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Search and Bulk Actions */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex gap-4 items-center">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder="Search content..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            
            {/* Bulk Selection Controls */}
            <div className="flex items-center gap-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="select-all"
                  checked={filteredEntries.length > 0 && selectedTweets.size === filteredEntries.length}
                  onCheckedChange={handleSelectAll}
                />
                <label
                  htmlFor="select-all"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Select All ({filteredEntries.length})
                </label>
              </div>
              
              {selectedTweets.size > 0 && (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {selectedTweets.size} selected
                  </Badge>
                  <Button
                    onClick={handleReprocessSelected}
                    disabled={isReprocessing}
                    variant="outline"
                    size="sm"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    {isReprocessing ? "Processing..." : "Reprocess Selected"}
                  </Button>
                </div>
              )}
            </div>
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
            const isSelected = selectedTweets.has(entry.tweet_id);
            
            return (
              <Card key={entry.tweet_id} className={isSelected ? "ring-2 ring-primary" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => handleSelectTweet(entry.tweet_id, checked as boolean)}
                      />
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