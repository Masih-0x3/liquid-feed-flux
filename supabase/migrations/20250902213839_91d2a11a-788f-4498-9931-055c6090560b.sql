-- Create storage bucket for temporary media storage
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) 
VALUES (
  'temp-media', 
  'temp-media', 
  false, 
  52428800, -- 50MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'audio/mp3', 'audio/wav', 'audio/ogg']
);

-- Create RLS policies for temp media bucket
CREATE POLICY "Service role can manage temp media files" 
ON storage.objects 
FOR ALL 
USING (bucket_id = 'temp-media');

-- Add storage_path column to media table for local file storage
ALTER TABLE public.media 
ADD COLUMN storage_path TEXT,
ADD COLUMN downloaded_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN file_size BIGINT,
ADD COLUMN mime_type TEXT;

-- Create index for cleanup queries
CREATE INDEX idx_media_downloaded_at ON public.media(downloaded_at) WHERE downloaded_at IS NOT NULL;

-- Create function to get media older than specified days
CREATE OR REPLACE FUNCTION public.get_old_media(days_old INTEGER DEFAULT 30)
RETURNS TABLE (
  id UUID,
  storage_path TEXT,
  tweet_id TEXT
) 
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.storage_path, m.tweet_id
  FROM public.media m
  WHERE m.downloaded_at IS NOT NULL 
    AND m.downloaded_at < (NOW() - INTERVAL '1 day' * days_old)
    AND m.storage_path IS NOT NULL;
END;
$$;