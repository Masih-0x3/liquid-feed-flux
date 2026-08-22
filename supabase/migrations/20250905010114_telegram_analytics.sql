-- Telegram Channel Analytics - Complete Database Schema
-- Phase 1: Database Setup for comprehensive analytics system

-- Store channel information and snapshots
CREATE TABLE telegram_channel_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id TEXT NOT NULL,
  title TEXT,
  username TEXT,
  description TEXT,
  member_count INTEGER NOT NULL,
  admin_count INTEGER,
  invite_link TEXT,
  is_verified BOOLEAN DEFAULT FALSE,
  has_protected_content BOOLEAN DEFAULT FALSE,
  snapshot_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track individual member events
CREATE TABLE telegram_member_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id TEXT NOT NULL,
  user_id BIGINT NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  is_bot BOOLEAN DEFAULT FALSE,
  is_premium BOOLEAN DEFAULT FALSE,
  event_type TEXT NOT NULL CHECK (event_type IN ('joined', 'left', 'kicked', 'promoted', 'demoted', 'restricted')),
  event_data JSONB,
  occurred_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track message delivery analytics  
CREATE TABLE telegram_message_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id TEXT REFERENCES posts(tweet_id) ON DELETE CASCADE,  -- References existing posts table
  telegram_message_id TEXT,
  chat_id TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('pending', 'sent', 'failed', 'scheduled')),
  error_code TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  has_media BOOLEAN DEFAULT FALSE,
  media_count INTEGER DEFAULT 0,
  response_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Aggregated daily statistics for performance
CREATE TABLE telegram_daily_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id TEXT NOT NULL,
  date DATE NOT NULL,
  starting_members INTEGER,
  ending_members INTEGER,
  joined_count INTEGER DEFAULT 0,
  left_count INTEGER DEFAULT 0,
  messages_sent INTEGER DEFAULT 0,
  messages_failed INTEGER DEFAULT 0,
  avg_delivery_time_ms INTEGER,
  total_media_sent INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, date)
);

-- Create indexes for performance
CREATE INDEX idx_channel_stats_chat_id ON telegram_channel_stats(chat_id);
CREATE INDEX idx_channel_stats_snapshot ON telegram_channel_stats(snapshot_at DESC);
CREATE INDEX idx_member_events_chat_id ON telegram_member_events(chat_id);
CREATE INDEX idx_member_events_user_id ON telegram_member_events(user_id);
CREATE INDEX idx_member_events_occurred ON telegram_member_events(occurred_at DESC);
CREATE INDEX idx_message_analytics_post_id ON telegram_message_analytics(post_id);
CREATE INDEX idx_message_analytics_status ON telegram_message_analytics(delivery_status);
CREATE INDEX idx_message_analytics_sent_at ON telegram_message_analytics(sent_at DESC);
CREATE INDEX idx_daily_stats_chat_date ON telegram_daily_stats(chat_id, date DESC);

-- View for current channel status
CREATE OR REPLACE VIEW telegram_channel_current AS
SELECT DISTINCT ON (chat_id) 
  chat_id,
  title,
  username,
  member_count,
  admin_count,
  snapshot_at
FROM telegram_channel_stats
ORDER BY chat_id, snapshot_at DESC;

-- View for member growth over time
CREATE OR REPLACE VIEW telegram_member_growth AS
SELECT 
  date,
  chat_id,
  SUM(joined_count - left_count) OVER (PARTITION BY chat_id ORDER BY date) as cumulative_growth,
  joined_count,
  left_count,
  ending_members - starting_members as net_change
FROM telegram_daily_stats
ORDER BY date DESC;

-- View for message performance
CREATE OR REPLACE VIEW telegram_message_performance AS
SELECT 
  DATE(sent_at) as date,
  COUNT(*) as total_messages,
  COUNT(CASE WHEN delivery_status = 'sent' THEN 1 END) as successful,
  COUNT(CASE WHEN delivery_status = 'failed' THEN 1 END) as failed,
  AVG(response_time_ms) as avg_response_time,
  COUNT(CASE WHEN has_media THEN 1 END) as messages_with_media
FROM telegram_message_analytics
WHERE sent_at IS NOT NULL
GROUP BY DATE(sent_at)
ORDER BY date DESC;

-- Function to calculate growth rate
CREATE OR REPLACE FUNCTION calculate_growth_rate(
  p_chat_id TEXT,
  p_days INTEGER DEFAULT 7
) RETURNS TABLE (
  growth_rate NUMERIC,
  total_joined INTEGER,
  total_left INTEGER,
  net_growth INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    CASE 
      WHEN LAG(ending_members) OVER (ORDER BY date) > 0 THEN
        ((ending_members - LAG(ending_members) OVER (ORDER BY date))::NUMERIC / 
         LAG(ending_members) OVER (ORDER BY date)::NUMERIC) * 100
      ELSE 0
    END as growth_rate,
    SUM(joined_count)::INTEGER as total_joined,
    SUM(left_count)::INTEGER as total_left,
    SUM(joined_count - left_count)::INTEGER as net_growth
  FROM telegram_daily_stats
  WHERE chat_id = p_chat_id
    AND date >= CURRENT_DATE - INTERVAL '1 day' * p_days
  GROUP BY ending_members, date
  ORDER BY date DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to get top performing posts
CREATE OR REPLACE FUNCTION get_top_performing_posts(
  p_limit INTEGER DEFAULT 10
) RETURNS TABLE (
  post_id TEXT,
  title TEXT,
  delivery_time_ms INTEGER,
  sent_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ma.post_id,
    p.text_translated::TEXT as title,
    ma.response_time_ms as delivery_time_ms,
    ma.sent_at
  FROM telegram_message_analytics ma
  JOIN posts p ON p.tweet_id = ma.post_id
  WHERE ma.delivery_status = 'sent'
  ORDER BY ma.sent_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Enable Row Level Security
ALTER TABLE telegram_channel_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_member_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_message_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_daily_stats ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users (admin console)
CREATE POLICY "Users can view channel stats" ON telegram_channel_stats FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Users can manage channel stats" ON telegram_channel_stats FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view member events" ON telegram_member_events FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Users can manage member events" ON telegram_member_events FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view message analytics" ON telegram_message_analytics FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Users can manage message analytics" ON telegram_message_analytics FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view daily stats" ON telegram_daily_stats FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Users can manage daily stats" ON telegram_daily_stats FOR ALL USING (auth.uid() IS NOT NULL);

-- Add comments for documentation
COMMENT ON TABLE telegram_channel_stats IS 'Periodic snapshots of channel information and member counts';
COMMENT ON TABLE telegram_member_events IS 'Individual member join/leave/status change events';
COMMENT ON TABLE telegram_message_analytics IS 'Delivery tracking and performance metrics for each message sent';
COMMENT ON TABLE telegram_daily_stats IS 'Daily aggregated statistics for performance and analytics';

COMMENT ON COLUMN telegram_message_analytics.post_id IS 'References tweet_id from posts table matching existing schema';
COMMENT ON COLUMN telegram_member_events.event_data IS 'Additional event context including old/new status and chat info';
COMMENT ON COLUMN telegram_daily_stats.date IS 'Date for aggregated statistics, unique per chat_id';
