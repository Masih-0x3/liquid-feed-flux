\set ON_ERROR_STOP on
\set VERBOSITY terse

-- E6 uses a fresh database and deliberately fixed IDs so every assertion is
-- reproducible without logging credentials, tokens, or provider payloads.
INSERT INTO public.accounts (id, handle) VALUES ('00000000-0000-0000-0000-000000000601', 'e6-account') ON CONFLICT DO NOTHING;
INSERT INTO public.posts (tweet_id, account_id) VALUES
  ('e6-mixed-old', '00000000-0000-0000-0000-000000000601'),
  ('e6-mixed-fresh', '00000000-0000-0000-0000-000000000601'),
  ('e6-duplicate-a', '00000000-0000-0000-0000-000000000601'),
  ('e6-duplicate-b', '00000000-0000-0000-0000-000000000601'),
  ('e6-token-a', '00000000-0000-0000-0000-000000000601'),
  ('e6-attach-late', '00000000-0000-0000-0000-000000000601')
ON CONFLICT DO NOTHING;

INSERT INTO public.media (id, tweet_id, kind, storage_path, downloaded_at, mime_type, file_size) VALUES
  ('00000000-0000-0000-0000-000000000611', 'e6-mixed-old', 'image', 'e6/mixed.jpg', now() - interval '45 days', 'image/jpeg', 1),
  ('00000000-0000-0000-0000-000000000612', 'e6-mixed-fresh', 'image', 'e6/mixed.jpg', now() - interval '2 days', 'image/jpeg', 1),
  ('00000000-0000-0000-0000-000000000621', 'e6-duplicate-a', 'image', 'e6/duplicate.jpg', now() - interval '45 days', 'image/jpeg', 1),
  ('00000000-0000-0000-0000-000000000622', 'e6-duplicate-b', 'image', 'e6/duplicate.jpg', now() - interval '46 days', 'image/jpeg', 1),
  ('00000000-0000-0000-0000-000000000631', 'e6-token-a', 'image', 'e6/token.jpg', now() - interval '2 days', 'image/jpeg', 1)
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  mixed_count integer;
  preview_count integer;
  claim_count integer;
  duplicate_object_count integer;
  token_old uuid;
  token_new uuid;
  object_id uuid;
  late_inserted boolean := false;
  object_status text;
  remaining_refs integer;
  object_present boolean;
  finalize_status text;
  finalize_token_match boolean;
  finalize_lease_live boolean;
  pending_jobs integer;
  running_jobs integer;
  pending_deliveries integer;
  running_deliveries integer;
  pending_x_deliveries integer;
  running_x_deliveries integer;
  unsafe_video_gif integer;
  token_aged_count integer;
