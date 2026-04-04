
CREATE TABLE public.digests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_start timestamp with time zone NOT NULL,
  period_end timestamp with time zone NOT NULL,
  post_ids text[] DEFAULT '{}'::text[],
  summary_text text,
  twitter_tweet_ids text[] DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'pending',
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.digests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view digests"
  ON public.digests FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage digests"
  ON public.digests FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_digests_status ON public.digests (status);
CREATE INDEX idx_digests_period_start ON public.digests (period_start DESC);
