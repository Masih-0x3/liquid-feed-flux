import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

async function recordApiCall(supabase: ReturnType<typeof createClient>, error?: string) {
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', 'x_api_usage').maybeSingle();
    const cur = (data?.value as { total?: number; calls_24h?: string[] } | null) ?? { total: 0, calls_24h: [] };
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const trimmed = (cur.calls_24h ?? []).filter((ts) => { try { return new Date(ts).getTime() > cutoff; } catch { return false; } });
    trimmed.push(new Date().toISOString());
    await supabase.from('settings').upsert(
      { key: 'x_api_usage', value: { total: (cur.total ?? 0) + 1, calls_24h: trimmed, last_call_at: new Date().toISOString(), last_error: error ?? null }, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
  } catch (e) { console.error('recordApiCall failed', e); }
}

async function getSelfId(supabase: ReturnType<typeof createClient>, creds: { ck: string; cs: string; at: string; ats: string }): Promise<string> {
  const { data: setting } = await supabase.from('settings').select('value').eq('key', 'x_self_id').maybeSingle();
  const cached = (setting?.value as { id?: string } | null)?.id;
  if (cached) return cached;

  const url = 'https://api.x.com/2/users/me';
  const auth = await oauthHeader('GET', url, {}, creds.ck, creds.cs, creds.at, creds.ats);
  const resp = await fetch(url, { headers: { Authorization: auth } });
  const text = await resp.text();
  await recordApiCall(supabase, resp.ok ? undefined : `users/me HTTP ${resp.status}`);
  if (!resp.ok) throw new Error(`users/me failed: HTTP ${resp.status}: ${text.slice(0, 300)}`);
  const parsed = JSON.parse(text) as { data?: { id?: string; username?: string; name?: string } };
  const id = parsed.data?.id;
  if (!id) throw new Error('users/me returned no id');

  await supabase.from('settings').upsert(
    { key: 'x_self_id', value: { id, username: parsed.data?.username, name: parsed.data?.name, cached_at: new Date().toISOString() }, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  return id;
}

interface FollowerUser { id: string; username?: string; name?: string; profile_image_url?: string }

async function fetchFollowerPage(userId: string, paginationToken: string | null, creds: { ck: string; cs: string; at: string; ats: string }): Promise<{ users: FollowerUser[]; nextToken: string | null; status: number; errorText?: string }> {
  const baseUrl = `https://api.x.com/2/users/${userId}/followers`;
  const qp: Record<string, string> = {
    'max_results': '1000',
    'user.fields': 'username,name,profile_image_url',
  };
  if (paginationToken) qp['pagination_token'] = paginationToken;

  const auth = await oauthHeader('GET', baseUrl, qp, creds.ck, creds.cs, creds.at, creds.ats);
  const url = `${baseUrl}?${Object.entries(qp).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`;
  const resp = await fetch(url, { headers: { Authorization: auth } });
  const text = await resp.text();
  if (!resp.ok) return { users: [], nextToken: null, status: resp.status, errorText: text.slice(0, 500) };

  const parsed = JSON.parse(text) as { data?: FollowerUser[]; meta?: { next_token?: string } };
  return { users: parsed.data ?? [], nextToken: parsed.meta?.next_token ?? null, status: resp.status };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  let body: { trigger?: string } = {};
  try { body = await req.json(); } catch { /* empty body OK for cron */ }
  const trigger = body.trigger === 'manual' ? 'manual' : 'cron';

  try {
    // Daily-cap guard for cron only
    if (trigger === 'cron') {
      const { data: recent } = await supabase
        .from('x_follower_snapshots')
        .select('id, taken_at, status')
        .gte('taken_at', new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString())
        .order('taken_at', { ascending: false })
        .limit(1);
      if (recent && recent.length > 0) {
        return new Response(JSON.stringify({ skipped: true, reason: 'daily_cap', last_snapshot: recent[0] }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const creds = getCreds();
    if (!creds) {
      return new Response(JSON.stringify({ error: 'TWITTER_* secrets missing' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const selfId = await getSelfId(supabase, creds);

    // Create snapshot row
    const { data: snapRow, error: snapErr } = await supabase
      .from('x_follower_snapshots')
      .insert({ trigger, status: 'partial', follower_count: 0, follower_ids: [], pages_fetched: 0, api_calls_used: 0 })
      .select()
      .single();
    if (snapErr || !snapRow) throw new Error(`snapshot insert failed: ${snapErr?.message}`);
    const snapshotId = snapRow.id as string;

    const allIds: string[] = [];
    const allUsers: FollowerUser[] = [];
    let pageToken: string | null = null;
    let pages = 0;
    let apiCalls = 0;
    let halted: { reason: string; status?: number; error?: string } | null = null;

    // Page through followers. Cap at 100 pages (100k followers) as safety.
    while (pages < 100) {
      const { users, nextToken, status, errorText } = await fetchFollowerPage(selfId, pageToken, creds);
      apiCalls += 1;
      await recordApiCall(supabase, status === 200 ? undefined : `followers HTTP ${status}`);

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

    // Upsert profile cache
    if (allUsers.length > 0) {
      const nowIso = new Date().toISOString();
      const rows = allUsers.map((u) => ({
        user_id: u.id,
        username: u.username ?? null,
        name: u.name ?? null,
        profile_image_url: u.profile_image_url ?? null,
        last_seen_at: nowIso,
      }));
      // Chunk to avoid payload limits
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        await supabase.from('x_followers_cache').upsert(chunk, { onConflict: 'user_id' });
      }
    }

    if (halted) {
      await supabase.from('x_follower_snapshots').update({
        status: 'partial',
        follower_count: allIds.length,
        follower_ids: allIds,
        pages_fetched: pages,
        api_calls_used: apiCalls,
        next_token: pageToken,
        error: `${halted.reason}${halted.status ? ` HTTP ${halted.status}` : ''}: ${(halted.error ?? '').slice(0, 300)}`,
      }).eq('id', snapshotId);

      return new Response(JSON.stringify({
        snapshot_id: snapshotId, status: 'partial', halted: halted.reason, follower_count: allIds.length,
        pages_fetched: pages, api_calls_used: apiCalls,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Mark complete
    await supabase.from('x_follower_snapshots').update({
      status: 'complete',
      follower_count: allIds.length,
      follower_ids: allIds,
      pages_fetched: pages,
      api_calls_used: apiCalls,
      next_token: null,
    }).eq('id', snapshotId);

    // Diff against previous COMPLETE snapshot (excluding this one)
    const { data: prevSnap } = await supabase
      .from('x_follower_snapshots')
      .select('id, follower_ids')
      .eq('status', 'complete')
      .neq('id', snapshotId)
      .order('taken_at', { ascending: false })
      .limit(1)
      .maybeSingle();

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
          await supabase.from('x_follower_changes').insert(changeRows.slice(i, i + 500));
        }
      }
      unfollowedCount = unfollowed.length;
      followedCount = followed.length;
    }

    return new Response(JSON.stringify({
      snapshot_id: snapshotId,
      status: 'complete',
      trigger,
      follower_count: allIds.length,
      pages_fetched: pages,
      api_calls_used: apiCalls,
      unfollowed: unfollowedCount,
      followed: followedCount,
      baseline: !prevSnap,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (e) {
    console.error('x-followers-snapshot error', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
