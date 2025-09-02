-- Fix the function search path issue by setting it explicitly
CREATE OR REPLACE FUNCTION trigger_worker_immediately()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SET search_path = 'public'
AS $$
BEGIN
  -- Only trigger for translate and deliver jobs to avoid infinite loops
  IF NEW.type IN ('translate', 'deliver', 'moderate', 'download_media') THEN
    PERFORM net.http_post(
      url := 'https://jzirqfzzvlbxwfzndaer.supabase.co/functions/v1/worker',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6aXJxZnp6dmxieHdmem5kYWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY4MzAxNzgsImV4cCI6MjA3MjQwNjE3OH0.bdVRQeXKONOLTjMlBoa0-MvxMGRVMRGyZS5uynejj4g"}'::jsonb,
      body := '{"trigger": "job_created"}'::jsonb
    );
  END IF;
  RETURN NEW;
END;
$$;