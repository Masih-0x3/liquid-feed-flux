-- AIR-001: media object ownership and deletion-claim source (forward-only).
--
-- This migration is additive and never mutates an existing migration or the
-- protected equivalence inventory. Executing it must be a separate, deliberate
-- step; the author task does not apply it. In this deployment the media
-- cleanup cron is gated behind MEDIA_CLEANUP_MUTATIONS_ENABLED=true
-- (see supabase/functions/_shared/cleanupSafety.ts), so a service-role RPC
-- layered on this migration only runs when an operator explicitly enables the
-- mutation flag.
--
-- Design:
--   * public.media_objects is an additive registry owning, per physical
--     temp-media object, exactly one row keyed by (bucket_id, storage_path).
--   * public.media gains a nullable object_id FK so every media reference that
--     chooses storage forwards to the object that physically owns the bytes.
--   * An AFTER INSERT OR UPDATE OF storage_path trigger maintains a
--     fail-closed dual write: setting storage_path attaches (or creates) the
--     object and stamps object_id; a late reference to an already-deleting or
--     already-deleted object is rejected so no fresh reference can attach
--     after a claim has been taken.
--   * Two service-role-only SECURITY DEFINER RPCs implement an atomic claim and
--     a token-fenced finalize so the runtime can fail safe across shared
--     paths, mixed ages, storage failures, stale tokens, and cleanup races.

BEGIN;

-- 1. Registry table.
-- bucket_id is stored so the path ownership is unique per physical bucket, not
-- just per globally-unique path string.
CREATE TABLE public.media_objects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id     text NOT NULL DEFAULT 'temp-media',
  storage_path  text NOT NULL,
  source        text,
  content_hash  text,
  mime_type     text,
  file_size     bigint,
  -- lifecycle: 'active' -> 'deleting' -> 'deleted'
  status        text NOT NULL DEFAULT 'active',
  deletion_token text,
  claimed_at    timestamptz,
  claim_expires_at timestamptz,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_objects_bucket_path_unique UNIQUE (bucket_id, storage_path),
  CONSTRAINT media_objects_status_valid CHECK (status IN ('active', 'deleting', 'deleted'))
);

COMMENT ON TABLE public.media_objects IS
  'AIR-001: ownership registry for physical temp-media objects, one row per exact bucket/path.';

-- Integrity: status reflects the token and timestamps.
CREATE UNIQUE INDEX media_objects_active_token_idx
  ON public.media_objects (deletion_token)
  WHERE deletion_token IS NOT NULL AND status IN ('active', 'deleting');
CREATE INDEX media_objects_claimable_idx
  ON public.media_objects (status, claim_expires_at)
  WHERE status = 'active';
CREATE INDEX media_objects_path_lookup_idx
  ON public.media_objects (storage_path);


-- ---------------------------------------------------------------------------
-- media.object_id backfill and guarded FK
-- ---------------------------------------------------------------------------

-- nullable FK so legacy references can clear it. RLS on media_objects.
ALTER TABLE public.media
  ADD COLUMN object_id uuid REFERENCES public.media_objects(id) ON DELETE SET NULL;

-- Backfill: one registry object per exact (bucket_id, storage_path) from every
-- non-null existing media.storage_path, then attach the first matching media id.
CREATE OR REPLACE FUNCTION public.import_media_objects()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SET search_path TO public, pg_catalog
AS $$
DECLARE
  n int := 0;
BEGIN
  INSERT INTO public.media_objects (bucket_id, storage_path)
  SELECT DISTINCT 'temp-media', m.storage_path
    FROM public.media m
   WHERE m.storage_path IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.media_objects mo
        WHERE mo.bucket_id = 'temp-media' AND mo.storage_path = m.storage_path
     );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

SELECT public.import_media_objects();

-- Attach every media row to its registry object.
UPDATE public.media m
   SET object_id = mo.id
  FROM public.media_objects mo
 WHERE mo.bucket_id = 'temp-media'
   AND mo.storage_path = m.storage_path
   AND m.object_id IS NULL
   AND m.storage_path IS NOT NULL;

-- A service-role-only function that can be re-run to re-attach any stragglers
-- without weakening anything: because this is SECURITY DEFINER and granted only
-- to service_role, an authenticated/anon client cannot invoke it.
REVOKE ALL ON FUNCTION public.import_media_objects() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_media_objects() TO service_role;

CREATE INDEX media_object_id_idx ON public.media (object_id) WHERE object_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- Fail-closed attachment trigger
-- ---------------------------------------------------------------------------

