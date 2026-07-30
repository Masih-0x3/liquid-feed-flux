import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { requireInternalAuth } from "../_shared/internalAuth.ts";
import { recordXApiEvent } from "../_shared/xApiLedger.ts";
import { isMyXEnabled, MY_X_DISABLED_RESPONSE } from "../_shared/myXControls.ts";
import { captureEdgeException, initSentryEdge } from "../_shared/sentry.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_CORS_ORIGIN') ?? 'https://liquid-feed-flux.lovable.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-token',
};
initSentryEdge();

// ─── X API OAuth 1.0a helpers ──────────────
const ENC = new TextEncoder();
function pe(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
async function hmacSha1(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', ENC.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, ENC.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
async function oauthHeader(method: string, baseUrl: string, queryParams: Record<string, string>, ck: string, cs: string, at: string, ats: string): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: ck,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: at,
    oauth_version: '1.0',
  };
  const all = { ...oauth, ...queryParams };
  const ps = Object.keys(all).sort().map((k) => `${pe(k)}=${pe(all[k])}`).join('&');
  const base = `${method.toUpperCase()}&${pe(baseUrl)}&${pe(ps)}`;
  const sk = `${pe(cs)}&${pe(ats)}`;
  oauth.oauth_signature = await hmacSha1(sk, base);
  return `OAuth ${Object.keys(oauth).sort().map((k) => `${pe(k)}="${pe(oauth[k])}"`).join(', ')}`;
}

function getCreds() {
  const ck = Deno.env.get('TWITTER_CONSUMER_KEY');
  const cs = Deno.env.get('TWITTER_CONSUMER_SECRET');
  const at = Deno.env.get('TWITTER_ACCESS_TOKEN');
  const ats = Deno.env.get('TWITTER_ACCESS_TOKEN_SECRET');
  if (!ck || !cs || !at || !ats) return null;
  return { ck, cs, at, ats };
}

const FOLLOWER_ERROR_CODE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+){1,10}$/;

function safeFollowerErrorCode(error: unknown, fallback = 'x_followers_snapshot_failed'): string {
  const message = error instanceof Error
    ? error.message.trim()
    : typeof error === 'string'
    ? error.trim()
    : '';
  return message.length >= 3 && message.length <= 96 && FOLLOWER_ERROR_CODE.test(message)
    ? message
    : fallback;
}

function followerHttpErrorCode(operation: string, status: unknown): string {
  const numericStatus = typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : null;
  return numericStatus === null ? `${operation}_request_failed` : `${operation}_http_${numericStatus}`;
}

type FollowerQueryResult = {
  data?: unknown;
  error?: unknown;
};

type FollowerQueryBuilder = PromiseLike<FollowerQueryResult> & {
  select(columns: string): FollowerQueryBuilder;
  eq(column: string, value: unknown): FollowerQueryBuilder;
  maybeSingle(): PromiseLike<FollowerQueryResult>;
  upsert(value: Record<string, unknown>, options?: Record<string, unknown>): PromiseLike<FollowerQueryResult>;
};

type FollowerSupabaseClient = {
  from(table: string): FollowerQueryBuilder;
};

function asFollowerRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function getSelfId(supabase: FollowerSupabaseClient, creds: { ck: string; cs: string; at: string; ats: string }): Promise<string> {
  const { data: setting, error: settingError } = await supabase.from('settings').select('value').eq('key', 'x_self_id').maybeSingle();
  if (settingError) throw new Error('x_self_id_read_failed');
  const cached = asFollowerRecord(asFollowerRecord(setting).value).id;
  if (typeof cached === 'string' && cached.length > 0) return cached;

  const url = 'https://api.x.com/2/users/me';
  const auth = await oauthHeader('GET', url, {}, creds.ck, creds.cs, creds.at, creds.ats);
  const resp = await fetch(url, { headers: { Authorization: auth } });
  const text = await resp.text();
  await recordXApiEvent(supabase, {
    source: 'x-followers-snapshot',
    sourceAction: 'users_me',
    endpoint: url,
    method: 'GET',
  }, resp);
  if (!resp.ok) throw new Error(followerHttpErrorCode('x_followers_users_me', resp.status));
  const parsed = JSON.parse(text) as { data?: { id?: string; username?: string; name?: string } };
  const id = parsed.data?.id;
  if (!id) throw new Error('users/me returned no id');

  const { error: selfIdCacheError } = await supabase.from('settings').upsert(
    { key: 'x_self_id', value: { id, username: parsed.data?.username, name: parsed.data?.name, cached_at: new Date().toISOString() }, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (selfIdCacheError) throw new Error('x_self_id_cache_write_failed');
  return id;
}

interface FollowerUser { id: string; username?: string; name?: string; profile_image_url?: string }

function isFollowerUser(value: unknown): value is FollowerUser {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as { id?: unknown }).id === 'string' &&
      (value as { id: string }).id.trim().length > 0,
  );
}

