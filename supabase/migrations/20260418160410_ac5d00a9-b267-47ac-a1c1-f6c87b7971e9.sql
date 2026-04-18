UPDATE public.settings
SET value = jsonb_set(value, '{start_posting_from}', to_jsonb(now()::text), true),
    updated_at = now()
WHERE key = 'x_posting_config'
  AND (value->'start_posting_from' IS NULL OR value->>'start_posting_from' = '');