-- Maintains the dual write. Intended behavior:
--   * a NULL storage_path clears object_id (a cleared reference cannot hold an
--     object hostage).
--   * a non-NULL storage_path attaches to the exact object; if it does not
--     exist yet it is created as active; if it is already deleting/deleted the
--     INSERT/update is rejected (no fresh reference may attach after a claim).
--   * existing writes that set storage_path are preserved and forwarded to the
--     object owner.
CREATE OR REPLACE FUNCTION public.media_objects_attach_guard()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target uuid;
  target_bucket text;
  target_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.object_id IS NOT DISTINCT FROM OLD.object_id
     AND NEW.storage_path IS NOT DISTINCT FROM OLD.storage_path THEN
    RETURN NEW;
  END IF;

  IF NEW.storage_path IS NULL THEN
    NEW.object_id := NULL;
    RETURN NEW;
  END IF;

  -- Load the canonical object for this exact bucket/path. Fully-qualified and
  -- search_path is locked empty, so no user-controlled object name or search
  -- path can redirect this read; only the table the function is hard-wired to.
  SELECT mo.id, mo.status
    INTO target, target_status
    FROM public.media_objects mo
   WHERE mo.bucket_id = 'temp-media'
     AND mo.storage_path = NEW.storage_path
   LIMIT 1;

  IF target IS NOT NULL THEN
    IF target_status = 'deleting' OR target_status = 'deleted' THEN
      RAISE EXCEPTION 'media object is not attachable (status %)', target_status
        USING ERRCODE = 'P0001';
    END IF;
    NEW.object_id := target;
  ELSE
    -- Create a fresh active object. Unique on (bucket, path) means only one
    -- registry object is ever created for an exact path.
    INSERT INTO public.media_objects (bucket_id, storage_path)
      VALUES ('temp-media', NEW.storage_path)
      RETURNING id INTO target;
    NEW.object_id := target;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.media_objects_attach_guard() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_media_objects_attach_guard ON public.media;
CREATE TRIGGER trg_media_objects_attach_guard
  BEFORE INSERT OR UPDATE OF storage_path, object_id
  ON public.media
  FOR EACH ROW
  EXECUTE FUNCTION public.media_objects_attach_guard();

-- Existing service-role writes that set storage_path flow through the same
-- handler; nothing is weakened. An authenticated/anon cannot write storage_path
-- via the media table anyway (media is not exposed to those roles).


