-- Synthetic data only. Executed exclusively by the network-isolated replay runner.
CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %', label; END IF; END $$;

DO $$
DECLARE first_claim jsonb; second_claim jsonb; next_claim jsonb;
BEGIN
  first_claim := public.claim_follower_snapshot('manual', false, 60);
  PERFORM pg_temp.assert_true((first_claim->>'claimed')::boolean, 'initial follower admission');
  second_claim := public.claim_follower_snapshot('manual', true, 60);
  PERFORM pg_temp.assert_true(second_claim->>'reason' = 'snapshot_in_progress', 'force cannot steal active lease');
  PERFORM pg_temp.assert_true(NOT public.finish_follower_snapshot_claim((first_claim->>'snapshot_id')::uuid, gen_random_uuid(), 'complete', '{}'), 'wrong token cannot finish');
  UPDATE public.x_follower_snapshots SET claim_expires_at = now() - interval '1 second';
  next_claim := public.claim_follower_snapshot('cron', false, 60);
  PERFORM pg_temp.assert_true((next_claim->>'claimed')::boolean, 'expired orphan does not consume daily cap');
  PERFORM pg_temp.assert_true(NOT public.renew_follower_snapshot_claim((first_claim->>'snapshot_id')::uuid, (first_claim->>'claim_token')::uuid), 'old claim fenced');
  PERFORM pg_temp.assert_true(public.finish_follower_snapshot_claim((next_claim->>'snapshot_id')::uuid, (next_claim->>'claim_token')::uuid, 'failed', '{"error":"provider_failed"}'), 'failure recorded');
  next_claim := public.claim_follower_snapshot('cron', false, 60);
  PERFORM pg_temp.assert_true((next_claim->>'claimed')::boolean, 'failed run retryable');
  PERFORM pg_temp.assert_true(public.finish_follower_snapshot_claim((next_claim->>'snapshot_id')::uuid, (next_claim->>'claim_token')::uuid, 'complete', '{"follower_ids":["synthetic"],"api_calls_used":1}'), 'success finalized');
  PERFORM pg_temp.assert_true(public.claim_follower_snapshot('cron', false, 60)->>'reason' = 'daily_cap', 'completed snapshot consumes cap');
END $$;
SELECT 'PASS follower lease, force, orphan, failure, and finalization';

SELECT public.initialize_delivery_cutover('isolated remaining PR replay');
INSERT INTO public.accounts(id, handle) VALUES ('00000000-0000-0000-0000-000000008001', 'synthetic_replay');
INSERT INTO public.posts(tweet_id, account_id, text_original, text_translated, created_at, importance_score, delivery_decision)
VALUES ('replay-media', '00000000-0000-0000-0000-000000008001', 'synthetic', 'synthetic', clock_timestamp(), 20, 'deliver');
INSERT INTO public.webhook_receipts(receipt_key, auth_mode, feed_id, status, claim_token, claim_generation, claim_expires_at)
VALUES ('replay-receipt', 'hmac', 'synthetic', 'materializing', '00000000-0000-0000-0000-000000008002', 1, now() + interval '1 hour');
DO $$
DECLARE old_id uuid; new_id uuid; media_set jsonb;
BEGIN
  media_set := jsonb_build_array(jsonb_build_object('kind','image','src_url','https://example.com/one.jpg','src_url_hash',repeat('a',64)));
  PERFORM public.replace_rss_post_media('replay-media', media_set, 'replay-receipt', '00000000-0000-0000-0000-000000008002', 1);
  SELECT id INTO old_id FROM public.media WHERE tweet_id='replay-media';
  UPDATE public.media SET storage_path='synthetic/one.jpg', downloaded_at=now() WHERE id=old_id;
  PERFORM public.replace_rss_post_media('replay-media', media_set, 'replay-receipt', '00000000-0000-0000-0000-000000008002', 1);
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.media WHERE id=old_id AND storage_path='synthetic/one.jpg'), 'unchanged download preserved');
  BEGIN
    PERFORM public.replace_rss_post_media('replay-media', '[{"kind":"image","src_url":"https://example.com/bad.jpg","src_url_hash":"bad"}]', 'replay-receipt', '00000000-0000-0000-0000-000000008002', 1);
    RAISE EXCEPTION 'expected validation failure';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'rss_webhook_media_invalid_item' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.media WHERE id=old_id), 'invalid replacement leaves old media');
  media_set := jsonb_build_array(jsonb_build_object('kind','image','src_url','https://example.com/two.jpg','src_url_hash',repeat('b',64)));
  PERFORM public.replace_rss_post_media('replay-media', media_set, 'replay-receipt', '00000000-0000-0000-0000-000000008002', 1);
  SELECT id INTO new_id FROM public.media WHERE tweet_id='replay-media';
  PERFORM pg_temp.assert_true(new_id <> old_id, 'changed source rotates row identity');
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.media WHERE id=old_id), 'old download cannot match new source');
  PERFORM public.replace_rss_post_media('replay-media', '[]', 'replay-receipt', '00000000-0000-0000-0000-000000008002', 1, true);
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.media WHERE id=new_id), 'unresolved video preserves resolved media');
  PERFORM public.replace_rss_post_media('replay-media', '[]', 'replay-receipt', '00000000-0000-0000-0000-000000008002', 1, false);
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.media WHERE tweet_id='replay-media'), 'authoritative empty media removes obsolete slots');
END $$;
SELECT 'PASS RSS replacement preservation, validation, identity fencing, and empty set';

