\set ON_ERROR_STOP on
\set VERBOSITY terse

-- 0X3-672 queue-fairness fixture. Seeds the observed incident backlog shape
-- (priority-20 deliveries, priority-15 hydrates, priority-12 media downloads,
-- priority-10 translations) and emits FACT_* scalar rows the harness asserts.
-- Runs entirely inside the disposable, network-less database.

-- ─── Seed: runtime controls (production + posting enabled + all controls on) ──
INSERT INTO public.runtime_controls (
  singleton_id, singleton_key, environment, posting_mode,
  dedupe_enabled, translation_enabled
) VALUES (true, true, 'production', 'enabled', true, true)
ON CONFLICT (singleton_id) DO UPDATE
SET environment = 'production', posting_mode = 'enabled',
    dedupe_enabled = true, translation_enabled = true;

-- ─── Seed: immutable delivery cutover far in the past ───────────────────────
INSERT INTO public.delivery_cutover (singleton_key, delivery_cutover_at, initialized_by)
VALUES (true, '2026-09-01T14:07:25Z', 'xot-0x3-672-fixture')
ON CONFLICT (singleton_key) DO NOTHING;

-- ─── Seed: accounts/posts so delivery_cutover_allows_job passes ─────────────
INSERT INTO public.accounts (id, handle)
VALUES ('00000000-0000-0000-0000-000000672001', 'xot672-account')
ON CONFLICT DO NOTHING;

-- One post per delivery job, plus a fresh post per fresh translation.
INSERT INTO public.posts (tweet_id, account_id, created_at)
SELECT 'xot672-deliver-' || g,
       '00000000-0000-0000-0000-000000672001',
       now() - interval '3 hours' + (g || ' seconds')::interval
FROM generate_series(1, 68) g
ON CONFLICT (tweet_id) DO NOTHING;

-- ─── Seed: observed backlog shape ────────────────────────────────────────────
-- 68 due deliveries at priority 20 (the incident's blocked media/render waits).
INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at, idempotency_key)
SELECT 'deliver',
       jsonb_build_object('tweet_id', 'xot672-deliver-' || g),
       'pending', 20, 50,
       now() - interval '2 minutes',
       now() - interval '6 hours' + (g || ' seconds')::interval,
       'xot672:deliver:' || g
FROM generate_series(1, 68) g
ON CONFLICT (idempotency_key) DO NOTHING;

-- 605 due translations at priority 10; created 3-8 hours ago (all older than
-- the fresh window so the fresh-arrival scenario is distinguishable).
INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at, idempotency_key)
SELECT 'translate',
       jsonb_build_object('tweet_id', 'xot672-translate-' || g),
       'pending', 10, 0,
       now() - interval '1 minute',
       now() - interval '8 hours' + (g * 20 || ' seconds')::interval,
       'xot672:translate:' || g
FROM generate_series(1, 605) g
ON CONFLICT (idempotency_key) DO NOTHING;

-- 18 due hydrate_tweet at priority 15, 1 due download_media at priority 12.
INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at, idempotency_key)
SELECT 'hydrate_tweet',
       jsonb_build_object('tweet_id', 'xot672-hydrate-' || g),
       'pending', 15, 0,
       now() - interval '1 minute',
       now() - interval '5 hours' + (g || ' seconds')::interval,
       'xot672:hydrate:' || g
FROM generate_series(1, 18) g
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at, idempotency_key)
VALUES ('download_media', jsonb_build_object('tweet_id', 'xot672-deliver-1'),
        'pending', 12, 0, now() - interval '1 minute',
        now() - interval '5 hours', 'xot672:download:1')
ON CONFLICT (idempotency_key) DO NOTHING;

-- ─── Scenario A: incident-scale claim ────────────────────────────────────────
-- claim_jobs(20) against the full backlog. Report the admitted histogram.
CREATE TEMP TABLE xot672_claim_a AS
SELECT * FROM public.claim_jobs(20, NULL, 'xot672-worker-a');

