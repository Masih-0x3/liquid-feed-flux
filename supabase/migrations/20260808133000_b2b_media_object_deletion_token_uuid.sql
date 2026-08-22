-- AIR-001 successor repair: align the existing deletion-token column with the
-- UUID claim/finalize function contracts without rewriting the accepted source
-- migration. This migration is fail-closed for any pre-existing non-UUID text.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.media_objects
     WHERE deletion_token IS NOT NULL
       AND deletion_token !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
  ) THEN
    RAISE EXCEPTION 'E6_B2B invalid deletion_token values prevent UUID conversion'
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;

ALTER TABLE public.media_objects
  ALTER COLUMN deletion_token TYPE uuid
  USING deletion_token::uuid;
