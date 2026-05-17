-- Guard against native X video rows accidentally carrying RSS thumbnail bytes.
-- NOT VALID keeps the migration non-repairing for historical bad rows while
-- still enforcing the rule for future inserts/updates.

ALTER TABLE public.media
  DROP CONSTRAINT IF EXISTS media_kind_check;

ALTER TABLE public.media
  ADD CONSTRAINT media_kind_check
  CHECK (kind IS NULL OR kind IN ('image', 'video', 'gif', 'thumbnail'))
  NOT VALID;

ALTER TABLE public.media
  ADD CONSTRAINT media_video_mime_consistency
  CHECK (
    mime_type IS NULL
    OR kind IS NULL
    OR kind NOT IN ('video', 'gif')
    OR mime_type LIKE 'video/%'
  )
  NOT VALID;
