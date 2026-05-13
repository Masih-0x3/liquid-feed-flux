-- Allow Edge Functions to validate x-internal-token against Vault WEBHOOK_SHARED_SECRET
-- when the Edge env WEBHOOK_SHARED_SECRET is unset or out of sync (pg_cron uses Vault).

CREATE OR REPLACE FUNCTION public.verify_webhook_internal_token(p_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'WEBHOOK_SHARED_SECRET'
      AND decrypted_secret = p_token
  );
$$;

REVOKE ALL ON FUNCTION public.verify_webhook_internal_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_webhook_internal_token(text) TO service_role;

COMMENT ON FUNCTION public.verify_webhook_internal_token(text) IS
  'Returns true if p_token equals Vault secret WEBHOOK_SHARED_SECRET. Used by Edge Functions for pg_cron auth.';
