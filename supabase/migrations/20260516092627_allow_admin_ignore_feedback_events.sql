ALTER TABLE public.feedback_events
  DROP CONSTRAINT IF EXISTS feedback_events_action_check;

ALTER TABLE public.feedback_events
  ADD CONSTRAINT feedback_events_action_check
  CHECK (action = ANY (ARRAY[
    'force_deliver'::text,
    'force_x'::text,
    'confirm_deliver'::text,
    'confirm_x'::text,
    'dispute_high'::text,
    'dispute_low'::text,
    'not_duplicate'::text,
    'confirm_duplicate'::text,
    'reprocess'::text,
    'edit_translation'::text,
    'translate_only'::text,
    'manual_score'::text,
    'score_too_low'::text,
    'score_too_high'::text,
    'correct_deliver'::text,
    'correct_skip'::text,
    'should_pass_audience'::text,
    'should_skip_audience'::text,
    'wrong_relevance_class'::text,
    'global_exception_worth_covering'::text,
    'not_global_exception'::text,
    'admin_ignore'::text
  ]));