SELECT 'FACT_A_admitted_' || type || '=' || count(*) FROM xot672_claim_a GROUP BY type;
SELECT 'FACT_A_admitted_total=' || count(*) FROM xot672_claim_a;
SELECT 'FACT_A_admitted_non_deliver=' || count(*) FROM xot672_claim_a WHERE type <> 'deliver';
SELECT 'FACT_A_admitted_deliver=' || count(*) FROM xot672_claim_a WHERE type = 'deliver';
SELECT 'FACT_A_admitted_model=' || count(*) FROM xot672_claim_a WHERE type IN ('translate', 'enrich');
SELECT 'FACT_A_admitted_fast=' || count(*) FROM xot672_claim_a WHERE type NOT IN ('translate', 'enrich', 'deliver');
SELECT 'FACT_A_claim_state_all_preparing=' || (count(*) FILTER (WHERE claim_state = 'preparing') = count(*))
  FROM xot672_claim_a;
SELECT 'FACT_A_claim_token_single=' || (count(DISTINCT claim_token) = 1) FROM xot672_claim_a;
SELECT 'FACT_A_attempts_incremented=' || bool_and(attempts > 0) FROM xot672_claim_a;
SELECT 'FACT_A_lease_five_minutes=' || bool_and(
         lease_expires_at > now() + interval '4 minutes'
         AND lease_expires_at < now() + interval '6 minutes')
  FROM xot672_claim_a;

-- Remaining due work after claim A.
SELECT 'FACT_A_pending_remaining_translate=' || count(*) FROM public.jobs
 WHERE type = 'translate' AND status = 'pending';
SELECT 'FACT_A_pending_remaining_deliver=' || count(*) FROM public.jobs
 WHERE type = 'deliver' AND status = 'pending';

-- ─── Scenario B: continuing fresh arrivals ───────────────────────────────────
-- Three fresh translations arrive while the old backlog is still due.
INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at, idempotency_key)
SELECT 'translate',
       jsonb_build_object('tweet_id', 'xot672-fresh-' || g),
       'pending', 10, 0, now(), now(),
       'xot672:translate:fresh:' || g
FROM generate_series(1, 3) g
ON CONFLICT (idempotency_key) DO NOTHING;

CREATE TEMP TABLE xot672_claim_b AS
SELECT * FROM public.claim_jobs(20, NULL, 'xot672-worker-b');

SELECT 'FACT_B_fresh_translates_claimed=' || count(*)
  FROM xot672_claim_b WHERE idempotency_key LIKE 'xot672:translate:fresh:%';
SELECT 'FACT_B_admitted_deliver=' || count(*) FROM xot672_claim_b WHERE type = 'deliver';
SELECT 'FACT_B_admitted_total=' || count(*) FROM xot672_claim_b;

-- ─── Scenario C: deferred deliveries leave admission ─────────────────────────
-- A delivery whose wait was deferred 10 minutes out must not be re-claimed.
INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at, idempotency_key)
VALUES ('deliver', jsonb_build_object('tweet_id', 'xot672-deliver-1'),
        'pending', 20, 60, now() + interval '10 minutes',
        now() - interval '6 hours', 'xot672:deliver:deferred')
ON CONFLICT (idempotency_key) DO NOTHING;

CREATE TEMP TABLE xot672_claim_c AS
SELECT * FROM public.claim_jobs(20, NULL, 'xot672-worker-c');

SELECT 'FACT_C_deferred_deliver_admitted=' || count(*)
  FROM xot672_claim_c WHERE idempotency_key = 'xot672:deliver:deferred';
SELECT 'FACT_C_admitted_total=' || count(*) FROM xot672_claim_c;
SELECT 'FACT_C_admitted_non_deliver=' || count(*) FROM xot672_claim_c WHERE type <> 'deliver';

-- ─── Scenario D: stale/expired claim requeue ─────────────────────────────────
-- A running job past claim expiry without provider_started_at must be requeued
-- by reconcile_expired_job_claims and become claimable again.
INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at,
                         idempotency_key, locked_by, locked_at, lease_expires_at,
                         claim_state, claim_token, claim_generation, claim_started_at, claim_expires_at)