function myXDisabledResponse() {
  return new Response(JSON.stringify(MY_X_DISABLED_RESPONSE), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function fetchUserPage(supabase: unknown, userId: string, endpoint: 'followers' | 'following', paginationToken: string | null, creds: { ck: string; cs: string; at: string; ats: string }): Promise<{ users: FollowerUser[]; nextToken: string | null; status: number; errorText?: string }> {
  const baseUrl = `https://api.x.com/2/users/${userId}/${endpoint}`;
  const qp: Record<string, string> = {
    'max_results': '1000',
    'user.fields': 'username,name,profile_image_url',
  };
  if (paginationToken) qp['pagination_token'] = paginationToken;

  const auth = await oauthHeader('GET', baseUrl, qp, creds.ck, creds.cs, creds.at, creds.ats);
  const url = `${baseUrl}?${Object.entries(qp).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`;
  const resp = await fetch(url, { headers: { Authorization: auth } });
  const text = await resp.text();
  await recordXApiEvent(supabase, {
    source: 'x-followers-snapshot',
    sourceAction: `fetch_${endpoint}`,
    endpoint: baseUrl,
    method: 'GET',
    userId,
    error: resp.ok ? null : `${endpoint} HTTP ${resp.status}`,
  }, resp);
  if (!resp.ok) return { users: [], nextToken: null, status: resp.status, errorText: followerHttpErrorCode(`x_followers_${endpoint}`, resp.status) };

  const parsed = JSON.parse(text) as { data?: FollowerUser[]; meta?: { next_token?: string } };
  if (!Array.isArray(parsed.data) || !parsed.data.every(isFollowerUser)) {
    throw new Error(`${endpoint}_response_invalid_data`);
  }
  const nextToken = parsed.meta?.next_token;
  if (nextToken !== undefined && nextToken !== null && typeof nextToken !== 'string') {
    throw new Error(`${endpoint}_response_invalid_pagination`);
  }
  return { users: parsed.data, nextToken: nextToken ?? null, status: resp.status };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const authErr = await requireInternalAuth(req, corsHeaders);
  if (authErr) return authErr;

  const supabase = createClient<any, any>(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  let body: { trigger?: string; force?: boolean; dry_run?: boolean; include_following?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body OK for cron */ }
  const trigger = body.trigger === 'manual' ? 'manual' : 'cron';
  const force = body.force === true;
  const dryRun = body.dry_run === true;
  const includeFollowing = body.include_following !== false;

  try {
    const { data: controlsRow, error: controlsError } = await supabase.from('settings').select('value').eq('key', 'x_api_controls').maybeSingle();
    if (controlsError) throw new Error('x_api_controls_read_failed');
    const controls = (controlsRow?.value ?? {}) as Record<string, unknown>;
    if (!isMyXEnabled(controls)) return myXDisabledResponse();

    const staleMinutes = typeof controls.follower_snapshot_stale_minutes === 'number'
      ? controls.follower_snapshot_stale_minutes
      : 60;

    const { data: latestSnap, error: latestSnapshotError } = await supabase
      .from('x_follower_snapshots')
      .select('id, taken_at, status, follower_count, following_count, api_calls_used')
      .order('taken_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestSnapshotError) throw new Error('follower_snapshot_latest_read_failed');

    const latestAgeMs = latestSnap?.taken_at ? Date.now() - new Date(latestSnap.taken_at as string).getTime() : null;
    const latestIsFresh = latestAgeMs !== null && latestAgeMs < staleMinutes * 60 * 1000;
    const followerCountEstimate = Number(latestSnap?.follower_count ?? 0);
    const followingCountEstimate = Number(latestSnap?.following_count ?? 0);
    const estimatedCalls = Math.max(1, Math.ceil(Math.max(1, followerCountEstimate) / 1000))
      + (includeFollowing ? Math.max(1, Math.ceil(Math.max(1, followingCountEstimate) / 1000)) : 0);

    if (dryRun) {
      return new Response(JSON.stringify({
        ok: true,
        dry_run: true,
        trigger,
        include_following: includeFollowing,
        estimated_api_calls: estimatedCalls,
        latest_snapshot: latestSnap ?? null,
        latest_age_minutes: latestAgeMs === null ? null : Math.round(latestAgeMs / 60000),
        stale_minutes: staleMinutes,
        would_skip_without_force: trigger === 'manual' && latestIsFresh && !force,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (trigger === 'manual' && latestIsFresh && !force) {
      return new Response(JSON.stringify({
        ok: true,
        skipped: true,
        reason: 'snapshot_recent',
        latest_snapshot: latestSnap,
        latest_age_minutes: Math.round((latestAgeMs ?? 0) / 60000),
        stale_minutes: staleMinutes,
        estimated_api_calls: estimatedCalls,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Daily-cap guard for cron only
    if (trigger === 'cron') {
      const { data: recent, error: recentSnapshotError } = await supabase
        .from('x_follower_snapshots')
        .select('id, taken_at, status')
        .gte('taken_at', new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString())
        .order('taken_at', { ascending: false })
        .limit(1);
      if (recentSnapshotError) throw new Error('follower_snapshot_daily_cap_read_failed');
      if (!Array.isArray(recent)) throw new Error('follower_snapshot_daily_cap_result_invalid');
      if (recent && recent.length > 0) {
        return new Response(JSON.stringify({ skipped: true, reason: 'daily_cap', last_snapshot: recent[0] }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const creds = getCreds();
    if (!creds) {
      return new Response(JSON.stringify({ error: 'twitter_credentials_missing' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const selfId = await getSelfId(supabase, creds);

    // Create snapshot row
    const { data: snapRow, error: snapErr } = await supabase
      .from('x_follower_snapshots')
      .insert({ trigger, status: 'partial', follower_count: 0, follower_ids: [], following_ids: [], following_count: 0, pages_fetched: 0, api_calls_used: 0 })
      .select()
      .single();
    if (snapErr || !snapRow) throw new Error('follower_snapshot_insert_failed');
    const snapshotId = snapRow.id as string;

    const allIds: string[] = [];
    const allUsers: FollowerUser[] = [];
    let pageToken: string | null = null;
    let pages = 0;
    let apiCalls = 0;
    let halted: { reason: string; status?: number; error?: string } | null = null;

    // Page through followers. Cap at 100 pages (100k followers) as safety.
    while (pages < 100) {
      const { users, nextToken, status, errorText } = await fetchUserPage(supabase, selfId, 'followers', pageToken, creds);
      apiCalls += 1;

      if (status === 429) { halted = { reason: 'rate_limited', status, error: errorText }; break; }
      if (status !== 200) { halted = { reason: 'api_error', status, error: errorText }; break; }

      pages += 1;
      for (const u of users) {
        allIds.push(u.id);
        allUsers.push(u);
      }

      if (!nextToken) { pageToken = null; break; }
      pageToken = nextToken;
    }

    // Fetch following list (people I follow)
    const followingIds: string[] = [];
    const followingUsers: FollowerUser[] = [];
    let followingToken: string | null = null;
    let followingPages = 0;

    if (!halted && includeFollowing) {
      while (followingPages < 100) {
        const { users, nextToken, status, errorText } = await fetchUserPage(supabase, selfId, 'following', followingToken, creds);
        apiCalls += 1;

        if (status === 429) { halted = { reason: 'rate_limited_following', status, error: errorText }; break; }
        if (status !== 200) { halted = { reason: 'following_api_error', status, error: errorText }; break; }

        followingPages += 1;
        for (const u of users) {
          followingIds.push(u.id);
          followingUsers.push(u);
        }

        if (!nextToken) break;
        followingToken = nextToken;
      }
    }

    // Upsert profile cache (both followers and following)
    const combinedUsers = [...allUsers, ...followingUsers];
    if (combinedUsers.length > 0) {
      const nowIso = new Date().toISOString();
      const seen = new Set<string>();
      const rows = combinedUsers.filter(u => { if (seen.has(u.id)) return false; seen.add(u.id); return true; }).map((u) => ({
        user_id: u.id,
        username: u.username ?? null,
        name: u.name ?? null,
        profile_image_url: u.profile_image_url ?? null,
        last_seen_at: nowIso,
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const { error: cacheUpsertError } = await supabase
          .from('x_followers_cache')
          .upsert(chunk, { onConflict: 'user_id' });
        if (cacheUpsertError) throw new Error('followers_cache_upsert_failed');
      }
    }

    if (halted) {
      const { error: partialSnapshotError } = await supabase.from('x_follower_snapshots').update({
        status: 'partial',
        follower_count: allIds.length,
        follower_ids: allIds,
        following_ids: followingIds,
        following_count: followingIds.length,
        pages_fetched: pages + followingPages,
        api_calls_used: apiCalls,
        next_token: pageToken ?? followingToken,
        error: safeFollowerErrorCode(halted.reason, 'follower_snapshot_partial'),
      }).eq('id', snapshotId);
      if (partialSnapshotError) throw new Error('follower_snapshot_partial_update_failed');

      return new Response(JSON.stringify({
        snapshot_id: snapshotId, status: 'partial', halted: halted.reason, follower_count: allIds.length,
        following_count: followingIds.length, pages_fetched: pages + followingPages, api_calls_used: apiCalls,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Mark complete
    const { error: completeSnapshotError } = await supabase.from('x_follower_snapshots').update({
      status: 'complete',
      follower_count: allIds.length,
      follower_ids: allIds,
      following_ids: followingIds,
      following_count: followingIds.length,
      pages_fetched: pages + followingPages,
      api_calls_used: apiCalls,
      next_token: null,
    }).eq('id', snapshotId);
    if (completeSnapshotError) throw new Error('follower_snapshot_complete_update_failed');

    // Diff against previous COMPLETE snapshot (excluding this one)
    const { data: prevSnap, error: prevSnapshotError } = await supabase
      .from('x_follower_snapshots')
      .select('id, follower_ids')
      .eq('status', 'complete')
      .neq('id', snapshotId)
      .order('taken_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prevSnapshotError) throw new Error('follower_snapshot_baseline_read_failed');

    let unfollowedCount = 0;
    let followedCount = 0;

    if (prevSnap && Array.isArray(prevSnap.follower_ids)) {
      const prevSet = new Set<string>(prevSnap.follower_ids as string[]);
      const currSet = new Set<string>(allIds);
      const unfollowed = [...prevSet].filter((x) => !currSet.has(x));
      const followed = [...currSet].filter((x) => !prevSet.has(x));

      // Lookup profile metadata for change rows from cache
      const lookupIds = [...new Set([...unfollowed, ...followed])];
      const profileMap = new Map<string, { username?: string; name?: string; profile_image_url?: string }>();
      for (let i = 0; i < lookupIds.length; i += 500) {
        const chunk = lookupIds.slice(i, i + 500);
        const { data: profs } = await supabase
          .from('x_followers_cache')
          .select('user_id, username, name, profile_image_url')
          .in('user_id', chunk);
        (profs ?? []).forEach((p) => profileMap.set(p.user_id as string, {
          username: p.username as string | undefined,
          name: p.name as string | undefined,
          profile_image_url: p.profile_image_url as string | undefined,
        }));
      }

      const changeRows = [
        ...unfollowed.map((uid) => ({
          user_id: uid,
          username: profileMap.get(uid)?.username ?? null,
          name: profileMap.get(uid)?.name ?? null,
          profile_image_url: profileMap.get(uid)?.profile_image_url ?? null,
          change_type: 'unfollowed',
          prev_snapshot_id: prevSnap.id as string,
          curr_snapshot_id: snapshotId,
        })),
        ...followed.map((uid) => ({
          user_id: uid,
          username: profileMap.get(uid)?.username ?? null,
          name: profileMap.get(uid)?.name ?? null,
          profile_image_url: profileMap.get(uid)?.profile_image_url ?? null,
          change_type: 'followed',
          prev_snapshot_id: prevSnap.id as string,
          curr_snapshot_id: snapshotId,
        })),
      ];

      if (changeRows.length > 0) {
        for (let i = 0; i < changeRows.length; i += 500) {
          const { error: changesInsertError } = await supabase
            .from('x_follower_changes')
            .insert(changeRows.slice(i, i + 500));
          if (changesInsertError) throw new Error('follower_changes_insert_failed');
        }
      }
      unfollowedCount = unfollowed.length;
      followedCount = followed.length;
    }

    return new Response(JSON.stringify({
      snapshot_id: snapshotId,
      status: 'complete',
      trigger,
      include_following: includeFollowing,
      follower_count: allIds.length,
      following_count: followingIds.length,
      pages_fetched: pages + followingPages,
      api_calls_used: apiCalls,
      unfollowed: unfollowedCount,
      followed: followedCount,
      baseline: !prevSnap,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (e) {
    const errorCode = safeFollowerErrorCode(e);
    const safeError = new Error(errorCode);
    console.error('x-followers-snapshot error', errorCode);
    await captureEdgeException(safeError, {
      functionName: "x-followers-snapshot",
      action: "error",
      request: req,
    });
    return new Response(JSON.stringify({ error: errorCode }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
