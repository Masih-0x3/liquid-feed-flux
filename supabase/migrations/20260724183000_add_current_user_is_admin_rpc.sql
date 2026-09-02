-- Caller-bound role check for Edge functions. The function accepts no user ID:
-- the only principal it can evaluate is the JWT subject in auth.uid().
CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles AS user_role
    WHERE user_role.user_id = (SELECT auth.uid())
      AND user_role.role = 'admin'::public.app_role
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_is_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;
