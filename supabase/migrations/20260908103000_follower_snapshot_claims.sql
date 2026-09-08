-- Serialize snapshot admission and fence abandoned runs without treating a live
-- partial snapshot as an orphan. No provider requests occur inside these RPCs.
BEGIN;
ALTER TABLE public.x_follower_snapshots
  ADD COLUMN claim_token uuid,
  ADD COLUMN claim_expires_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_follower_snapshot(
  p_trigger text, p_force boolean DEFAULT false, p_stale_minutes integer DEFAULT 60
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_catalog AS $$
DECLARE
  v_now timestamptz;
  v_latest public.x_follower_snapshots%ROWTYPE;
  v_id uuid;
  v_token uuid := gen_random_uuid();
BEGIN
  IF p_trigger IS NULL OR p_trigger NOT IN ('manual', 'cron')
    OR p_stale_minutes IS NULL OR p_stale_minutes NOT BETWEEN 1 AND 1440 THEN
    RAISE EXCEPTION 'follower_snapshot_claim_invalid_input';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('x_follower_snapshot_admission', 0));
  v_now := clock_timestamp();
  IF EXISTS (
    SELECT 1 FROM public.x_follower_snapshots
    WHERE status = 'partial' AND error IS NULL
      AND (claim_expires_at > v_now OR
        (claim_expires_at IS NULL AND taken_at > v_now - interval '10 minutes'))
  ) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'snapshot_in_progress');
  END IF;
  UPDATE public.x_follower_snapshots
    SET status = 'failed', error = 'follower_snapshot_claim_expired',
        claim_token = NULL, claim_expires_at = NULL
    WHERE status = 'partial' AND error IS NULL
      AND (claim_expires_at <= v_now OR
        (claim_expires_at IS NULL AND taken_at <= v_now - interval '10 minutes'));

  SELECT * INTO v_latest FROM public.x_follower_snapshots
    WHERE status = 'complete' OR (status = 'partial' AND error IS NOT NULL)
    ORDER BY taken_at DESC LIMIT 1;
  IF p_trigger = 'cron' AND v_latest.taken_at > v_now - interval '23 hours' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'daily_cap');
  END IF;
  IF p_trigger = 'manual' AND NOT COALESCE(p_force, false)
    AND v_latest.taken_at > v_now - make_interval(mins => p_stale_minutes) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'snapshot_recent');
  END IF;
  INSERT INTO public.x_follower_snapshots(trigger, status, claim_token, claim_expires_at)
    VALUES (p_trigger, 'partial', v_token, v_now + interval '2 minutes') RETURNING id INTO v_id;
  RETURN jsonb_build_object('claimed', true, 'snapshot_id', v_id, 'claim_token', v_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_follower_snapshot_claim(p_id uuid, p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_catalog AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.x_follower_snapshots SET claim_expires_at = clock_timestamp() + interval '2 minutes'
    WHERE id = p_id AND claim_token = p_token AND claim_expires_at > clock_timestamp()
      AND status = 'partial' AND error IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_follower_snapshot_claim(
  p_id uuid, p_token uuid, p_status text, p_values jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_catalog AS $$
DECLARE v_count integer;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('complete', 'partial', 'failed')
    OR p_values IS NULL OR jsonb_typeof(p_values) <> 'object'
    OR (p_status <> 'complete' AND NULLIF(p_values->>'error', '') IS NULL) THEN
    RAISE EXCEPTION 'follower_snapshot_finish_invalid_input';
  END IF;
  UPDATE public.x_follower_snapshots SET
    status = p_status,
    follower_count = COALESCE((p_values->>'follower_count')::integer, follower_count),
    following_count = COALESCE((p_values->>'following_count')::integer, following_count),
    follower_ids = CASE WHEN p_values ? 'follower_ids' THEN ARRAY(SELECT jsonb_array_elements_text(p_values->'follower_ids')) ELSE follower_ids END,
    following_ids = CASE WHEN p_values ? 'following_ids' THEN ARRAY(SELECT jsonb_array_elements_text(p_values->'following_ids')) ELSE following_ids END,
    pages_fetched = COALESCE((p_values->>'pages_fetched')::integer, pages_fetched),
    api_calls_used = COALESCE((p_values->>'api_calls_used')::integer, api_calls_used),
    next_token = p_values->>'next_token',
    error = CASE WHEN p_status = 'complete' THEN NULL ELSE left(p_values->>'error', 96) END,
    claim_token = NULL, claim_expires_at = NULL
    WHERE id = p_id AND claim_token = p_token AND claim_expires_at > clock_timestamp()
      AND status = 'partial' AND error IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_follower_snapshot(text, boolean, integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_follower_snapshot_claim(uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_follower_snapshot_claim(uuid, uuid, text, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_follower_snapshot(text, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_follower_snapshot_claim(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_follower_snapshot_claim(uuid, uuid, text, jsonb) TO service_role;
COMMIT;
