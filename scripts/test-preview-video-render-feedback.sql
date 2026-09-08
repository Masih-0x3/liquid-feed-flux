-- Preview-only regression test. All test writes are rolled back.
-- Execute the entire file as one transaction; never remove the identity guard.
BEGIN;
SET LOCAL statement_timeout = '15s';
DO $$
DECLARE
  fixture public.video_renders%ROWTYPE;
  saved record;
  before_count bigint;
  result_count bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.runtime_controls
    WHERE environment = 'preview' AND posting_mode = 'blocked'
      AND NOT translation_enabled AND NOT dedupe_enabled)
    OR EXISTS (SELECT 1 FROM cron.job) THEN
    RAISE EXCEPTION 'Isolated Preview required';
  END IF;
  SELECT r.* INTO STRICT fixture FROM public.video_renders AS r
  JOIN public.posts AS p ON p.tweet_id = r.tweet_id
  WHERE p.tweet_id = 'xot-staging-fixture-0004'
    AND p.author_handle = 'xot_staging_fixture'
    AND p.delivery_decision = 'skip' AND r.status = 'blocked';
  SELECT count(*) INTO before_count FROM public.video_render_feedback AS f
    WHERE f.render_id = fixture.id;

  -- A stale revision must produce no feedback, not an ambiguous-column error.
  SELECT count(*) INTO result_count
  FROM public.save_video_render_feedback_if_current(
    fixture.id, fixture.render_version, fixture.render_revision + 1,
    'needs_review', 'rolled-back regression', '{}'::jsonb, NULL);
  IF result_count <> 0 THEN RAISE EXCEPTION 'stale revision accepted'; END IF;

  SELECT * INTO STRICT saved
  FROM public.save_video_render_feedback_if_current(
    fixture.id, fixture.render_version, fixture.render_revision,
    'needs_review', 'rolled-back regression', '{"test":"qualified-columns"}'::jsonb, NULL);
  IF saved.tweet_id IS DISTINCT FROM fixture.tweet_id
    OR saved.label IS DISTINCT FROM 'needs_review'
    OR saved.note IS DISTINCT FROM 'rolled-back regression'
    OR saved.render_version IS DISTINCT FROM fixture.render_version
    OR saved.render_revision IS DISTINCT FROM fixture.render_revision THEN
    RAISE EXCEPTION 'saved feedback result mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.video_render_feedback AS f
    WHERE f.id = saved.id AND f.render_id = fixture.id
      AND f.metadata->>'test' = 'qualified-columns'
      AND f.metadata->>'render_version' = fixture.render_version
      AND (f.metadata->>'render_revision')::bigint = fixture.render_revision) THEN
    RAISE EXCEPTION 'feedback insert or revision metadata missing';
  END IF;
  SELECT count(*) INTO result_count FROM public.video_render_feedback AS f
    WHERE f.render_id = fixture.id;
  IF result_count <> before_count + 1 THEN RAISE EXCEPTION 'unexpected feedback count'; END IF;
  IF has_function_privilege('authenticated',
    'public.save_video_render_feedback_if_current(uuid,text,bigint,text,text,jsonb,uuid)','EXECUTE')
    OR has_function_privilege('anon',
    'public.save_video_render_feedback_if_current(uuid,text,bigint,text,text,jsonb,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'unprivileged direct RPC access';
  END IF;
END;
$$;
SELECT 'PASS: stale guard, insert, result, metadata, count, direct RPC permissions' AS regression;
ROLLBACK;
