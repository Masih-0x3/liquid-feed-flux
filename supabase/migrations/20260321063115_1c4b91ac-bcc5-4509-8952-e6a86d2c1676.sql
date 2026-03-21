
-- Add content filtering columns to posts
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS author_handle text;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS importance_score integer;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS importance_tags text[];
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS delivery_decision text;

-- Index for filtering by author and score
CREATE INDEX IF NOT EXISTS idx_posts_author_handle ON public.posts (author_handle);
CREATE INDEX IF NOT EXISTS idx_posts_importance_score ON public.posts (importance_score);
CREATE INDEX IF NOT EXISTS idx_posts_delivery_decision ON public.posts (delivery_decision);

-- Backfill author_handle from URL for existing posts
UPDATE public.posts 
SET author_handle = substring(url from 'twitter\.com/([^/]+)')
WHERE url LIKE '%twitter.com%' AND author_handle IS NULL;

-- Also handle x.com URLs
UPDATE public.posts 
SET author_handle = substring(url from 'x\.com/([^/]+)')
WHERE url LIKE '%x.com%' AND author_handle IS NULL;
