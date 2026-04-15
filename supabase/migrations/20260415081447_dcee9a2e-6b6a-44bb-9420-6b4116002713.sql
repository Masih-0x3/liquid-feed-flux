-- Fix settings: drop the broad "Authenticated can view settings" policy, admin-only is sufficient
DROP POLICY IF EXISTS "Authenticated can view settings" ON public.settings;

-- Fix temp-media storage: drop the overly broad public-role policy and add a service_role-only policy
DROP POLICY IF EXISTS "Service role can manage temp-media" ON storage.objects;
DROP POLICY IF EXISTS "Allow public access to temp-media" ON storage.objects;
DROP POLICY IF EXISTS "temp-media access" ON storage.objects;

-- Remove any existing policies on temp-media bucket for public role
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies 
    WHERE tablename = 'objects' AND schemaname = 'storage'
    AND (qual::text LIKE '%temp-media%' OR with_check::text LIKE '%temp-media%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

-- Create restrictive policy for service_role only
CREATE POLICY "Service role manages temp-media"
ON storage.objects
FOR ALL
TO service_role
USING (bucket_id = 'temp-media')
WITH CHECK (bucket_id = 'temp-media');