VALUES ('translate', jsonb_build_object('tweet_id', 'xot672-stale'), 'running', 10, 1,
        now() - interval '10 minutes', now() - interval '7 hours',
        'xot672:translate:stale', 'xot672-dead-worker',
        now() - interval '10 minutes', now() - interval '5 minutes',
        'preparing', gen_random_uuid(), 1, now() - interval '10 minutes', now() - interval '5 minutes')
ON CONFLICT (idempotency_key) DO NOTHING;

SELECT 'FACT_D_requeued=' || (public.reconcile_expired_job_claims(100)->>'requeued');
SELECT 'FACT_D_stale_back_to_pending=' || (count(*) = 1) FROM public.jobs
 WHERE idempotency_key = 'xot672:translate:stale' AND status = 'pending';

-- ─── Scenario E: ambiguous provider outcome is NOT auto-replayed ─────────────
INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at,
                         idempotency_key, locked_by, locked_at, lease_expires_at,
                         claim_state, claim_token, claim_generation, claim_started_at, claim_expires_at,
                         provider_started_at)
VALUES ('deliver', jsonb_build_object('tweet_id', 'xot672-deliver-2'), 'running', 20, 2,
        now() - interval '10 minutes', now() - interval '6 hours',
        'xot672:deliver:ambiguous', 'xot672-dead-worker',
        now() - interval '10 minutes', now() - interval '5 minutes',
        'posting', gen_random_uuid(), 1, now() - interval '10 minutes', now() - interval '5 minutes',
        now() - interval '9 minutes')
ON CONFLICT (idempotency_key) DO NOTHING;

SELECT 'FACT_E_ambiguous_reported=' || (public.reconcile_expired_job_claims(100)->>'ambiguous');
SELECT 'FACT_E_ambiguous_not_requeued=' || (count(*) = 1) FROM public.jobs
 WHERE idempotency_key = 'xot672:deliver:ambiguous' AND status = 'running';

-- ─── Scenario F: runtime-control pause gates admission ───────────────────────
UPDATE public.runtime_controls SET translation_enabled = false
 WHERE singleton_id IS TRUE AND singleton_key IS TRUE;

CREATE TEMP TABLE xot672_claim_f AS
SELECT * FROM public.claim_jobs(20, NULL, 'xot672-worker-f');

SELECT 'FACT_F_translate_claimed_while_paused=' || count(*)
  FROM xot672_claim_f WHERE type = 'translate';

UPDATE public.runtime_controls SET translation_enabled = true
 WHERE singleton_id IS TRUE AND singleton_key IS TRUE;

-- ─── Scenario G: type-scoped claims keep full batch for a single lane ────────
CREATE TEMP TABLE xot672_claim_g AS
SELECT * FROM public.claim_jobs(20, ARRAY['translate'], 'xot672-worker-g');

SELECT 'FACT_G_translate_only_claimed=' || count(*) FROM xot672_claim_g;

CREATE TEMP TABLE xot672_claim_h AS
SELECT * FROM public.claim_jobs(20, ARRAY['deliver'], 'xot672-worker-h');

SELECT 'FACT_H_deliver_only_claimed=' || count(*) FROM xot672_claim_h;

-- ─── Scenario I: bounded fresh-work wait ─────────────────────────────────────
-- With the old translation backlog still pending, a fresh translation must be
-- admitted within a bounded number of claim batches (freshness protection).
INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at, idempotency_key)
VALUES ('translate', jsonb_build_object('tweet_id', 'xot672-fresh-late'), 'pending', 10, 0,
        now(), now(), 'xot672:translate:fresh-late')
ON CONFLICT (idempotency_key) DO NOTHING;

CREATE TEMP TABLE xot672_fresh_wait (batches integer);
DO $$
DECLARE
  v_claimed boolean := false;
  v_batches integer := 0;
  v_row record;