BEGIN
  SELECT count(*) INTO mixed_count
    FROM public.media_objects_preview_old('temp-media', 100, 30)
   WHERE storage_path = 'e6/mixed.jpg';
  IF mixed_count <> 0 THEN RAISE EXCEPTION 'E6_B2B mixed-age shared refs claimable'; END IF;

  SELECT count(*) INTO duplicate_object_count
    FROM public.media_objects WHERE storage_path = 'e6/duplicate.jpg';
  IF duplicate_object_count <> 1 THEN RAISE EXCEPTION 'E6_B2B duplicate old refs did not share one physical object'; END IF;

  SELECT count(*) INTO preview_count
    FROM public.media_objects_preview_old('temp-media', 100, 30)
   WHERE storage_path = 'e6/duplicate.jpg';
  IF preview_count <> 1 THEN RAISE EXCEPTION 'E6_B2B preview expected one duplicate object'; END IF;
  SELECT status, deletion_token INTO STRICT object_status, token_old
    FROM public.media_objects WHERE storage_path = 'e6/duplicate.jpg';
  IF object_status IS DISTINCT FROM 'active' OR token_old IS NOT NULL THEN
    RAISE EXCEPTION 'E6_B2B preview mutated object state';
  END IF;

  SELECT count(*) INTO claim_count
    FROM public.media_objects_claim_old('temp-media', 100, 30)
   WHERE storage_path = 'e6/duplicate.jpg';
  IF claim_count <> 1 THEN RAISE EXCEPTION 'E6_B2B duplicate old refs did not produce one claim'; END IF;
  SELECT id, deletion_token INTO STRICT object_id, token_old
    FROM public.media_objects WHERE storage_path = 'e6/duplicate.jpg';
  IF token_old IS NULL THEN RAISE EXCEPTION 'E6_B2B claim token missing'; END IF;
  IF public.media_objects_finalize_delete(object_id, gen_random_uuid()) THEN
    RAISE EXCEPTION 'E6_B2B wrong token finalized';
  END IF;
  UPDATE public.media_objects SET claim_expires_at = now() - interval '1 second' WHERE id = object_id;
  IF public.media_objects_finalize_delete(object_id, token_old) THEN
    RAISE EXCEPTION 'E6_B2B expired token finalized';
  END IF;
  SELECT deletion_token INTO token_new
    FROM public.media_objects_claim_old('temp-media', 100, 30)
   WHERE storage_path = 'e6/duplicate.jpg';
  IF token_new IS NULL OR token_new = token_old THEN RAISE EXCEPTION 'E6_B2B reclaim did not rotate token'; END IF;
  IF NOT public.media_objects_finalize_delete(object_id, token_new) THEN
    RAISE EXCEPTION 'E6_B2B exact token failed to finalize';
  END IF;
  SELECT count(*) INTO remaining_refs FROM public.media WHERE storage_path = 'e6/duplicate.jpg';
  IF remaining_refs <> 0 THEN RAISE EXCEPTION 'E6_B2B finalize left DB references'; END IF;

  UPDATE public.media
     SET downloaded_at = now() - interval '45 days'
   WHERE id = '00000000-0000-0000-0000-000000000631'
     AND tweet_id = 'e6-token-a'
     AND storage_path = 'e6/token.jpg';
  GET DIAGNOSTICS token_aged_count = ROW_COUNT;
  IF token_aged_count <> 1 THEN
    RAISE EXCEPTION 'E6_B2B token age transition expected one row';
  END IF;

  -- A claimed deleting object is not attachable by a late media reference.
  SELECT deletion_token INTO token_old
    FROM public.media_objects_claim_old('temp-media', 100, 30)
   WHERE storage_path = 'e6/token.jpg';
  BEGIN
    INSERT INTO public.media (id, tweet_id, kind, storage_path, downloaded_at, mime_type)
    VALUES ('00000000-0000-0000-0000-000000000632', 'e6-attach-late', 'image', 'e6/token.jpg', now() - interval '45 days', 'image/jpeg');
    late_inserted := true;
  EXCEPTION WHEN OTHERS THEN
    late_inserted := false;
  END;
  IF late_inserted THEN RAISE EXCEPTION 'E6_B2B late attachment was accepted'; END IF;

  -- The claim/finalize path is exact-token only, and the token remains usable
  -- while its lease is live (the injected storage failure test covers ordering).
  IF NOT public.media_objects_finalize_delete(
    (SELECT id FROM public.media_objects WHERE storage_path = 'e6/token.jpg'), token_old
  ) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.media_objects WHERE storage_path = 'e6/token.jpg'
    ) INTO object_present;
    SELECT mo.status,
           mo.deletion_token IS NOT DISTINCT FROM token_old,
           mo.claim_expires_at IS NOT NULL AND mo.claim_expires_at >= now()
      INTO finalize_status, finalize_token_match, finalize_lease_live
      FROM public.media_objects mo
     WHERE mo.storage_path = 'e6/token.jpg';
    SELECT count(*) FILTER (WHERE j.status = 'pending'),
           count(*) FILTER (WHERE j.status = 'running')
      INTO pending_jobs, running_jobs
      FROM public.jobs j
     WHERE j.status IN ('pending', 'running')
       AND j.type IN ('download_media', 'resolve_media', 'hydrate_tweet')
       AND EXISTS (
         SELECT 1 FROM public.media m
          WHERE m.tweet_id = j.payload->>'tweet_id'
            AND m.storage_path = 'e6/token.jpg'
       );
    SELECT count(*) FILTER (WHERE d.status = 'pending'),
           count(*) FILTER (WHERE d.status = 'running')
      INTO pending_deliveries, running_deliveries
      FROM public.deliveries d
     WHERE d.subject_type = 'post'
       AND d.status IN ('pending', 'running')
       AND EXISTS (
         SELECT 1 FROM public.media m
          WHERE m.tweet_id = d.subject_id
            AND m.storage_path = 'e6/token.jpg'
       );
    SELECT count(*) FILTER (WHERE xd.status = 'pending'),
           count(*) FILTER (WHERE xd.status = 'running')
      INTO pending_x_deliveries, running_x_deliveries
      FROM public.x_deliveries xd
     WHERE xd.status IN ('pending', 'running')
       AND EXISTS (
         SELECT 1 FROM public.media m
          WHERE m.tweet_id = xd.post_id
            AND m.storage_path = 'e6/token.jpg'
       );
    SELECT count(*) INTO unsafe_video_gif
      FROM public.media m
     WHERE m.storage_path = 'e6/token.jpg'
       AND m.kind IN ('video', 'gif')
       AND (m.mime_type IS NULL OR m.mime_type NOT LIKE 'video/%');
    RAISE EXCEPTION 'E6_B2B token finalization failed object_present=% status=% token_match=% lease_live=% pending_jobs=% running_jobs=% pending_deliveries=% running_deliveries=% pending_x_deliveries=% running_x_deliveries=% unsafe_video_gif=%',
      object_present, COALESCE(finalize_status, 'absent'), COALESCE(finalize_token_match, false),
      COALESCE(finalize_lease_live, false), COALESCE(pending_jobs, 0), COALESCE(running_jobs, 0),
      COALESCE(pending_deliveries, 0), COALESCE(running_deliveries, 0),
      COALESCE(pending_x_deliveries, 0), COALESCE(running_x_deliveries, 0), COALESCE(unsafe_video_gif, 0);
  END IF;
