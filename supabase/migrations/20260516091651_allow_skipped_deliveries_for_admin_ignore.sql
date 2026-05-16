-- Allow admin-reviewed/ignored post deliveries to be closed without turning
-- them into failed/stuck work. Existing code already treats non-pending,
-- non-posted delivery states as terminal.
ALTER TABLE public.deliveries
  DROP CONSTRAINT IF EXISTS deliveries_status_check;

ALTER TABLE public.deliveries
  ADD CONSTRAINT deliveries_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'posted'::text, 'failed'::text, 'skipped'::text]));