BEGIN
  WHILE v_batches < 8 AND NOT v_claimed LOOP
    v_batches := v_batches + 1;
    FOR v_row IN SELECT * FROM public.claim_jobs(20, NULL, 'xot672-worker-i-' || v_batches) LOOP
      IF v_row.idempotency_key = 'xot672:translate:fresh-late' THEN
        v_claimed := true;
      END IF;
    END LOOP;
  END LOOP;
  INSERT INTO xot672_fresh_wait VALUES (CASE WHEN v_claimed THEN v_batches ELSE -1 END);
END $$;

SELECT 'FACT_I_fresh_late_claimed_in_batches=' || batches FROM xot672_fresh_wait;

-- ─── Scenario J: deliveries still drain under a pure-delivery backlog ────────
-- When non-delivery work is exhausted the delivery lane must keep full-batch
-- admission (no artificial starvation in the other direction). The earlier
-- scenarios drained most seeded deliveries, so seed a fresh delivery batch
-- (reusing the cutover-eligible posts) to guarantee >=20 eligible rows.
-- Scoped to fixture rows: rows outside the xot672:% namespace are immutable.
DELETE FROM public.jobs
 WHERE status = 'pending'
   AND type <> 'deliver'
   AND idempotency_key LIKE 'xot672:%';

INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at, idempotency_key)
SELECT 'deliver',
       jsonb_build_object('tweet_id', 'xot672-deliver-' || g),
       'pending', 20, 0,
       now() - interval '1 minute',
       now(),
       'xot672:deliver:late:' || g
FROM generate_series(1, 25) g
ON CONFLICT (idempotency_key) DO NOTHING;

CREATE TEMP TABLE xot672_claim_j AS
SELECT * FROM public.claim_jobs(20, NULL, 'xot672-worker-j');

SELECT 'FACT_J_deliver_only_backlog_claimed=' || count(*) FROM xot672_claim_j WHERE type = 'deliver';
SELECT 'FACT_J_total=' || count(*) FROM xot672_claim_j;

-- ─── Scenario K: continuously replenished fast work cannot starve model ─────
-- The review gap: a *finite* p15 backlog drains in the first batch and then
-- translations flow. Here the fast backlog stays deep across batches — fresh
-- hydrations keep arriving — and the model lane must still take its share
-- every batch. Translations are seeded OLD (outside the fresh window) so it
-- is the lane reservation, not the fresh-work boost, that admits them.
-- Cleanup is scoped to fixture rows: historical deliver jobs are immutable
-- under trg_00_historical_delivery_job_zero_write.
DELETE FROM public.jobs
 WHERE status = 'pending' AND idempotency_key LIKE 'xot672:%';

INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at, idempotency_key)
SELECT 'hydrate_tweet',
       jsonb_build_object('tweet_id', 'xot672-k-hydrate-' || g),
       'pending', 15, 0,
       now() - interval '1 minute',
       now() - interval '5 hours' + (g || ' seconds')::interval,
       'xot672:k:hydrate:' || g
FROM generate_series(1, 80) g;

INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at, idempotency_key)
SELECT 'dedupe',
       jsonb_build_object('tweet_id', 'xot672-k-dedupe-' || g),
       'pending', 30, 0,
       now() - interval '1 minute',
       now() - interval '5 hours' + (g || ' seconds')::interval,
       'xot672:k:dedupe:' || g
FROM generate_series(1, 40) g;

INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at, idempotency_key)
SELECT 'translate',
       jsonb_build_object('tweet_id', 'xot672-k-translate-' || g),
       'pending', 10, 0,
       now() - interval '1 minute',
       now() - interval '8 hours' + (g || ' seconds')::interval,
       'xot672:k:translate:' || g
FROM generate_series(1, 30) g;

INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at, idempotency_key)
SELECT 'deliver',
       jsonb_build_object('tweet_id', 'xot672-deliver-' || g),
       'pending', 20, 0,
       now() - interval '1 minute',
       now(),
       'xot672:k:deliver:' || g
FROM generate_series(1, 10) g;

CREATE TEMP TABLE xot672_claim_k1 AS
SELECT * FROM public.claim_jobs(20, NULL, 'xot672-worker-k1');

