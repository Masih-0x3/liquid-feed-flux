-- Simplify the translation system to only English -> Persian
-- Remove target_lang completely since we only do EN->FA

-- Update all pending translation jobs to remove target_lang
UPDATE jobs 
SET payload = payload - 'target_lang'
WHERE type = 'translate' 
  AND status = 'pending';

-- Remove lang_dst and lang_src from accounts table since we only do EN->FA
ALTER TABLE accounts DROP COLUMN IF EXISTS lang_dst;
ALTER TABLE accounts DROP COLUMN IF EXISTS lang_src;