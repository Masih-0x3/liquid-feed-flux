-- Add unique constraint for media table to support upserts
ALTER TABLE public.media ADD CONSTRAINT unique_media_tweet_ordering UNIQUE (tweet_id, ordering);

-- Add index for better performance on media queries
CREATE INDEX IF NOT EXISTS idx_media_tweet_storage ON public.media(tweet_id, storage_path);

-- Add index for media download queries
CREATE INDEX IF NOT EXISTS idx_media_download_ready ON public.media(tweet_id) WHERE storage_path IS NULL;