INSERT INTO public.settings(key,value) VALUES ('x_rate_limits','{"media_uploads_per_day":3}') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;
INSERT INTO public.x_deliveries(id, post_id, status, claim_state, claim_token, claim_generation, claim_expires_at)
VALUES ('00000000-0000-0000-0000-000000008010','replay-media','posting','preparing','00000000-0000-0000-0000-000000008011',1,now()+interval '1 hour');
DO $$
DECLARE result jsonb;
BEGIN
  result := public.reserve_x_media_uploads('00000000-0000-0000-0000-000000008010','00000000-0000-0000-0000-000000008011',1,4);
  PERFORM pg_temp.assert_true(result->>'reason'='rate_limit_media', 'reject full batch above cap');
  PERFORM pg_temp.assert_true(public.get_x_media_upload_usage()=0, 'rejection consumes nothing');
  result := public.reserve_x_media_uploads('00000000-0000-0000-0000-000000008010','00000000-0000-0000-0000-000000008011',1,3);
  PERFORM pg_temp.assert_true((result->>'reserved')::boolean, 'exact cap accepted');
  PERFORM public.reserve_x_media_uploads('00000000-0000-0000-0000-000000008010','00000000-0000-0000-0000-000000008011',1,3);
  PERFORM pg_temp.assert_true(public.get_x_media_upload_usage()=3, 'reservation replay idempotent');
  PERFORM pg_temp.assert_true(public.release_x_post_delivery_for_retry('00000000-0000-0000-0000-000000008010','00000000-0000-0000-0000-000000008011',1), 'pre-provider release');
  PERFORM pg_temp.assert_true(public.get_x_media_upload_usage()=0, 'pre-provider refund');
END $$;
SELECT 'PASS quota full-batch admission, exact cap, idempotency, and pre-provider refund';

DO $$
DECLARE signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY['claim_follower_snapshot(text,boolean,integer)','renew_follower_snapshot_claim(uuid,uuid)','finish_follower_snapshot_claim(uuid,uuid,text,jsonb)','replace_rss_post_media(text,jsonb,text,uuid,bigint,boolean)','reserve_x_media_uploads(uuid,uuid,bigint,integer)','get_x_media_upload_usage()'] LOOP
    PERFORM pg_temp.assert_true(NOT has_function_privilege('anon','public.'||signature,'EXECUTE'), 'anon denied '||signature);
    PERFORM pg_temp.assert_true(NOT has_function_privilege('authenticated','public.'||signature,'EXECUTE'), 'authenticated denied '||signature);
    PERFORM pg_temp.assert_true(has_function_privilege('service_role','public.'||signature,'EXECUTE'), 'service role allowed '||signature);
  END LOOP;
