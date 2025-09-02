import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Send, Cog, RefreshCw, Loader2, ExternalLink, AlertCircle, CheckCircle } from 'lucide-react';

interface Delivery {
  id: string;
  subject_type: 'post' | 'thread';
  subject_id: string;
  telegram_chat_id: string | null;
  telegram_message_ids: string[] | null;
  status: 'pending' | 'posted' | 'failed';
  last_error: string | null;
  attempts: number;
  created_at: string;
}

interface Job {
  id: string;
  type: string;
  payload: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
  attempts: number;
  last_error: string | null;
  next_run_at: string;
  created_at: string;
}

export default function Deliveries() {
  const { toast } = useToast();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [deliveriesResult, jobsResult] = await Promise.all([
        supabase
          .from('deliveries')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('jobs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50)
      ]);

      if (deliveriesResult.error) throw deliveriesResult.error;
      if (jobsResult.error) throw jobsResult.error;

      setDeliveries((deliveriesResult.data || []) as Delivery[]);
      setJobs((jobsResult.data || []) as Job[]);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({
        title: "Error loading data",
        description: "Failed to fetch deliveries and jobs.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRetryDelivery = async (deliveryId: string) => {
    try {
      // Call the retry edge function
      const { error } = await supabase.functions.invoke('admin-retry', {
        body: { delivery_id: deliveryId }
      });

      if (error) throw error;
      toast({ title: "Delivery retry initiated" });
      fetchData();
    } catch (error) {
      console.error('Error retrying delivery:', error);
      toast({
        title: "Error retrying delivery",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleReplayJob = async (jobId: string) => {
    try {
      // Reset job to pending status
      const { error } = await supabase
        .from('jobs')
        .update({ 
          status: 'pending', 
          next_run_at: new Date().toISOString(),
          last_error: null 
        })
        .eq('id', jobId);

      if (error) throw error;
      toast({ title: "Job replayed successfully" });
      fetchData();
    } catch (error) {
      console.error('Error replaying job:', error);
      toast({
        title: "Error replaying job",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'posted':
      case 'completed':
        return <Badge className="status-success">
          <CheckCircle className="w-3 h-3 mr-1" />
          {status}
        </Badge>;
      case 'failed':
        return <Badge className="status-error">
          <AlertCircle className="w-3 h-3 mr-1" />
          Failed
        </Badge>;
      case 'running':
        return <Badge className="status-warning">
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          Running
        </Badge>;
      default:
        return <Badge className="status-pending">
          <Cog className="w-3 h-3 mr-1" />
          {status}
        </Badge>;
    }
  };

  const formatTelegramMessageIds = (messageIds: string[] | null) => {
    if (!messageIds || messageIds.length === 0) return '—';
    return messageIds.length > 1 ? `Album (${messageIds.length})` : messageIds[0];
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-glass-foreground">Deliveries & Jobs</h1>
          <p className="text-muted-foreground mt-1">Monitor delivery status and job queue</p>
        </div>
        <Button onClick={fetchData} className="glass-button">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="deliveries" className="space-y-6">
        <TabsList className="glass-panel">
          <TabsTrigger value="deliveries" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            <Send className="w-4 h-4 mr-2" />
            Telegram Deliveries
          </TabsTrigger>
          <TabsTrigger value="jobs" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            <Cog className="w-4 h-4 mr-2" />
            Background Jobs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="deliveries">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-xl font-display text-glass-foreground flex items-center">
                <Send className="w-5 h-5 mr-2" />
                Telegram Deliveries
              </CardTitle>
              <CardDescription>
                Status of content delivered to Telegram channels
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : deliveries.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="border-glass-border hover:bg-glass-border/20">
                      <TableHead className="text-glass-foreground">Type</TableHead>
                      <TableHead className="text-glass-foreground">Subject ID</TableHead>
                      <TableHead className="text-glass-foreground">Status</TableHead>
                      <TableHead className="text-glass-foreground">Channel</TableHead>
                      <TableHead className="text-glass-foreground">Message IDs</TableHead>
                      <TableHead className="text-glass-foreground">Attempts</TableHead>
                      <TableHead className="text-glass-foreground">Created</TableHead>
                      <TableHead className="text-glass-foreground">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deliveries.map((delivery) => (
                      <TableRow key={delivery.id} className="border-glass-border hover:bg-glass-border/20">
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {delivery.subject_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {delivery.subject_id.substring(0, 12)}...
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(delivery.status)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {delivery.telegram_chat_id || '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatTelegramMessageIds(delivery.telegram_message_ids)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {delivery.attempts}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(delivery.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            {delivery.status === 'failed' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleRetryDelivery(delivery.id)}
                                className="glass-button h-8 px-2 text-warning hover:bg-warning/20"
                              >
                                <RefreshCw className="w-3 h-3 mr-1" />
                                Retry
                              </Button>
                            )}
                            {delivery.telegram_message_ids && delivery.telegram_message_ids.length > 0 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="glass-button h-8 px-2"
                                onClick={() => {
                                  const chatId = delivery.telegram_chat_id;
                                  const messageId = delivery.telegram_message_ids![0];
                                  window.open(`https://t.me/c/${chatId}/${messageId}`, '_blank');
                                }}
                              >
                                <ExternalLink className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Send className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <h3 className="text-lg font-medium text-glass-foreground mb-2">No deliveries found</h3>
                  <p>Telegram deliveries will appear here</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="jobs">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-xl font-display text-glass-foreground flex items-center">
                <Cog className="w-5 h-5 mr-2" />
                Background Jobs
              </CardTitle>
              <CardDescription>
                Translation, moderation, and delivery job queue
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : jobs.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="border-glass-border hover:bg-glass-border/20">
                      <TableHead className="text-glass-foreground">Type</TableHead>
                      <TableHead className="text-glass-foreground">Status</TableHead>
                      <TableHead className="text-glass-foreground">Attempts</TableHead>
                      <TableHead className="text-glass-foreground">Next Run</TableHead>
                      <TableHead className="text-glass-foreground">Error</TableHead>
                      <TableHead className="text-glass-foreground">Created</TableHead>
                      <TableHead className="text-glass-foreground">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job) => (
                      <TableRow key={job.id} className="border-glass-border hover:bg-glass-border/20">
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {job.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(job.status)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {job.attempts}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(job.next_run_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-xs truncate">
                          {job.last_error ? (
                            <span className="text-destructive text-xs" title={job.last_error}>
                              {job.last_error.substring(0, 50)}...
                            </span>
                          ) : '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(job.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          {(job.status === 'failed' || job.status === 'completed') && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleReplayJob(job.id)}
                              className="glass-button h-8 px-2 text-primary hover:bg-primary/20"
                            >
                              <RefreshCw className="w-3 h-3 mr-1" />
                              Replay
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Cog className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <h3 className="text-lg font-medium text-glass-foreground mb-2">No jobs found</h3>
                  <p>Background jobs will appear here</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}