SELECT 'FACT_K1_translate=' || count(*) FROM xot672_claim_k1 WHERE type = 'translate';
SELECT 'FACT_K1_fast=' || count(*) FROM xot672_claim_k1 WHERE type NOT IN ('translate', 'enrich', 'deliver');
SELECT 'FACT_K1_deliver=' || count(*) FROM xot672_claim_k1 WHERE type = 'deliver';
SELECT 'FACT_K1_total=' || count(*) FROM xot672_claim_k1;

-- Replenish the fast lane between claims — the starvation mode the review
-- flagged is a *sustained* high-priority fast inflow, not a finite backlog.
INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at, idempotency_key)
SELECT 'hydrate_tweet',
       jsonb_build_object('tweet_id', 'xot672-k2-hydrate-' || g),
       'pending', 15, 0,
       now() - interval '1 minute',
       now(),
       'xot672:k2:hydrate:' || g
FROM generate_series(1, 40) g;

CREATE TEMP TABLE xot672_claim_k2 AS
SELECT * FROM public.claim_jobs(20, NULL, 'xot672-worker-k2');

SELECT 'FACT_K2_translate=' || count(*) FROM xot672_claim_k2 WHERE type = 'translate';
SELECT 'FACT_K2_fast=' || count(*) FROM xot672_claim_k2 WHERE type NOT IN ('translate', 'enrich', 'deliver');
SELECT 'FACT_K2_deliver=' || count(*) FROM xot672_claim_k2 WHERE type = 'deliver';
SELECT 'FACT_K2_total=' || count(*) FROM xot672_claim_k2;

-- ─── Scenario L: atomic bounded download resurrection ───────────────────────
-- The wait_media gate delegates resurrection to
-- enqueue_bounded_media_download(), which decides under one row lock. These
-- facts pin the sequential contract; the harness adds a true two-session
-- race probe on top.
INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at, idempotency_key, result_meta)
VALUES ('download_media',
        jsonb_build_object('tweet_id', 'xot672-l', 'source', 'video_render_gate'),
        'failed', 12, 5, now(), now() - interval '1 hour', 'xot672:l:dl',
        '{"video_render_retry_cycle": 2, "video_render_retry_media": "media-a"}')
ON CONFLICT (idempotency_key) DO NOTHING;

-- L1: a failed row inside the budget resurrects once, cycle -> 3.
SELECT 'FACT_L1_result=' || public.enqueue_bounded_media_download('xot672:l:dl', 'xot672-l', 'media-a', 3);
SELECT 'FACT_L1_status=' || status FROM public.jobs WHERE idempotency_key = 'xot672:l:dl';
SELECT 'FACT_L1_cycle=' || (result_meta->>'video_render_retry_cycle') FROM public.jobs WHERE idempotency_key = 'xot672:l:dl';
SELECT 'FACT_L1_attempts=' || attempts FROM public.jobs WHERE idempotency_key = 'xot672:l:dl';

-- L2: the now-pending row is reported open and left untouched.
SELECT 'FACT_L2_result=' || public.enqueue_bounded_media_download('xot672:l:dl', 'xot672-l', 'media-a', 3);
SELECT 'FACT_L2_cycle=' || (result_meta->>'video_render_retry_cycle') FROM public.jobs WHERE idempotency_key = 'xot672:l:dl';

-- L3: a stale evaluation cannot touch a row a worker already claimed.
UPDATE public.jobs
   SET status = 'running', locked_by = 'xot672-worker', lease_expires_at = now() + interval '5 minutes'
 WHERE idempotency_key = 'xot672:l:dl';
SELECT 'FACT_L3_result=' || public.enqueue_bounded_media_download('xot672:l:dl', 'xot672-l', 'media-a', 3);
SELECT 'FACT_L3_status=' || status FROM public.jobs WHERE idempotency_key = 'xot672:l:dl';
SELECT 'FACT_L3_lease_kept=' || (lease_expires_at IS NOT NULL) FROM public.jobs WHERE idempotency_key = 'xot672:l:dl';
SELECT 'FACT_L3_cycle=' || (result_meta->>'video_render_retry_cycle') FROM public.jobs WHERE idempotency_key = 'xot672:l:dl';

