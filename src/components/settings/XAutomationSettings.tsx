import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useRuntimeControls } from '@/hooks/useRuntimeControls';
import { invokeAdminAction } from '@/api/adminActions';
import { useSaveSettings } from '@/hooks/useSettingsData';
import { Key, Shield, CheckCircle2, XCircle, Send, Sparkles, Loader2, AtSign, AlertTriangle, ExternalLink } from 'lucide-react';
import XPostingConfig, { type XPostingConfigValue } from '@/components/settings/XPostingConfig';
import XRateLimits, { type XRateLimitsValue } from '@/components/settings/XRateLimits';
import { useXMonthlyPostsCount } from '@/hooks/useXDeliveries';
import { useXApiSummary } from '@/hooks/useMonitoringData';
import { ConfirmSettingsAction } from '@/components/settings/ConfirmSettingsAction';
import { useSettingsDraft, useSettingsSave, SettingsSaveStatus, SettingsIncomingNotice } from '@/components/settings/SettingsDrafts';

interface Props {
  twitterHydration?: { enabled?: boolean; max_attempts?: number };
  xPostingConfig?: Partial<XPostingConfigValue>;
  xRateLimits?: Partial<XRateLimitsValue>;
  xApiControls?: { my_x_enabled?: boolean };
}

const SECRET_KEYS = [
  { key: 'TWITTER_CONSUMER_KEY', label: 'Consumer Key' },
  { key: 'TWITTER_CONSUMER_SECRET', label: 'Consumer Secret' },
  { key: 'TWITTER_ACCESS_TOKEN', label: 'Access Token' },
  { key: 'TWITTER_ACCESS_TOKEN_SECRET', label: 'Access Token Secret' },
] as const;

const DEFAULT_TEST_TWEET = 'Test tweet from automation pipeline ✅ — please ignore.';
const GENERIC_SUPABASE_DASHBOARD_URL = 'https://supabase.com/dashboard';
const SUPABASE_PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const SUPABASE_HOST_RE = /^([a-z0-9]{20})\.supabase\.co$/;

