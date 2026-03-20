-- Drop the partial unique index that doesn't work with Supabase JS upsert
DROP INDEX IF EXISTS jobs_idempotency_key_unique;

-- Add a proper unique constraint on idempotency_key (allows NULLs, which are not considered duplicates)
ALTER TABLE public.jobs ADD CONSTRAINT jobs_idempotency_key_unique UNIQUE (idempotency_key);