END $$;

-- B3A queue claim, owner/token/generation state, marker fence, zero-row writes.
INSERT INTO public.jobs (id, type, payload, status, next_run_at)
VALUES ('00000000-0000-0000-0000-000000000701', 'download_media', '{"tweet_id":"e6-job"}', 'pending', now())
ON CONFLICT DO NOTHING;
DO $$
DECLARE
  claimed public.jobs;
  stale boolean;
  marked boolean;
  completed boolean;
  token uuid;
  generation bigint;
  recon jsonb;
  second_claim public.jobs;
BEGIN
  SELECT * INTO STRICT claimed FROM public.claim_jobs(1, ARRAY['download_media'], 'e6-owner-a');
  IF claimed.locked_by <> 'e6-owner-a' OR claimed.claim_token IS NULL OR claimed.claim_generation <> 1 OR claimed.claim_state <> 'preparing' THEN
    RAISE EXCEPTION 'E6_B3A claim did not mint owner/token/generation/preparing state';
  END IF;
  token := claimed.claim_token; generation := claimed.claim_generation;
  IF public.mark_job_provider_started(claimed.id, gen_random_uuid(), generation) THEN RAISE EXCEPTION 'E6_B3A wrong token marked'; END IF;
  IF public.mark_job_provider_started(claimed.id, token, generation + 1) THEN RAISE EXCEPTION 'E6_B3A stale generation marked'; END IF;
  marked := public.mark_job_provider_started(claimed.id, token, generation);
  IF NOT marked THEN RAISE EXCEPTION 'E6_B3A correct marker rejected'; END IF;
  IF public.mark_job_provider_started(claimed.id, token, generation) THEN RAISE EXCEPTION 'E6_B3A duplicate marker accepted'; END IF;
  IF public.complete_job(claimed.id, gen_random_uuid(), generation, now(), NULL) THEN RAISE EXCEPTION 'E6_B3A stale token completed'; END IF;
  IF public.complete_job(claimed.id, token, generation + 1, now(), NULL) THEN RAISE EXCEPTION 'E6_B3A stale generation completed'; END IF;
  completed := public.complete_job(claimed.id, token, generation, now(), NULL);
  IF NOT completed THEN RAISE EXCEPTION 'E6_B3A exact completion rejected'; END IF;

  INSERT INTO public.jobs (id, type, payload, status, next_run_at)
  VALUES ('00000000-0000-0000-0000-000000000702', 'download_media', '{}', 'pending', now());
  SELECT * INTO STRICT claimed FROM public.claim_jobs(1, ARRAY['download_media'], 'e6-owner-b');
  UPDATE public.jobs SET claim_expires_at = now() - interval '1 second', lease_expires_at = now() - interval '1 second' WHERE id = claimed.id;
  recon := public.reconcile_expired_job_claims(10);
  IF (recon->>'requeued')::integer <> 1 THEN RAISE EXCEPTION 'E6_B3A pre-provider expiry was not requeued'; END IF;
  SELECT * INTO STRICT second_claim FROM public.claim_jobs(1, ARRAY['download_media'], 'e6-owner-c');
  IF second_claim.claim_generation <> claimed.claim_generation + 1 OR second_claim.claim_token = claimed.claim_token THEN
    RAISE EXCEPTION 'E6_B3A requeue did not rotate generation/token';
  END IF;

  INSERT INTO public.jobs (id, type, payload, status, next_run_at)
  VALUES ('00000000-0000-0000-0000-000000000703', 'download_media', '{}', 'pending', now());
  SELECT * INTO STRICT claimed FROM public.claim_jobs(1, ARRAY['download_media'], 'e6-owner-d');
  PERFORM public.mark_job_provider_started(claimed.id, claimed.claim_token, claimed.claim_generation);
  UPDATE public.jobs SET claim_expires_at = now() - interval '1 second', lease_expires_at = now() - interval '1 second' WHERE id = claimed.id;
  recon := public.reconcile_expired_job_claims(10);
  IF (recon->>'ambiguous')::integer <> 1 THEN RAISE EXCEPTION 'E6_B3A provider-started expiry was not ambiguous'; END IF;
