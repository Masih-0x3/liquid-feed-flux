-- Keep media replacement and its download job in one transaction. Changed
-- sources receive new row identities so old downloads/renders cannot match them.
BEGIN;
-- Renew only a still-owned live lease. Expired or reclaimed workers must stop.
CREATE OR REPLACE FUNCTION public.renew_rss_webhook_receipt(
  p_receipt_key text, p_claim_token uuid, p_claim_generation bigint
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_catalog AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.webhook_receipts
    SET claim_expires_at = clock_timestamp() + interval '5 minutes', updated_at = clock_timestamp()
    WHERE receipt_key = p_receipt_key AND claim_token = p_claim_token
      AND claim_generation = p_claim_generation AND status = 'materializing'
      AND claim_state = 'received' AND provider_started_at IS NULL
      AND claim_expires_at > clock_timestamp();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.renew_rss_webhook_receipt(text, uuid, bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_rss_webhook_receipt(text, uuid, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.replace_rss_post_media(
  p_tweet_id text, p_media jsonb, p_receipt_key text,
  p_claim_token uuid, p_claim_generation bigint, p_has_video_signal boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_catalog AS $$
DECLARE
  v_item jsonb;
  v_index integer;
  v_needs_download boolean;
  v_download_queued boolean := false;
  v_download_key text;
  v_preserve_video boolean := false;
  v_media_offset integer := 0;
  v_video_count integer;
BEGIN
  IF p_tweet_id IS NULL OR btrim(p_tweet_id) = '' OR p_receipt_key IS NULL
    OR p_media IS NULL OR jsonb_typeof(p_media) <> 'array' OR jsonb_array_length(p_media) > 20 THEN
    RAISE EXCEPTION 'rss_webhook_media_invalid_input';
  END IF;
  PERFORM 1 FROM public.webhook_receipts
    WHERE receipt_key = p_receipt_key AND claim_token = p_claim_token
      AND claim_generation = p_claim_generation AND status = 'materializing'
      AND claim_expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rss_webhook_media_receipt_claim_lost'; END IF;
  PERFORM 1 FROM public.posts WHERE tweet_id = p_tweet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rss_webhook_media_post_missing'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_media) LOOP
    IF jsonb_typeof(v_item) <> 'object' OR COALESCE(v_item->>'kind', '') NOT IN ('image', 'video')
      OR COALESCE(v_item->>'src_url', '') = '' OR COALESCE(v_item->>'src_url_hash', '') !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'rss_webhook_media_invalid_item';
    END IF;
  END LOOP;

  -- An RSS video placeholder has no authoritative video URL. Preserve media
  -- resolved by the dedicated resolver until that resolver supplies a new set.
  IF jsonb_array_length(p_media) > 0 OR NOT COALESCE(p_has_video_signal, false) THEN
    v_preserve_video := COALESCE(p_has_video_signal, false) AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_media) AS incoming(value) WHERE value->>'kind' = 'video'
    );
    IF v_preserve_video THEN
      SELECT count(*)::integer, COALESCE(max(ordering), -1) + 1
        INTO v_video_count, v_media_offset FROM public.media
        WHERE tweet_id = p_tweet_id AND kind = 'video';
      IF v_video_count + jsonb_array_length(p_media) > 20 THEN
        RAISE EXCEPTION 'rss_webhook_media_item_limit_exceeded';
      END IF;
    END IF;
    -- A placeholder is not authority to remove a resolved video. Keep its row
    -- identity and place RSS images after retained videos to avoid slot collisions.
    DELETE FROM public.media m WHERE m.tweet_id = p_tweet_id
      AND NOT (v_preserve_video AND m.kind = 'video') AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_media) WITH ORDINALITY AS incoming(value, position)
      WHERE m.ordering = incoming.position - 1 + v_media_offset
        AND m.src_url_hash = incoming.value->>'src_url_hash'
        AND m.src_url = incoming.value->>'src_url'
        AND m.kind = incoming.value->>'kind'
    );
    FOR v_item, v_index IN
      SELECT value, (ordinality - 1)::integer FROM jsonb_array_elements(p_media) WITH ORDINALITY
    LOOP
      INSERT INTO public.media(tweet_id, kind, src_url, src_url_hash, width, height, duration_ms, ordering)
      VALUES (p_tweet_id, v_item->>'kind', v_item->>'src_url', v_item->>'src_url_hash',
        (v_item->>'width')::integer, (v_item->>'height')::integer, (v_item->>'duration_ms')::integer, v_index + v_media_offset)
      ON CONFLICT (tweet_id, ordering) DO UPDATE SET
        width = EXCLUDED.width, height = EXCLUDED.height, duration_ms = EXCLUDED.duration_ms;
    END LOOP;
  END IF;
  UPDATE public.posts SET has_media = COALESCE(p_has_video_signal, false) OR EXISTS (
    SELECT 1 FROM public.media WHERE tweet_id = p_tweet_id
  ) WHERE tweet_id = p_tweet_id;
  SELECT EXISTS (SELECT 1 FROM public.media
    WHERE tweet_id = p_tweet_id AND (storage_path IS NULL OR downloaded_at IS NULL)) INTO v_needs_download;
  IF v_needs_download THEN
    -- The same receipt may resume after another receipt replaced these rows.
    -- Bind work to this claim generation and actual row identities, not just
    -- the input URL set. MD5 is a compact version label, not an auth boundary.
    SELECT 'download_media:rss:' || p_tweet_id || ':' || p_receipt_key || ':' || p_claim_generation::text || ':' ||
      md5(string_agg(id::text || ':' || COALESCE(src_url_hash, ''), ',' ORDER BY ordering, id))
      INTO v_download_key FROM public.media WHERE tweet_id = p_tweet_id;
    INSERT INTO public.jobs(type, payload, status, priority, idempotency_key, next_run_at)
    VALUES ('download_media', jsonb_build_object('tweet_id', p_tweet_id), 'pending', 12,
      v_download_key, now())
    ON CONFLICT (idempotency_key) DO NOTHING;
    SELECT EXISTS (SELECT 1 FROM public.jobs WHERE idempotency_key = v_download_key
      AND status IN ('pending', 'running')) INTO v_download_queued;
    IF NOT v_download_queued AND EXISTS (SELECT 1 FROM public.media
      WHERE tweet_id = p_tweet_id AND (storage_path IS NULL OR downloaded_at IS NULL)) THEN
      RAISE EXCEPTION 'rss_webhook_media_download_job_terminal';
    END IF;
  END IF;
  RETURN jsonb_build_object('replaced', true, 'download_queued', v_download_queued);
END;
$$;
REVOKE ALL ON FUNCTION public.replace_rss_post_media(text, jsonb, text, uuid, bigint, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_rss_post_media(text, jsonb, text, uuid, bigint, boolean) TO service_role;
COMMIT;
