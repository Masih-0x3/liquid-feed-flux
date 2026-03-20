-- Boost translate jobs to higher priority so they get processed before download_media
UPDATE public.jobs 
SET priority = 10 
WHERE type = 'translate' 
  AND status = 'pending';