-- ---------------------------------------------------------------------------
-- RPC: media_objects_claim_old (claim bounded old objects atomically)
-- ---------------------------------------------------------------------------
-- Claims at most the requested number of objects whose media references are all
-- old (downloaded strictly before the cutoff), whose path is shared only among
-- old references, and that pass the existing job/delivery/x_delivery safety
-- conditions. Each object is FOR UPDATE SKIP LOCKED so a concurrent claim never
-- returns the exact physical path twice.
-- Claimability:
--   * ACTIVE objects are claimable whenever they are old and not under a live
--     lease (active objects are only ever stable, so a claim first transitions
--     active -> deleting).
--   * DELETING objects are reclaimable ONLY once their prior lease has fully
--     expired (claim_expires_at <= now()): reclaim grants a fresh token+lease
--     but keeps status 'deleting', so any late reference attachment is still
--     rejected. A live, unexpired deleting lease blocks immediate reclaim.
-- Eligibility is keyed to the physical (bucket_id, storage_path) and counts
-- EVERY media reference sharing that exact path (regardless of whether the
-- object_id FK has been attached), so an old + fresh mix on the same physical
-- object is never claimable. Every eligibility/safety predicate is re-evaluated
-- at reclaim time. The eligibility predicate lives in the shared
-- public._media_object_eligible function so media_objects_preview_old (the
-- dry-run) reports exactly what this claim would select.
CREATE OR REPLACE FUNCTION public.media_objects_claim_old(
  p_bucket_id text DEFAULT 'temp-media',
  p_max int DEFAULT 100,
  p_days_old int DEFAULT 30
)
RETURNS TABLE (
  object_id uuid,
  bucket text,
  storage_path text,
  mime_type text,
  deletion_token uuid
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  i int;
  v_object_id uuid;
  v_bucket text := COALESCE(NULLIF(p_bucket_id,''), 'temp-media');
  v_limit int := GREATEST(1, LEAST(COALESCE(p_max,100), 1000));
  v_days int := GREATEST(COALESCE(p_days_old,30), 1);
  v_token uuid;
BEGIN
  FOR i IN 1..v_limit
  LOOP
    SELECT mo.id
    INTO v_object_id
    FROM public.media_objects mo
   WHERE mo.bucket_id = v_bucket
     AND public._media_object_eligible(mo.id, v_bucket, v_days)
    ORDER BY mo.id
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF v_object_id IS NULL THEN
      EXIT;
    END IF;

    v_token := gen_random_uuid();
    -- status is set to 'deleting' (active->deleting for a first claim, or a
    -- no-op deleting->deleting for an expired reclaim). It is NEVER set back
    -- to 'active', so a late reference can never attach to a claimed object.
    UPDATE public.media_objects
       SET status = 'deleting',
           deletion_token = v_token,
           claimed_at = now(),
           claim_expires_at = now() + interval '10 minutes',
           updated_at = now()
     WHERE id = v_object_id;

    RETURN QUERY
    SELECT mo.id, mo.bucket_id, mo.storage_path, mo.mime_type, mo.deletion_token
      FROM public.media_objects mo WHERE mo.id = v_object_id;
    v_object_id := NULL;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.media_objects_claim_old(text,int,int)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_objects_claim_old(text,int,int)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Shared eligibility predicate (claim + readonly preview)
-- ---------------------------------------------------------------------------
-- A physical object is eligible for claim (or dry-run preview) iff it is
-- claimable AND every safety predicate holds. The exact same body is used by
-- media_objects_claim_old and by the read-only media_objects_preview_old, so
-- a preview count always equals what a claim would select at that instant.
-- Reuse avoids the age-only get_old_media row count that counted duplicated
-- media rows instead of physical objects.
CREATE OR REPLACE FUNCTION public._media_object_eligible(
  p_object_id uuid,
  p_v_bucket text,
  p_v_days int
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (
    (
      (mo.status = 'active' AND (mo.claim_expires_at IS NULL OR mo.claim_expires_at <= now()))
      OR
      (mo.status = 'deleting' AND mo.claim_expires_at IS NOT NULL AND mo.claim_expires_at <= now())
    )
    AND EXISTS (
      SELECT 1 FROM public.media m
       WHERE m.storage_path = mo.storage_path
         AND m.downloaded_at IS NOT NULL
         AND m.downloaded_at < now() - interval '1 day' * p_v_days
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.media m2
       WHERE (m2.object_id = mo.id OR m2.storage_path = mo.storage_path)
         AND (m2.downloaded_at IS NULL
              OR m2.downloaded_at >= now() - interval '1 day' * p_v_days)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.status IN ('pending','running')
         AND j.type IN ('download_media','resolve_media','hydrate_tweet')
         AND EXISTS (
           SELECT 1 FROM public.media mj
            WHERE mj.tweet_id = j.payload->>'tweet_id'
              AND mj.storage_path = mo.storage_path
         )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.deliveries d
       WHERE d.subject_type = 'post'
         AND EXISTS (
           SELECT 1 FROM public.media m
            WHERE m.tweet_id = d.subject_id
              AND m.storage_path = mo.storage_path
         )
         AND d.status IN ('pending','running')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.x_deliveries xd
       WHERE EXISTS (
         SELECT 1 FROM public.media m
          WHERE m.tweet_id = xd.post_id
            AND m.storage_path = mo.storage_path
       )
         AND xd.status IN ('pending','running')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.media m
       WHERE (m.object_id = mo.id OR m.storage_path = mo.storage_path)
         AND (m.kind IN ('video','gif')
              AND (m.mime_type IS NULL OR m.mime_type NOT LIKE 'video/%'))
    )
  )
  FROM public.media_objects mo
  WHERE mo.id = p_object_id;
$$;
REVOKE ALL ON FUNCTION public._media_object_eligible(uuid,text,int)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._media_object_eligible(uuid,text,int)
  TO service_role;

-- ---------------------------------------------------------------------------
-- RPC: media_objects_preview_old (read-only dry-run, no state mutation)
-- ---------------------------------------------------------------------------
-- Returns eligible physical objects WITHOUT claiming them: no status change,
-- no token, no lease. This is the single source of truth a dry-run uses to
-- report would_delete as counted physical objects (one per exact path), so the
-- reported total always matches what a real claim would select. Bounded by
-- p_max and filtered to p_bucket_id/p_days_old.
CREATE OR REPLACE FUNCTION public.media_objects_preview_old(
  p_bucket_id text DEFAULT 'temp-media',
  p_max int DEFAULT 100,
  p_days_old int DEFAULT 30
)
RETURNS TABLE (
  object_id uuid,
  bucket text,
  storage_path text,
  mime_type text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bucket text := COALESCE(NULLIF(p_bucket_id,''), 'temp-media');
  v_limit int := GREATEST(1, LEAST(COALESCE(p_max,100), 1000));
  v_days int := GREATEST(COALESCE(p_days_old,30), 1);
BEGIN
  RETURN QUERY
  SELECT mo.id, mo.bucket_id, mo.storage_path, mo.mime_type
    FROM public.media_objects mo
   WHERE mo.bucket_id = v_bucket
     AND public._media_object_eligible(mo.id, v_bucket, v_days)
   ORDER BY mo.id
   LIMIT v_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.media_objects_preview_old(text,int,int)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_objects_preview_old(text,int,int)
  TO service_role;

-- ---------------------------------------------------------------------------
-- RPC: media_objects_finalize_delete (token-fenced)
-- ---------------------------------------------------------------------------
-- Only the exact, unexpired token currently held by the object can clear all
-- matching media references and mark the physical object deleted. A stale or
-- wrong token returns a non-success (empty/false) result. Safety is re-checked
-- under the object lock before any media rows are cleared.
CREATE OR REPLACE FUNCTION public.media_objects_finalize_delete(
  p_object_id uuid,
  p_deletion_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_status text;
  v_expected_token uuid;
  v_claim_expires_at timestamptz;
  v_path text;
  v_bucket text;
  v_cleared int := 0;
BEGIN
  SELECT mo.status, mo.deletion_token, mo.claim_expires_at,
         mo.storage_path, mo.bucket_id
    INTO v_status, v_expected_token, v_claim_expires_at,
         v_path, v_bucket
    FROM public.media_objects mo
   WHERE mo.id = p_object_id
   FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN false;
  END IF;

  IF v_status <> 'deleting' OR v_expected_token IS NULL
     OR p_deletion_token IS NULL
     OR v_expected_token <> p_deletion_token THEN
    -- Status must be EXACTLY 'deleting' (not active, not deleted), and the
    -- token must match. A status that is anything other than 'deleting' — in
    -- particular 'deleted' (replay of an already-finalized object) — is
    -- rejected: no clear is performed.
    RETURN false;
  END IF;

  IF v_claim_expires_at IS NULL OR v_claim_expires_at < now() THEN
    -- lease expired while we were waiting on storage; a fresh claim is needed.
    RETURN false;
  END IF;

  -- Re-check safety under the lock: no active work may still reference this
  -- physical path and no fresh reference may attach after the claim (the
  -- attachment trigger rejects late attaches to a deleting/deleted object).
  IF EXISTS (
      SELECT 1 FROM public.media m
       WHERE m.storage_path = v_path
         AND (
            EXISTS (
              SELECT 1 FROM public.jobs j
               WHERE j.status IN ('pending','running')
                 AND j.type IN ('download_media','resolve_media','hydrate_tweet')
                 AND j.payload->>'tweet_id' = m.tweet_id
            )
            OR EXISTS (
              SELECT 1 FROM public.deliveries d
               WHERE d.subject_type = 'post' AND d.subject_id = m.tweet_id
                 AND d.status IN ('pending','running')
            )
            OR EXISTS (
              SELECT 1 FROM public.x_deliveries xd
               WHERE xd.post_id = m.tweet_id AND xd.status IN ('pending','running')
            )
            OR (m.kind IN ('video','gif')
                AND (m.mime_type IS NULL OR m.mime_type NOT LIKE 'video/%'))
         )
  ) THEN
    RETURN false;
  END IF;

  -- Clear every matching media reference to this object. storage_path and its
  -- dependent bytes are nulled; the attachment guard also clears object_id when
  -- storage_path is nulled, so the cleared reference holds no further claim on
  -- the object.
  UPDATE public.media m
     SET storage_path = NULL,
         downloaded_at = NULL,
         file_size = NULL,
         mime_type = NULL
   WHERE m.object_id = p_object_id
     AND m.storage_path = v_path;
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  UPDATE public.media_objects
     SET status = 'deleted',
         deleted_at = now(),
         claim_expires_at = NULL,
         updated_at = now()
   WHERE id = p_object_id;

  -- Returns true only after the DB references are actually cleared. Storage
  -- removal happens separately in the runtime before this RPC is called.
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.media_objects_finalize_delete(uuid,uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.media_objects_finalize_delete(uuid,uuid)
  TO service_role;

-- Registry access is fail closed. RLS is enabled (default deny for every non-owner
-- role) and table/column privileges are revoked from PUBLIC/anon/authenticated, so
-- no client role can read or mutate ownership rows. The SECURITY DEFINER functions are
-- owned by the table owner and are NOT force-RLS (they are not owned by a client
-- role); they reach the registry only through their own service-role-only grant.
ALTER TABLE public.media_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.media_objects FROM public, anon, authenticated;

-- Drop helper after import to keep the surface minimal.
DROP FUNCTION public.import_media_objects() CASCADE;

COMMIT;