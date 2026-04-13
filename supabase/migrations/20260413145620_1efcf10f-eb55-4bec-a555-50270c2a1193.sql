UPDATE public.settings 
SET value = '{
  "enabled": true,
  "default_threshold": 14,
  "editorial_guidelines": "This channel is exclusively focused on Iran and the broader Middle East. Content MUST have a direct connection to Iran, its government, military, economy, sanctions, nuclear program, proxies, or regional conflicts involving Iran. General world news (e.g., US stocks, European politics, China domestic policy) should score 8 or below UNLESS it directly impacts Iran. Only deliver content that a dedicated Iran-watcher would find essential. Major global breaking news (assassinations, nuclear incidents, war declarations) should still score high regardless of region.",
  "priority_topics": ["Iran", "IRGC", "Hormuz", "sanctions", "nuclear", "Hezbollah", "Houthis", "Israel-Iran", "Persian Gulf", "Middle East", "GCC", "Syria", "Iraq", "Yemen", "Pahlavi"],
  "low_priority_topics": ["stocks", "crypto", "earnings", "sports", "entertainment", "EU internal politics", "US domestic", "China domestic", "celebrity", "tech launches", "weather"],
  "score_only": false,
  "filter_mode": "global",
  "author_rules": {}
}'::jsonb,
updated_at = now()
WHERE key = 'content_filter';