END $$;

-- X claim/provider-start/complete/fail generation fences and ambiguity.
DO $$
DECLARE
  first jsonb;
  second jsonb;
  did uuid;
  tok uuid;
  gen bigint;
  ok boolean;
BEGIN
  first := public.claim_x_post_delivery('e6-x-post', 'e6', false, 1800);
  IF first->>'claimed' <> 'true' OR first->>'claim_token' IS NULL OR (first->>'claim_generation')::bigint <> 1 THEN
    RAISE EXCEPTION 'E6_B3A X claim missing token/generation';
  END IF;
  did := (first->>'delivery_id')::uuid; tok := (first->>'claim_token')::uuid; gen := (first->>'claim_generation')::bigint;
  IF public.mark_x_delivery_provider_started(did, gen_random_uuid(), gen) THEN RAISE EXCEPTION 'E6_B3A X wrong token marked'; END IF;
  IF public.mark_x_delivery_provider_started(did, tok, gen + 1) THEN RAISE EXCEPTION 'E6_B3A X stale generation marked'; END IF;
  IF NOT public.mark_x_delivery_provider_started(did, tok, gen) THEN RAISE EXCEPTION 'E6_B3A X marker rejected'; END IF;
  IF public.complete_x_post_delivery(did, tok, gen + 1, 'e6-tweet-stale', 0, 0, NULL, now(), 1, NULL, NULL) THEN
    RAISE EXCEPTION 'E6_B3A X stale generation completed';
  END IF;
  ok := public.fail_x_post_delivery(did, tok, gen, 'failed', 'e6-provider-uncertain', NULL, NULL, NULL, 0, 0, NULL);
  IF NOT ok THEN RAISE EXCEPTION 'E6_B3A X fail did not persist ambiguity'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.x_deliveries WHERE id = did AND claim_state = 'ambiguous' AND status = 'failed') THEN
    RAISE EXCEPTION 'E6_B3A X provider-started failure was not ambiguous';
  END IF;
  second := public.claim_x_post_delivery('e6-x-post', 'e6', true, 1800);
  IF second->>'claimed' <> 'false' OR second->>'reason' <> 'ambiguous' THEN RAISE EXCEPTION 'E6_B3A X ambiguous receipt was re-claimed'; END IF;

  -- A newer ordinary receipt must not mask the real provider-started history.
  INSERT INTO public.x_deliveries (id, post_id, status, claim_state, provider_started_at, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000731', 'e6-x-post', 'failed', 'failed', NULL, now(), now())
  ON CONFLICT (id) DO NOTHING;
  second := public.claim_x_post_delivery('e6-x-post', 'e6', true, 1800);
  IF second->>'claimed' <> 'false' OR second->>'reason' <> 'ambiguous' THEN
    RAISE EXCEPTION 'E6_B3A X older ambiguous history was masked by an ordinary receipt';
  END IF;

  -- The durable marker is authoritative even if a later fail call labels the
  -- receipt as an ordinary/retriable failure because it carries a skip reason.
  first := public.claim_x_post_delivery('e6-x-marker-only', 'e6', false, 1800);
  IF first->>'claimed' <> 'true' THEN RAISE EXCEPTION 'E6_B3A X marker-only seed claim failed'; END IF;
  did := (first->>'delivery_id')::uuid; tok := (first->>'claim_token')::uuid; gen := (first->>'claim_generation')::bigint;
  IF NOT public.mark_x_delivery_provider_started(did, tok, gen) THEN RAISE EXCEPTION 'E6_B3A X marker-only provider marker rejected'; END IF;
  ok := public.fail_x_post_delivery(did, tok, gen, 'failed', 'e6-provider-retriable', NULL, now() + interval '15 minutes', 'x_api_retriable', 0, 0, NULL);
  IF NOT ok OR NOT EXISTS (
    SELECT 1 FROM public.x_deliveries
     WHERE id = did AND provider_started_at IS NOT NULL AND claim_state = 'failed'
  ) THEN
    RAISE EXCEPTION 'E6_B3A X marker-only failed state was not persisted';
  END IF;
  second := public.claim_x_post_delivery('e6-x-marker-only', 'e6', true, 1800);
  IF second->>'claimed' <> 'false' OR second->>'reason' <> 'ambiguous' THEN
    RAISE EXCEPTION 'E6_B3A X provider marker history was re-claimed';
  END IF;

  -- A true pre-provider failure remains operator-force-retryable.
  first := public.claim_x_post_delivery('e6-x-ordinary', 'e6', false, 1800);
  IF first->>'claimed' <> 'true' THEN RAISE EXCEPTION 'E6_B3A X ordinary seed claim failed'; END IF;
  did := (first->>'delivery_id')::uuid; tok := (first->>'claim_token')::uuid; gen := (first->>'claim_generation')::bigint;
  ok := public.fail_x_post_delivery(did, tok, gen, 'failed', 'e6-pre-provider', NULL, NULL, 'pre_provider', 0, 0, NULL);
  IF NOT ok OR NOT EXISTS (
    SELECT 1 FROM public.x_deliveries
     WHERE id = did AND provider_started_at IS NULL AND claim_state = 'failed'
  ) THEN
    RAISE EXCEPTION 'E6_B3A X ordinary pre-provider failed state was not persisted';
  END IF;
  first := public.claim_x_post_delivery('e6-x-ordinary', 'e6', true, 1800);
  IF first->>'claimed' <> 'true' THEN
    RAISE EXCEPTION 'E6_B3A X ordinary pre-provider failure was not force-retryable';
  END IF;
END $$;

SELECT 'E6_SQL_ASSERTIONS_PASS' AS result;