END $$;
SELECT 'PASS RPC role boundaries';

-- A database job failure must roll back the replacement, not strand new media.
CREATE FUNCTION pg_temp.reject_replay_download() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.idempotency_key LIKE 'download_media:rss:replay-media:%' THEN RAISE EXCEPTION 'synthetic_job_failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER replay_reject_job BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_replay_download();
DO $$
BEGIN
  BEGIN
    PERFORM public.replace_rss_post_media('replay-media', jsonb_build_array(jsonb_build_object('kind','image','src_url','https://example.com/three.jpg','src_url_hash',repeat('c',64))), 'replay-receipt', '00000000-0000-0000-0000-000000008002', 1);
    RAISE EXCEPTION 'expected job failure';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'synthetic_job_failure' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.media WHERE tweet_id='replay-media'), 'job failure rolls back media insertion');
  PERFORM pg_temp.assert_true(NOT (SELECT has_media FROM public.posts WHERE tweet_id='replay-media'), 'job failure rolls back post flag');
END $$;
DROP TRIGGER replay_reject_job ON public.jobs;
SELECT 'PASS RSS media and job atomic rollback';

-- Newer ordinary/future pending rows cannot consume LIMIT ahead of a due retry.
UPDATE public.posts SET delivery_decision='hold' WHERE tweet_id='replay-media';
INSERT INTO public.posts(tweet_id,account_id,text_original,text_translated,created_at,importance_score,delivery_decision)
SELECT name,'00000000-0000-0000-0000-000000008001','synthetic','synthetic',clock_timestamp()+offset_ms*interval '1 millisecond',20,'deliver'
FROM (VALUES ('replay-due',0),('replay-ordinary',1),('replay-future',2),('replay-terminal',3)) f(name,offset_ms);
INSERT INTO public.x_deliveries(post_id,status,claim_release_reason,next_retry_at)
VALUES ('replay-due','pending','pre_provider_retry',now()-interval '1 minute'),
('replay-ordinary','pending',NULL,NULL),
('replay-future','pending','pre_provider_retry',now()+interval '1 hour'),
('replay-terminal','failed','pre_provider_retry',NULL);
SELECT pg_temp.assert_true((SELECT array_agg(tweet_id) FROM public.get_x_post_candidates(1,NULL))=ARRAY['replay-due'], 'due retry survives limit ahead of newer ineligible rows');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.get_x_post_candidates(1,'replay-future')), 'targeted retry also respects due time');
SELECT 'PASS due-only reclaim before LIMIT and targeted retry';

-- Once provider start is possible, failure still consumes the reservation.
INSERT INTO public.x_deliveries(id,post_id,status,claim_state,claim_token,claim_generation,claim_expires_at)
VALUES ('00000000-0000-0000-0000-000000008020','replay-due','posting','preparing','00000000-0000-0000-0000-000000008021',1,now()+interval '1 hour');
SELECT public.reserve_x_media_uploads('00000000-0000-0000-0000-000000008020','00000000-0000-0000-0000-000000008021',1,2);
UPDATE public.x_deliveries SET provider_started_at=now(),status='failed',claim_state='failed',media_count=1 WHERE id='00000000-0000-0000-0000-000000008020';
SELECT pg_temp.assert_true(NOT public.release_x_post_delivery_for_retry('00000000-0000-0000-0000-000000008020','00000000-0000-0000-0000-000000008021',1), 'post-provider refund denied');
SELECT pg_temp.assert_true(public.get_x_media_upload_usage()=2, 'failed partially uploaded batch remains conservatively counted once');
SELECT 'PASS ambiguous and failed provider attempts consume quota';
