-- Activation cleanup for the X delivery lifecycle.
--
-- The preceding repair keeps the V1 overloads available while the V2 database
-- objects are pre-staged. Remove them only after activation, leaving the B3
-- generation-fenced lifecycle as the sole completion/failure surface.
BEGIN;

DROP FUNCTION IF EXISTS public.complete_x_post_delivery(
  uuid, uuid, text, integer, bigint, text, timestamptz, integer, jsonb, text
);
DROP FUNCTION IF EXISTS public.fail_x_post_delivery(
  uuid, uuid, text, text, jsonb, timestamptz, text, integer, bigint, text
);

REVOKE ALL ON FUNCTION public.complete_x_post_delivery(
  uuid, uuid, bigint, text, integer, bigint, text, timestamptz, integer, jsonb, text
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_x_post_delivery(
  uuid, uuid, bigint, text, integer, bigint, text, timestamptz, integer, jsonb, text
) TO service_role;

REVOKE ALL ON FUNCTION public.fail_x_post_delivery(
  uuid, uuid, bigint, text, text, jsonb, timestamptz, text, integer, bigint, text
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_x_post_delivery(
  uuid, uuid, bigint, text, text, jsonb, timestamptz, text, integer, bigint, text
) TO service_role;

COMMIT;