/**
 * Build a dashboard link from the same public identity used by the Supabase
 * client. A malformed or mismatched identity must never select a project.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function getSupabaseDashboardUrl(projectRef: unknown, supabaseUrl: unknown): string {
  const ref = typeof projectRef === 'string' ? projectRef.trim() : '';
  if (!SUPABASE_PROJECT_REF_RE.test(ref)) return GENERIC_SUPABASE_DASHBOARD_URL;

  const rawUrl = typeof supabaseUrl === 'string' ? supabaseUrl.trim() : '';
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      const hostMatch = SUPABASE_HOST_RE.exec(parsed.hostname.toLowerCase());
      const isSafeSupabaseUrl = parsed.protocol === 'https:'
        && parsed.username === ''
        && parsed.password === ''
        && parsed.port === ''
        && (parsed.pathname === '' || parsed.pathname === '/')
        && parsed.search === ''
        && parsed.hash === ''
        && hostMatch?.[1] === ref;
      if (!isSafeSupabaseUrl) return GENERIC_SUPABASE_DASHBOARD_URL;
    } catch {
      return GENERIC_SUPABASE_DASHBOARD_URL;
    }
  }

  return `https://supabase.com/dashboard/project/${ref}/settings/functions`;
}

const supabaseDashboardUrl = getSupabaseDashboardUrl(
  import.meta.env.VITE_SUPABASE_PROJECT_ID,
  import.meta.env.VITE_SUPABASE_URL,
);

export default function XAutomationSettings({ twitterHydration, xPostingConfig, xRateLimits, xApiControls }: Props) {
  const { isAdmin } = useAuth();
  const { controls: runtimeControls, loading: runtimeLoading, error: runtimeError } = useRuntimeControls();
  const runtimeAllowsXActions = runtimeControls?.environment === 'production' && runtimeControls.posting_mode === 'enabled';
  const canMutate = isAdmin === true && !runtimeLoading && !runtimeError && runtimeAllowsXActions;
  const { data: monthlyCount } = useXMonthlyPostsCount(canMutate);
  const { data: xApiSummary, refetch: refetchXApiSummary, isFetching: xApiSummaryFetching, error: xApiError, dataUpdatedAt: xApiUpdatedAt } = useXApiSummary(24, false, canMutate);
  const { toast } = useToast();
  const saveMutation = useSaveSettings();

  const [statusMap, setStatusMap] = useState<Record<string, boolean> | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; handle?: string; id?: string; error?: string } | null>(null);

  const [tweetText, setTweetText] = useState(DEFAULT_TEST_TWEET);
  const [replyTo, setReplyTo] = useState('');
  const [sendLoading, setSendLoading] = useState(false);
  const [tweetResult, setTweetResult] = useState<{ ok: boolean; tweet_id?: string; error?: string } | null>(null);
  const [lastSendAt, setLastSendAt] = useState<number>(0);

  const [hydrateId, setHydrateId] = useState('');
  const [hydrateLoading, setHydrateLoading] = useState(false);
  const [hydrateResult, setHydrateResult] = useState<{ ok: boolean; text?: string; note_tweet?: string; lang?: string; error?: string } | null>(null);

  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{ ok: boolean; dry_run?: boolean; scanned?: number; matched?: number; queued?: number; skipped_existing?: number; excluded_by_gate?: number; max?: number; hours?: number; error?: string } | null>(null);

  const calls24h = xApiSummary?.counted_attempts;
  const projectedMonthly = xApiSummary?.posts_local == null ? null : xApiSummary.posts_local * 30;
  const configuredMonthlyBudget = xRateLimits?.monthly_post_budget ?? xApiSummary?.configured_budget?.monthly_post_budget ?? 0;
  const overBudget = configuredMonthlyBudget > 0 && projectedMonthly != null && projectedMonthly > configuredMonthlyBudget;
  const tweetCharCount = tweetText.length;
  const tweetTooLong = tweetCharCount > 280;
  const ownedReadsEnabled = xApiControls?.my_x_enabled === true;

  const hydrationBaseline = useMemo(() => ({ enabled: true, max_attempts: 3, ...twitterHydration }), [twitterHydration]);
  const hydrationDraft = useSettingsDraft('x-hydration', 'Tweet hydration', hydrationBaseline);
  const hydrationSave = useSettingsSave(hydrationDraft, async (value) => {
    if (!canMutate) throw new Error('Runtime unavailable');
    await saveMutation.mutateAsync({ key: 'twitter_hydration', value });
  });

  const refreshStatus = useCallback(async () => {
    if (!canMutate) return;
    setStatusLoading(true);
    try {
      const data = await invokeAdminAction<{ status?: Record<string, boolean> }>({ action: 'get_x_status' });
      if (!data?.status || !SECRET_KEYS.every(({ key }) => typeof data.status?.[key] === 'boolean')) throw new Error('Credential status unavailable');
      setStatusMap(data.status);
    } catch (e) {
      setStatusMap(null);
      toast({ title: 'Could not load credential status', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setStatusLoading(false);
    }
  }, [canMutate, toast]);

  useEffect(() => {
    if (canMutate) void refreshStatus();
  }, [canMutate, refreshStatus]);

  const verifyConnection = async () => {
    if (!canMutate) return;
    if (!ownedReadsEnabled) {
      const error = 'Owned-read credential verification is paused to prevent X API user-read charges.';
      setVerifyResult({ ok: false, error });
      toast({ title: 'Owned reads paused', description: error });
      return;
    }
    setVerifyLoading(true);
    setVerifyResult(null);
    try {
      const data = await invokeAdminAction<{ ok: boolean; handle?: string; id?: string; error?: string }>(
        { action: 'x_verify_credentials' },
        { throwOnFailure: false },
      );
      setVerifyResult(data);
      toast({ title: data?.ok ? 'Connection OK' : 'Connection failed', description: data?.handle ? `Authenticated as @${data.handle}` : data?.error, variant: data?.ok ? 'default' : 'destructive' });
    } catch (e) {
      const msg = (e as Error).message;
      setVerifyResult({ ok: false, error: msg });
      toast({ title: 'Verification failed', description: msg, variant: 'destructive' });
    } finally {
      setVerifyLoading(false);
    }
  };

  const sendTestTweet = async () => {
    if (!canMutate) return;
    if (Date.now() - lastSendAt < 60_000) {
      toast({ title: 'Rate limited', description: 'Please wait a minute between test tweets.', variant: 'destructive' });
      return;
    }
    if (tweetTooLong || tweetText.trim().length === 0) {
      toast({ title: 'Invalid tweet', description: 'Tweet must be 1-280 characters.', variant: 'destructive' });
      return;
    }
    setSendLoading(true);
    setTweetResult(null);
    try {
      const data = await invokeAdminAction<{ ok: boolean; tweet_id?: string; response?: unknown; error?: string }>(
        { action: 'send_test_tweet', text: tweetText.trim(), in_reply_to_tweet_id: replyTo.trim() || undefined },
        { throwOnFailure: false },
      );
      setTweetResult(data);
      setLastSendAt(Date.now());
      toast({ title: data?.ok ? 'Tweet posted' : 'Tweet failed', description: data?.tweet_id ? `ID: ${data.tweet_id}` : data?.error, variant: data?.ok ? 'default' : 'destructive' });
    } catch (e) {
      const msg = (e as Error).message;
      setTweetResult({ ok: false, error: msg });
      toast({ title: 'Send failed', description: msg, variant: 'destructive' });
    } finally {
      setSendLoading(false);
    }
  };

  const testHydrate = async () => {
    if (!canMutate) return;
    if (!hydrateId.trim()) {
      toast({ title: 'Tweet ID required', variant: 'destructive' });
      return;
    }
    setHydrateLoading(true);
    setHydrateResult(null);
    try {
      const data = await invokeAdminAction<{ ok: boolean; text?: string; note_tweet?: string; lang?: string; raw?: unknown; error?: string }>(
        { action: 'test_hydrate_tweet', tweet_id: hydrateId.trim() },
        { throwOnFailure: false },
      );
      setHydrateResult(data);
      toast({ title: data?.ok ? 'Hydration OK' : 'Hydration failed', description: data?.note_tweet ? 'note_tweet field returned' : data?.error });
    } catch (e) {
      const msg = (e as Error).message;
      setHydrateResult({ ok: false, error: msg });
      toast({ title: 'Hydration test failed', description: msg, variant: 'destructive' });
    } finally {
      setHydrateLoading(false);
    }
  };

  const runBackfill = async (dryRun: boolean) => {
    if (!canMutate) return;
    setBackfillLoading(true);
    setBackfillResult(null);
    try {
      const data = await invokeAdminAction<{ ok: boolean; dry_run?: boolean; scanned?: number; matched?: number; queued?: number; skipped_existing?: number; excluded_by_gate?: number; max?: number; hours?: number; error?: string }>(
        { action: 'rehydrate_recent_truncated', hours: 24, dry_run: dryRun, force: false },
        { throwOnFailure: false },
      );
      setBackfillResult(data);
      toast({
        title: data?.ok ? (dryRun ? 'Backfill estimate ready' : 'Backfill queued') : 'Backfill failed',
        description: data?.ok
          ? `Scanned ${data.scanned}, matched ${data.matched}, ${dryRun ? 'would queue' : 'queued'} ${data.queued}.`
          : data?.error,
        variant: data?.ok ? 'default' : 'destructive',
      });
    } catch (e) {
      const msg = (e as Error).message;
      setBackfillResult({ ok: false, error: msg });
      toast({ title: 'Backfill failed', description: msg, variant: 'destructive' });
    } finally {
      setBackfillLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Credentials */}
      <Card id="x-credentials" className="glass-card scroll-mt-48">
        <CardHeader>
          <CardTitle className="flex items-center text-glass-foreground"><Key className="w-5 h-5 mr-2" />Credentials &amp; Connection</CardTitle>
          <CardDescription>X API credentials are stored as Supabase Edge Function secrets. Manage them in your Supabase dashboard.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SECRET_KEYS.map(({ key, label }) => {
              const present = statusMap?.[key];
              return (
                <div key={key} className="flex min-w-0 flex-wrap items-center justify-between gap-2 p-3 bg-muted/40 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-glass-foreground">{label}</p>
                    <code className="break-all text-xs text-muted-foreground">{key}</code>
                  </div>
                  {statusLoading ? (
                    <span role="status"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /><span className="sr-only">Loading credential status</span></span>
                  ) : statusMap === null ? <Badge variant="outline">Unavailable</Badge> : present ? (
                    <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20"><CheckCircle2 className="w-3 h-3 mr-1" />Configured</Badge>
                  ) : (
                    <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Missing</Badge>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ConfirmSettingsAction title="Verify the configured X account?" description="This calls an X user-read endpoint for the account configured on the server and may incur provider charges. The runtime and owned-read gates still apply." confirmLabel="Verify account" onConfirm={verifyConnection} disabled={!canMutate}>
            <Button disabled={!canMutate || verifyLoading || !ownedReadsEnabled} variant="outline" className="border-primary/50 hover:bg-primary/10">
              {verifyLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verifying...</> : <><Shield className="w-4 h-4 mr-2" />Verify connection</>}
            </Button>
            </ConfirmSettingsAction>
            <Button onClick={() => { if (canMutate) void refetchXApiSummary(); }} disabled={!canMutate || xApiSummaryFetching} variant="outline" size="sm">
              {xApiSummaryFetching ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
              Refresh usage
            </Button>
            <Button onClick={refreshStatus} disabled={!canMutate || statusLoading} variant="ghost" size="sm">Refresh status</Button>
            <a href={supabaseDashboardUrl} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center hover:underline">
              Manage secrets <ExternalLink className="w-3 h-3 ml-1" />
            </a>
          </div>
          {!ownedReadsEnabled && (
            <p className="text-xs text-muted-foreground">
              Verification is paused because it calls X user-read endpoints. Tweet posting and tweet hydration stay available.
            </p>
          )}

          {verifyResult && (
            <div className={`rounded-lg border p-3 text-sm ${verifyResult.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-destructive/30 bg-destructive/5'}`}>
              {verifyResult.ok ? (
                <div className="flex items-center gap-2"><AtSign className="w-4 h-4 text-emerald-300" /><span className="font-medium">Authenticated as @{verifyResult.handle}</span><span className="text-muted-foreground">(id: {verifyResult.id})</span></div>
              ) : (
                <div className="flex items-start gap-2"><XCircle className="w-4 h-4 text-destructive mt-0.5" /><span>{verifyResult.error || 'Unknown error'}</span></div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. Tweet Hydration */}
      <Card id="x-hydration" className="glass-card scroll-mt-48">
        <CardHeader>
          <CardTitle className="flex items-center text-glass-foreground"><Sparkles className="w-5 h-5 mr-2" />Tweet Hydration &amp; API Usage</CardTitle>
          <CardDescription>When RSS delivers a truncated tweet, fetch the full text from the X API v2 before translation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div>
              <Label htmlFor="hydration_enabled" className="font-medium">Hydrate truncated tweets</Label>
              <p className="text-xs text-muted-foreground mt-1">When off, truncated tweets will be translated as-is.</p>
            </div>
            <Checkbox aria-label="Hydrate truncated tweets"
              id="hydration_enabled"
              checked={hydrationDraft.draft.enabled}
              disabled={!canMutate || saveMutation.isPending}
              onCheckedChange={(checked) => {
                if (!canMutate) return;
                hydrationDraft.updateDraft({ ...hydrationDraft.draft, enabled: checked === true });
              }}
            />
          </div>

          <SettingsSaveStatus label="Tweet hydration" dirty={hydrationDraft.isDirty} {...hydrationSave} onSave={() => { void hydrationSave.save(); }} disabled={!canMutate || hydrationDraft.hasPendingIncoming} />
          <SettingsIncomingNotice editor={hydrationDraft} />
          <p className="text-xs text-muted-foreground">Local ledger only. Last successful refresh: {xApiUpdatedAt ? new Date(xApiUpdatedAt).toLocaleString() : 'unavailable'}.</p>
          {xApiError && <p role="status" className="text-sm text-amber-200">Usage refresh failed. Any displayed values are from the last successful snapshot.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-xs text-muted-foreground">Local attempts (24h)</p>
              <p className="text-2xl font-bold text-glass-foreground">{calls24h ?? 'Unavailable'}</p>
            </div>
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-xs text-muted-foreground">Local posts (24h)</p>
              <p className="text-2xl font-bold text-glass-foreground">{xApiSummary?.posts_local ?? 'Unavailable'}</p>
              {xApiSummary?.latest_event_at && <p className="text-xs text-muted-foreground mt-1">Last: {new Date(xApiSummary.latest_event_at).toLocaleString()}</p>}
            </div>
            <div className={`p-3 rounded-lg ${overBudget ? 'bg-destructive/10 border border-destructive/30' : 'bg-muted/30'}`}>
              <p className="text-xs text-muted-foreground">Estimated posts / next 30 days</p>
              <p className={`text-2xl font-bold ${overBudget ? 'text-destructive' : 'text-glass-foreground'}`}>{projectedMonthly?.toLocaleString() ?? 'Unavailable'}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Projection: last 24h local posts × 30. Post budget: {configuredMonthlyBudget ? configuredMonthlyBudget.toLocaleString() : 'not set'}
              </p>
            </div>
          </div>

          {overBudget && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <AlertTriangle className="w-4 h-4 text-destructive mt-0.5" />
              <span>Projected local usage exceeds the configured budget. Check the official project cap in X Developer Console before increasing automation.</span>
            </div>
          )}

          {xApiSummary?.latest_error && <div role="status" className="rounded-md border border-destructive/40 p-3 text-sm"><p className="font-medium">{xErrorExplanation(String(xApiSummary.latest_error))}</p><p className="mt-1 text-muted-foreground">Review the request in Monitoring and check the configured app permissions. Refresh the local status after resolving the cause.</p><details className="mt-2 text-xs"><summary className="cursor-pointer">Diagnostic code</summary><code className="break-all">{String(xApiSummary.latest_error)}</code></details></div>}

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-medium text-glass-foreground">Re-hydrate recent truncated tweets</p>
                <p className="text-xs text-muted-foreground">Scans posts from the last 24h and only queues hydration for score-passing posts marked for delivery. Skipped, duplicate, and below-threshold posts stay untouched.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => runBackfill(true)} disabled={!canMutate || backfillLoading} variant="outline" className="border-primary/50 hover:bg-primary/10">
                  {backfillLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  Estimate
                </Button>
                <ConfirmSettingsAction title="Queue recent hydration jobs?" description="This queues eligible truncated posts from the last 24 hours for X API hydration. Jobs may consume paid X reads. Run Estimate first to inspect the affected count; existing jobs and score gates are preserved." confirmLabel="Queue hydration jobs" onConfirm={() => runBackfill(false)} disabled={!canMutate}>
            <Button disabled={!canMutate || backfillLoading} variant="outline">
                  Queue backfill
                </Button>
            </ConfirmSettingsAction>
              </div>
            </div>
            {backfillResult && (
              <div className={`rounded-lg border p-3 text-xs ${backfillResult.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-destructive/30 bg-destructive/5'}`}>
                {backfillResult.ok ? (
                  <span>
                    Scanned <strong>{backfillResult.scanned}</strong> · matched <strong>{backfillResult.matched}</strong> · {backfillResult.dry_run ? 'would queue' : 'queued'} <strong>{backfillResult.queued}</strong> hydrate jobs.
                    {typeof backfillResult.excluded_by_gate === 'number' ? <> Excluded by score/decision gate: <strong>{backfillResult.excluded_by_gate}</strong>.</> : null}
                    {backfillResult.skipped_existing ? <> Existing pending: <strong>{backfillResult.skipped_existing}</strong>.</> : null}
                  </span>
                ) : (
                  <span className="text-destructive">{backfillResult.error || 'Unknown error'}</span>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 3. Test Tweet */}
      <Card id="x-tests" className="glass-card scroll-mt-48">
        <CardHeader>
          <CardTitle className="flex items-center text-glass-foreground"><Send className="w-5 h-5 mr-2" />Test Tweet Console</CardTitle>
          <CardDescription>Send a real tweet to your authenticated X account to verify posting works end-to-end.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="test_tweet_text">Tweet text</Label>
              <span className={`text-xs ${tweetTooLong ? 'text-destructive' : 'text-muted-foreground'}`}>{tweetCharCount}/280</span>
            </div>
            <Textarea id="test_tweet_text" value={tweetText} onChange={(e) => setTweetText(e.target.value)} className="glass-input min-h-[100px]" placeholder="What's happening?" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reply_to">Reply to tweet ID (optional)</Label>
            <Input aria-label="Reply to tweet ID (optional)" id="reply_to" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="e.g. 1234567890" className="glass-input" />
            <p className="text-xs text-muted-foreground">A reply is still public and uses the configured X account. Enter an existing numeric tweet ID.</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={!canMutate || sendLoading || tweetTooLong || tweetText.trim().length === 0} >
                  {sendLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Posting...</> : <><Send className="w-4 h-4 mr-2" />Send test tweet</>}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Post this test tweet?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div>
                      <span>This will post the following to your authenticated X account:</span>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Posting as: {verifyResult?.handle ? `@${verifyResult.handle}` : 'configured X account (identity has not been verified in this session)'}. This creates a public post and consumes the account’s X write quota.
                      </p>
                      <div className="mt-2 p-3 bg-muted rounded text-sm whitespace-pre-wrap text-foreground">{tweetText}</div>
                      {replyTo && <p className="mt-2 text-xs">As a reply to tweet ID: <code>{replyTo}</code></p>}
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={sendTestTweet} disabled={!canMutate}>Post tweet</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {tweetResult && (
            <div className={`rounded-lg border p-3 text-sm space-y-2 ${tweetResult.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-destructive/30 bg-destructive/5'}`}>
              {tweetResult.ok ? (
                <>
                  <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-300" /><span className="font-medium">Tweet posted</span></div>
                  {tweetResult.tweet_id && (
                    <a href={`https://x.com/i/status/${tweetResult.tweet_id}`} target="_blank" rel="noreferrer" className="text-primary text-xs inline-flex items-center hover:underline">
                      View on X <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  )}
                </>
              ) : (
                <div className="flex items-start gap-2"><XCircle className="w-4 h-4 text-destructive mt-0.5" /><span>{tweetResult.error || 'Unknown error'}</span></div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4. Hydration Test */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center text-glass-foreground"><Sparkles className="w-5 h-5 mr-2" />Hydration Test</CardTitle>
          <CardDescription>Fetch a tweet's full <code>note_tweet</code> text via the X API without writing to the database.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hydrate_id">Tweet ID</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input aria-label="Tweet ID" id="hydrate_id" value={hydrateId} onChange={(e) => setHydrateId(e.target.value)} placeholder="e.g. 1234567890123456789" className="glass-input" />
              <ConfirmSettingsAction title="Fetch this tweet from X?" description="This makes an X API read for the entered tweet ID. It can incur provider charges and uses API quota; it does not publish a tweet or update the post database." confirmLabel="Fetch tweet" onConfirm={testHydrate} disabled={!canMutate}>
            <Button disabled={!canMutate || hydrateLoading} variant="outline" className="border-primary/50 hover:bg-primary/10 shrink-0">
                {hydrateLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Testing...</> : 'Test hydrate'}
              </Button>
            </ConfirmSettingsAction>
            </div>
          </div>

          {hydrateResult && (
            <div className={`rounded-lg border p-3 text-sm space-y-2 ${hydrateResult.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-destructive/30 bg-destructive/5'}`}>
              {hydrateResult.ok ? (
                <>
                  <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-300" /><span className="font-medium">Fetched successfully</span>{hydrateResult.lang && <Badge variant="outline" className="text-xs">{hydrateResult.lang}</Badge>}</div>
                  {hydrateResult.note_tweet && (
                    <div>
                      <Label className="text-xs">note_tweet (full text)</Label>
                      <div className="p-2 bg-background rounded border text-sm whitespace-pre-wrap mt-1">{hydrateResult.note_tweet}</div>
                    </div>
                  )}
                  {hydrateResult.text && (
                    <div>
                      <Label className="text-xs">text (truncated field)</Label>
                      <div className="p-2 bg-background rounded border text-sm whitespace-pre-wrap mt-1">{hydrateResult.text}</div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-start gap-2"><XCircle className="w-4 h-4 text-destructive mt-0.5" /><span>{hydrateResult.error || 'Unknown error'}</span></div>
              )}
            </div>
          )}
          <Separator />
          <p className="text-xs text-muted-foreground">Networked verification, hydration, media upload, and post attempts are recorded in the X API event ledger. Missing credentials are not counted as X API calls.</p>
        </CardContent>
      </Card>

      {/* 5. X Posting Configuration */}
      <XPostingConfig initial={xPostingConfig} isAdmin={canMutate} />

      {/* 6. Rate Limits & Quotas */}
      <XRateLimits
        initial={xRateLimits}
        monthlyPostsCount={monthlyCount}
        enabled={canMutate}
      />
    </div>
  );
}

function xErrorExplanation(code: string): string {
  if (/403|forbidden/i.test(code)) return 'X denied a request. The app or account may lack permission for this operation.';
  if (/401|unauthorized/i.test(code)) return 'X could not authenticate the request. Review the configured credentials.';
  if (/429|rate.limit|quota/i.test(code)) return 'X rejected a request because a rate or usage limit was reached.';
  if (/timeout|network/i.test(code)) return 'The X request did not complete. Inspect its recorded outcome before retrying a post.';
  return 'A recent X request failed. Its diagnostic code is available below.';
}
