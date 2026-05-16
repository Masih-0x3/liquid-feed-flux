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
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
      ),
      body := '{"trigger": "job_created"}'::jsonb
    );
  END IF;
  RETURN NEW;
END;
$$;
