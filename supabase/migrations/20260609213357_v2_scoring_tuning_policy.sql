-- Tune audience-fit-v2 for the manually rescued regional-security cases.
-- This is configuration/training data only: it does not mutate posts, jobs, deliveries, or X rows.

WITH updated AS (
  SELECT
    s.key,
    jsonb_set(
      s.value,
      '{profiles}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN profile->>'id' = 'iran-first' THEN
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    profile,
                    '{thresholds,adjacent,threshold}',
                    '12.5'::jsonb,
                    true
                  ),
                  '{global_exceptions}',
                  (
                    WITH existing AS (
                      SELECT ge
                      FROM jsonb_array_elements(COALESCE(profile->'global_exceptions', '[]'::jsonb)) AS ge
                    ),
                    tuned AS (
                      SELECT
                        CASE
                          WHEN ge->>'id' IN ('oil_energy', 'major_leader_statement') THEN
                            jsonb_set(ge, '{threshold}', '14'::jsonb, true)
                          ELSE ge
                        END AS ge
                      FROM existing
                    ),
                    mega AS (
                      SELECT jsonb_build_object(
                        'id', 'global_mega_event',
                        'label', 'Global mega-event',
                        'description', 'A globally dominant, exceptional non-Iran story that is important enough for an Iran-first audience to review even without an Iran nexus.',
                        'cap', 18,
                        'threshold', 18,
                        'examples', jsonb_build_array(
                          'major AI company IPO with global market impact',
                          'major migration crisis with worldwide political consequences',
                          'major technology or market shock dominating global attention'
                        )
                      ) AS ge
                      WHERE NOT EXISTS (SELECT 1 FROM existing WHERE ge->>'id' = 'global_mega_event')
                    )
                    SELECT COALESCE(jsonb_agg(ge), '[]'::jsonb)
                    FROM (
                      SELECT ge FROM tuned
                      UNION ALL
                      SELECT ge FROM mega
                    ) all_exceptions
                  ),
                  true
                ),
                '{review_only_exception_ids}',
                (
                  SELECT jsonb_agg(to_jsonb(id))
                  FROM (
                    SELECT DISTINCT id
                    FROM (
                      SELECT jsonb_array_elements_text(COALESCE(profile->'review_only_exception_ids', '[]'::jsonb)) AS id
                      UNION ALL
                      SELECT 'global_mega_event'
                    ) ids
                    ORDER BY id
                  ) deduped
                ),
                true
              )
            ELSE profile
          END
          ORDER BY ord
        )
        FROM jsonb_array_elements(COALESCE(s.value->'profiles', '[]'::jsonb)) WITH ORDINALITY AS p(profile, ord)
      ),
      true
    ) AS value
  FROM public.settings s
  WHERE s.key = 'scoring_policy'
)
UPDATE public.settings s
SET value = updated.value,
    updated_at = now()
FROM updated
WHERE s.key = updated.key;

INSERT INTO public.scoring_examples (
  tweet_id,
  source,
  profile_id,
  text_original,
  author_handle,
  expected_audience_class,
  expected_decision,
  expected_score,
  expected_global_exception_class,
  note
)
SELECT
  p.tweet_id,
  v.source,
  'iran-first',
  p.text_original,
  p.author_handle,
  v.expected_audience_class,
  v.expected_decision,
  v.expected_score,
  v.expected_global_exception_class,
  v.note
FROM (
  VALUES
    ('https://twitter.com/sentdefender/status/2061950744559858029', 'manual_rescue_seed', 'adjacent', 'deliver', 18::numeric, NULL::text, 'regional_escalation: ballistic missile launches toward Saudi Arabia'),
    ('https://twitter.com/Osint613/status/2061951214602854859', 'manual_rescue_seed', 'adjacent', 'deliver', 18::numeric, NULL::text, 'regional_escalation: Saudi air raid sirens'),
    ('https://twitter.com/Osint613/status/2061953605989470635', 'manual_rescue_seed', 'adjacent', 'deliver', 18::numeric, NULL::text, 'regional_escalation: denial of alleged Iranian attacks on Dubai'),
    ('https://twitter.com/Osint613/status/2062735383197052970', 'manual_rescue_seed', 'global_exception', 'deliver', 19::numeric, 'oil_energy', 'oil_shipping: suspected drone attack halting Oman crude loading'),
    ('https://twitter.com/Osint613/status/2064074745948013048', 'manual_rescue_seed', 'adjacent', 'deliver', 19::numeric, NULL::text, 'regional_escalation: Erbil explosions and U.S. fighter patrols'),
    ('https://twitter.com/sentdefender/status/2064092493486965050', 'manual_rescue_seed', 'adjacent', 'deliver', 16::numeric, NULL::text, 'leader_statement: Trump warning Netanyahu in Israel-Iran context'),
    ('https://twitter.com/WatcherGuru/status/2064094523572310326', 'global_pilot_seed', 'global_exception', 'review', 18::numeric, 'global_mega_event', 'broad_global: OpenAI IPO candidate for review-only pilot'),
    ('https://twitter.com/KobeissiLetter/status/2064078959403282610', 'global_pilot_seed', 'global_exception', 'review', 18::numeric, 'global_mega_event', 'broad_global: major AI market move candidate for review-only pilot')
) AS v(tweet_id, source, expected_audience_class, expected_decision, expected_score, expected_global_exception_class, note)
JOIN public.posts p ON p.tweet_id = v.tweet_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.scoring_examples e
  WHERE e.tweet_id = v.tweet_id
    AND e.profile_id = 'iran-first'
    AND e.source = v.source
    AND e.note = v.note
);