-- L4: a row at the budget ceiling is exhausted, not resurrected.
UPDATE public.jobs
   SET status = 'failed', locked_by = NULL, lease_expires_at = NULL,
       result_meta = '{"video_render_retry_cycle": 3, "video_render_retry_media": "media-a"}'
 WHERE idempotency_key = 'xot672:l:dl';
SELECT 'FACT_L4_result=' || public.enqueue_bounded_media_download('xot672:l:dl', 'xot672-l', 'media-a', 3);
SELECT 'FACT_L4_status=' || status FROM public.jobs WHERE idempotency_key = 'xot672:l:dl';
SELECT 'FACT_L4_cycle=' || (result_meta->>'video_render_retry_cycle') FROM public.jobs WHERE idempotency_key = 'xot672:l:dl';

-- L5: a different media identity resets the budget and resurrects.
SELECT 'FACT_L5_result=' || public.enqueue_bounded_media_download('xot672:l:dl', 'xot672-l', 'media-b', 3);
SELECT 'FACT_L5_cycle=' || (result_meta->>'video_render_retry_cycle') FROM public.jobs WHERE idempotency_key = 'xot672:l:dl';
SELECT 'FACT_L5_media=' || (result_meta->>'video_render_retry_media') FROM public.jobs WHERE idempotency_key = 'xot672:l:dl';
SELECT 'FACT_L5_prev_media=' || (result_meta->>'video_render_retry_prev_media') FROM public.jobs WHERE idempotency_key = 'xot672:l:dl';

-- ─── Scenario M: undersized batches rotate lane admission ───────────────────
-- batch=2 < 3 in-scope lanes: static reservations cannot express fairness at
-- this size, so admission rotates a cyclic window of lanes per call. Under a
-- saturated backlog every lane must receive capacity across calls — no lane
-- may starve because its reserve computed to zero.
DELETE FROM public.jobs
 WHERE status = 'pending' AND idempotency_key LIKE 'xot672:%';

INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at, idempotency_key)
SELECT 'translate',
       jsonb_build_object('tweet_id', 'xot672-m-translate-' || g),
       'pending', 10, 0,
       now() - interval '1 minute',
       now() - interval '2 hours' + (g || ' seconds')::interval,
       'xot672:m:translate:' || g
FROM generate_series(1, 16) g;

INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at, idempotency_key)
SELECT 'hydrate_tweet',
       jsonb_build_object('tweet_id', 'xot672-m-hydrate-' || g),
       'pending', 15, 0,
       now() - interval '1 minute',
       now() - interval '2 hours' + (g || ' seconds')::interval,
       'xot672:m:hydrate:' || g
FROM generate_series(1, 16) g;

INSERT INTO public.jobs (type, payload, status, priority, attempts, next_run_at, created_at, idempotency_key)
SELECT 'deliver',
       jsonb_build_object('tweet_id', 'xot672-deliver-' || g),
       'pending', 20, 0,
       now() - interval '1 minute',
       now(),
       'xot672:m:deliver:' || g
FROM generate_series(1, 16) g;

CREATE TEMP TABLE xot672_m_claims(type text);
DO $m$
BEGIN
  FOR i IN 1..15 LOOP
    INSERT INTO xot672_m_claims (type)
      SELECT j.type FROM public.claim_jobs(2, NULL, 'xot672-worker-m') AS j;
  END LOOP;
END
$m$;

SELECT 'FACT_M_total=' || count(*) FROM xot672_m_claims;
SELECT 'FACT_M_model=' || count(*) FROM xot672_m_claims WHERE type IN ('translate', 'enrich');
SELECT 'FACT_M_fast=' || count(*) FROM xot672_m_claims WHERE type NOT IN ('translate', 'enrich', 'deliver');
SELECT 'FACT_M_delivery=' || count(*) FROM xot672_m_claims WHERE type = 'deliver';
