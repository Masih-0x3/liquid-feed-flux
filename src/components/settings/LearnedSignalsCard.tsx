import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Brain, RotateCcw, Loader2, TrendingUp, TrendingDown } from 'lucide-react';

interface LearnedBiases {
  author_bias: Record<string, number>;
  tag_bias: Record<string, number>;
  keyword_bias: Record<string, number>;
  rebuilt_at?: string;
}

interface FeedbackEvent {
  id: string;
  tweet_id: string;
  action: string;
  polarity: number;
  created_at: string;
  related_tweet_id?: string | null;
}

function BiasTable({ label, biases }: { label: string; biases: Record<string, number> }) {
  const sorted = Object.entries(biases)
    .filter(([, v]) => Math.abs(v) >= 0.01)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  if (sorted.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      <div className="flex flex-wrap gap-1">
        {sorted.slice(0, 15).map(([key, val]) => (
          <Badge
            key={key}
            variant="outline"
            className={val > 0 ? 'border-green-500/40 text-green-400' : 'border-red-500/40 text-red-400'}
          >
            {label === 'Authors' ? `@${key}` : key}
            {' '}
            {val > 0 ? <TrendingUp className="w-3 h-3 ml-0.5 inline" /> : <TrendingDown className="w-3 h-3 ml-0.5 inline" />}
            {val > 0 ? '+' : ''}{val.toFixed(2)}
          </Badge>
        ))}
        {sorted.length > 15 && (
          <Badge variant="outline" className="text-muted-foreground">+{sorted.length - 15} more</Badge>
        )}
      </div>
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  force_deliver: 'Force Deliver',
  force_x: 'Force on X',
  confirm_deliver: 'Re-deliver',
  confirm_x: 'Re-post X',
  dispute_high: 'Score down',
  dispute_low: 'Score up',
  manual_score: 'Manual score',
  score_too_low: 'Too low',
  score_too_high: 'Too high',
  correct_deliver: 'Correct deliver',
  correct_skip: 'Correct skip',
  should_pass_audience: 'Should pass',
  should_skip_audience: 'Should skip',
  wrong_relevance_class: 'Wrong class',
  global_exception_worth_covering: 'Global exception',
  not_global_exception: 'Not exception',
  not_duplicate: 'Not a dup',
  confirm_duplicate: 'Confirm dup',
  reprocess: 'Reprocess',
  edit_translation: 'Edit translation',
};

export default function LearnedSignalsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [resetting, setResetting] = useState(false);

  const { data: biases, isLoading: biasesLoading } = useQuery({
    queryKey: ['learned-biases'],
    queryFn: async () => {
      const { data } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'learned_biases')
        .maybeSingle();
      return (data?.value ?? { author_bias: {}, tag_bias: {}, keyword_bias: {} }) as LearnedBiases;
    },
    staleTime: 10_000,
  });

  const { data: recentEvents } = useQuery({
    queryKey: ['feedback-events-recent'],
    queryFn: async () => {
      const { data } = await supabase
        .from('feedback_events')
        .select('id, tweet_id, action, polarity, created_at, related_tweet_id')
        .order('created_at', { ascending: false })
        .limit(10);
      return (data ?? []) as FeedbackEvent[];
    },
    staleTime: 10_000,
  });

  const handleReset = async () => {
    setResetting(true);
    try {
      const { error } = await supabase.functions.invoke('admin-actions', {
        body: { action: 'reset_learned_biases' },
      });
      if (error) throw error;
      toast({ title: 'Biases reset', description: 'All learned signals cleared' });
      queryClient.invalidateQueries({ queryKey: ['learned-biases'] });
      queryClient.invalidateQueries({ queryKey: ['feedback-events-recent'] });
    } catch {
      toast({ title: 'Error', description: 'Failed to reset biases', variant: 'destructive' });
    } finally {
      setResetting(false);
    }
  };

  const hasBiases = biases && (
    Object.keys(biases.author_bias).length > 0 ||
    Object.keys(biases.tag_bias).length > 0 ||
    Object.keys(biases.keyword_bias).length > 0
  );

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center text-glass-foreground">
              <Brain className="w-5 h-5 mr-2" />
              Learned Signals
            </CardTitle>
            <CardDescription>
              Biases learned from your Monitoring actions (force deliver, re-score, etc.).
              These adjust the AI score by up to ±5 points per post.
            </CardDescription>
          </div>
          {hasBiases && (
            <Button variant="outline" size="sm" onClick={handleReset} disabled={resetting}>
              {resetting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RotateCcw className="w-3 h-3 mr-1" />}
              Reset all
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {biasesLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : !hasBiases ? (
          <p className="text-sm text-muted-foreground">
            No learned biases yet. Use Force Deliver, Re-score, or other Monitoring actions to start teaching the filter.
          </p>
        ) : (
          <div className="space-y-3">
            <BiasTable label="Authors" biases={biases!.author_bias} />
            <BiasTable label="Tags" biases={biases!.tag_bias} />
            <BiasTable label="Keywords" biases={biases!.keyword_bias} />
            {biases!.rebuilt_at && (
              <p className="text-xs text-muted-foreground">
                Last rebuild: {new Date(biases!.rebuilt_at).toLocaleString()}
              </p>
            )}
          </div>
        )}

        {recentEvents && recentEvents.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Recent feedback</p>
            <div className="space-y-1">
              {recentEvents.map((ev) => (
                <div key={ev.id} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground w-28 shrink-0">
                    {new Date(ev.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <Badge variant="outline" className="text-xs py-0">
                    {ACTION_LABELS[ev.action] ?? ev.action}
                  </Badge>
                  <span
                    className={
                      ev.polarity > 0 ? 'text-green-400' : ev.polarity < 0 ? 'text-red-400' : 'text-muted-foreground'
                    }
                  >
                    {ev.polarity > 0 ? `+${ev.polarity}` : ev.polarity}
                  </span>
                  <span className="text-muted-foreground truncate max-w-[160px]" title={ev.tweet_id}>
                    {ev.tweet_id.slice(0, 12)}…
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
