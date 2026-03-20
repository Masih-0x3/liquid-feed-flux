
-- Issue 14: Codify existing telegram analytics views, indexes, and RLS.
-- Tables already exist. Views need DROP + CREATE to handle column order changes.

DROP VIEW IF EXISTS public.telegram_member_growth;
CREATE VIEW public.telegram_member_growth AS
SELECT
  chat_id,
  date,
  joined_count,
  left_count,
  (joined_count - left_count) AS net_change,
  SUM(joined_count - left_count) OVER (PARTITION BY chat_id ORDER BY date) AS cumulative_growth
FROM public.telegram_daily_stats;

DROP VIEW IF EXISTS public.telegram_channel_current;
CREATE VIEW public.telegram_channel_current AS
SELECT chat_id, title, username, member_count, admin_count, snapshot_at
FROM public.telegram_channel_stats
WHERE (chat_id, snapshot_at) IN (
  SELECT chat_id, MAX(snapshot_at)
  FROM public.telegram_channel_stats
  GROUP BY chat_id
);

DROP VIEW IF EXISTS public.telegram_message_performance;
CREATE VIEW public.telegram_message_performance AS
SELECT
  date(sent_at) AS date,
  count(*) AS total_messages,
  count(*) FILTER (WHERE delivery_status = 'sent') AS successful,
  count(*) FILTER (WHERE delivery_status = 'failed') AS failed,
  round(avg(response_time_ms) FILTER (WHERE delivery_status = 'sent'), 0) AS avg_response_time,
  count(*) FILTER (WHERE has_media = true) AS messages_with_media
FROM public.telegram_message_analytics
WHERE sent_at IS NOT NULL
GROUP BY date(sent_at);

-- Indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_tcs_chat_snapshot ON public.telegram_channel_stats (chat_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_tds_chat_date ON public.telegram_daily_stats (chat_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_tme_chat_occurred ON public.telegram_member_events (chat_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_tma_chat_sent ON public.telegram_message_analytics (chat_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_tma_post_id ON public.telegram_message_analytics (post_id);
