-- Activation cleanup for the X delivery lifecycle.
--
-- The preceding repair keeps the V1 overloads available while the V2 database
-- objects are pre-staged. Remove them only after activation, leaving the B3
-- generation-fenced lifecycle as the sole completion/failure surface.
BEGIN;

-- This migration is activation-only. Refuse to retire the V1 overloads when
-- T2 has not been explicitly recorded, when the V2 caller is not present, or
-- while any old X claim is still in flight. A retry after an uncertain commit
-- therefore fails closed instead of silently widening the retirement window.
DO $xot_v2_retirement_gate$
DECLARE
  active_claims bigint;
BEGIN
  IF to_regclass('public.runtime_activation_epochs') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.runtime_activation_epochs) THEN
    RAISE EXCEPTION 'xot_v2_retirement_requires_activation';
  END IF;
  IF to_regprocedure('public.claim_x_post_delivery_v2(text,timestamptz,bigint,text,boolean,integer)') IS NULL THEN
    RAISE EXCEPTION 'xot_v2_retirement_requires_v2_x_caller';
  END IF;

  SELECT count(*)
    INTO active_claims
    FROM public.x_deliveries
   WHERE status = 'posting'
      OR claim_state IN ('preparing', 'posting');
  IF active_claims > 0 THEN
    RAISE EXCEPTION 'xot_v2_retirement_requires_drained_x_claims: % active claims', active_claims;
  END IF;
END
$xot_v2_retirement_gate$;

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
