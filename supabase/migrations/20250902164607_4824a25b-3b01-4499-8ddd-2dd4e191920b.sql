-- Create tables for RSS.app → OpenAI → Telegram pipeline

-- Feeds table
CREATE TABLE public.feeds (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  rssapp_feed_id TEXT,
  rss_url TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Accounts table  
CREATE TABLE public.accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  handle TEXT NOT NULL,
  display_name TEXT,
  lang_src TEXT DEFAULT 'en',
  lang_dst TEXT DEFAULT 'en', 
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_seen_item_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Posts table
CREATE TABLE public.posts (
  tweet_id TEXT NOT NULL PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  url TEXT,
  text_original TEXT,
  text_translated TEXT,
  lang_original TEXT,
  tweeted_at TIMESTAMP WITH TIME ZONE,
  has_media BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Media table
CREATE TABLE public.media (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tweet_id TEXT NOT NULL REFERENCES public.posts(tweet_id) ON DELETE CASCADE,
  kind TEXT CHECK (kind IN ('image', 'video')),
  src_url TEXT,
  width INTEGER,
  height INTEGER, 
  duration_ms INTEGER,
  ordering INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Threads table
CREATE TABLE public.threads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  tweet_ids TEXT[],
  confidence DECIMAL(3,2),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Deliveries table
CREATE TABLE public.deliveries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  subject_type TEXT CHECK (subject_type IN ('post', 'thread')),
  subject_id TEXT NOT NULL,
  telegram_chat_id TEXT,
  telegram_message_ids TEXT[],
  status TEXT CHECK (status IN ('pending', 'posted', 'failed')) DEFAULT 'pending',
  last_error TEXT,
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Moderation events table
CREATE TABLE public.moderation_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  subject_type TEXT CHECK (subject_type IN ('post', 'thread')),
  subject_id TEXT NOT NULL,
  verdict TEXT CHECK (verdict IN ('allow', 'block')),
  categories JSONB,
  reviewer_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Jobs table
CREATE TABLE public.jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB,
  status TEXT CHECK (status IN ('pending', 'running', 'completed', 'failed')) DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  next_run_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users (admin console)
CREATE POLICY "Users can view all feeds" ON public.feeds FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Users can manage feeds" ON public.feeds FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view all accounts" ON public.accounts FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Users can manage accounts" ON public.accounts FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view all posts" ON public.posts FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Users can manage posts" ON public.posts FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view all media" ON public.media FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Users can manage media" ON public.media FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view all threads" ON public.threads FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Users can manage threads" ON public.threads FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view all deliveries" ON public.deliveries FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Users can manage deliveries" ON public.deliveries FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view all moderation events" ON public.moderation_events FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Users can manage moderation events" ON public.moderation_events FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view all jobs" ON public.jobs FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Users can manage jobs" ON public.jobs FOR ALL USING (auth.uid() IS NOT NULL);

-- Create indexes for better performance
CREATE INDEX idx_posts_account_id ON public.posts(account_id);
CREATE INDEX idx_posts_created_at ON public.posts(created_at);
CREATE INDEX idx_media_tweet_id ON public.media(tweet_id);
CREATE INDEX idx_deliveries_status ON public.deliveries(status);
CREATE INDEX idx_jobs_status_next_run ON public.jobs(status, next_run_at);
CREATE INDEX idx_threads_account_id ON public.threads(account_id);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;