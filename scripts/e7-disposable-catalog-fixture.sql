-- E7 aggregate boundary fixture.  Assertions intentionally query PostgreSQL
-- catalogs rather than parsing migration text.  This fixture is local-only and
-- makes no claim about a hosted or production database.

DO $$
DECLARE
  target text;
  table_name text;
  required text[];
  missing text[];
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'media_objects', 'webhook_receipts', 'digest_runs', 'jobs', 'x_deliveries',
    'video_renders', 'video_render_feedback', 'video_renderer_heartbeats',
    'manual_video_intakes'
  ] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'E7 catalog table missing: %', table_name;
    END IF;
  END LOOP;

  required := ARRAY['id:uuid:yes', 'bucket_id:text:yes', 'storage_path:text:yes', 'status:text:yes', 'deletion_token:uuid:no', 'claim_expires_at:timestamp with time zone:no'];
  SELECT array_agg(item ORDER BY item) INTO missing
  FROM unnest(required) item
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'media_objects'
      AND NOT a.attisdropped
      AND format('%s:%s:%s', a.attname, format_type(a.atttypid, a.atttypmod), CASE WHEN a.attnotnull THEN 'yes' ELSE 'no' END) = item
  );
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'media_objects exact required column state mismatch: %', missing; END IF;

  required := ARRAY['receipt_key:text:yes', 'auth_mode:text:yes', 'feed_id:text:yes', 'status:text:yes', 'claim_token:uuid:no', 'claim_generation:bigint:yes', 'claim_state:text:yes', 'item_outcomes:jsonb:yes', 'provider_started_at:timestamp with time zone:no'];
  SELECT array_agg(item ORDER BY item) INTO missing
  FROM unnest(required) item
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'webhook_receipts' AND NOT a.attisdropped
      AND format('%s:%s:%s', a.attname, format_type(a.atttypid, a.atttypmod), CASE WHEN a.attnotnull THEN 'yes' ELSE 'no' END) = item
  );
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'webhook_receipts exact required column state mismatch: %', missing; END IF;

  required := ARRAY['run_key:text:yes', 'input_fingerprint:text:yes', 'period_start:timestamp with time zone:yes', 'period_end:timestamp with time zone:yes', 'post_ids:ARRAY:yes', 'state:text:yes', 'claim_token:uuid:no', 'claim_generation:bigint:yes', 'claim_expires_at:timestamp with time zone:no', 'provider_started_at:timestamp with time zone:no', 'output_persisted_at:timestamp with time zone:no', 'output_digest_id:uuid:no', 'output_key:text:no', 'delivery_key:text:yes', 'delivery_state:text:yes'];
  SELECT array_agg(item ORDER BY item) INTO missing
  FROM unnest(required) item
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'digest_runs' AND NOT a.attisdropped
      AND (item = 'post_ids:ARRAY:yes' AND a.attname = 'post_ids' AND a.atttypid = 'text[]'::regtype OR item <> 'post_ids:ARRAY:yes' AND format('%s:%s:%s', a.attname, format_type(a.atttypid, a.atttypmod), CASE WHEN a.attnotnull THEN 'yes' ELSE 'no' END) = item)
  );
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'digest_runs exact required column state mismatch: %', missing; END IF;

  required := ARRAY['locked_by:text:no', 'lease_expires_at:timestamp with time zone:no', 'claim_token:uuid:no', 'claim_generation:bigint:yes', 'claim_state:text:yes', 'provider_started_at:timestamp with time zone:no', 'claim_started_at:timestamp with time zone:no', 'claim_expires_at:timestamp with time zone:no'];
  SELECT array_agg(item ORDER BY item) INTO missing
  FROM unnest(required) item
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'jobs' AND NOT a.attisdropped
      AND format('%s:%s:%s', a.attname, format_type(a.atttypid, a.atttypmod), CASE WHEN a.attnotnull THEN 'yes' ELSE 'no' END) = item
  );
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'jobs fence columns missing: %', missing; END IF;

  required := ARRAY['claim_token:uuid:no', 'claim_source:text:no', 'claim_started_at:timestamp with time zone:no', 'claim_expires_at:timestamp with time zone:no', 'claim_released_at:timestamp with time zone:no', 'claim_release_reason:text:no', 'next_retry_at:timestamp with time zone:no', 'last_claim_error:text:no', 'claim_generation:bigint:yes', 'claim_state:text:yes', 'provider_started_at:timestamp with time zone:no'];
  SELECT array_agg(item ORDER BY item) INTO missing
  FROM unnest(required) item
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'x_deliveries' AND NOT a.attisdropped
      AND format('%s:%s:%s', a.attname, format_type(a.atttypid, a.atttypmod), CASE WHEN a.attnotnull THEN 'yes' ELSE 'no' END) = item
  );
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'x_deliveries fence columns missing: %', missing; END IF;

  required := ARRAY['claim_token:uuid', 'claim_generation:bigint', 'locked_by:text', 'lease_expires_at:timestamp with time zone', 'output_storage_path:text', 'status:text'];
  SELECT array_agg(item ORDER BY item) INTO missing
  FROM unnest(required) item
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'video_renders' AND NOT a.attisdropped
      AND format('%s:%s', a.attname, format_type(a.atttypid, a.atttypmod)) = item
  );
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'video_renders fence/raw columns missing: %', missing; END IF;

  -- Defaults are read from pg_attrdef, never inferred from migration text.
  IF (SELECT pg_get_expr(d.adbin, d.adrelid)
      FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      WHERE n.nspname = 'public' AND c.relname = 'media_objects' AND a.attname = 'status') <> '''active''::text' THEN
    RAISE EXCEPTION 'media_objects.status default drifted';
  END IF;
  IF (SELECT pg_get_expr(d.adbin, d.adrelid)
      FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      WHERE n.nspname = 'public' AND c.relname = 'webhook_receipts' AND a.attname = 'item_outcomes') NOT LIKE '%{}%jsonb%' THEN
    RAISE EXCEPTION 'webhook_receipts.item_outcomes default drifted';
  END IF;
END $$;

DO $$
DECLARE
  actual text;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO actual FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE n.nspname = 'public' AND c.relname = 'webhook_receipts' AND a.attname = 'claim_generation';
  IF actual NOT LIKE '%0%' THEN RAISE EXCEPTION 'webhook claim_generation default drifted'; END IF;
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO actual FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE n.nspname = 'public' AND c.relname = 'digest_runs' AND a.attname = 'post_ids';
  IF actual NOT LIKE '%{}%text[]%' THEN RAISE EXCEPTION 'digest post_ids default drifted'; END IF;
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO actual FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE n.nspname = 'public' AND c.relname = 'digest_runs' AND a.attname = 'delivery_state';
  IF actual <> '''disabled''::text' THEN RAISE EXCEPTION 'digest delivery_state default drifted'; END IF;
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO actual FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE n.nspname = 'public' AND c.relname = 'jobs' AND a.attname = 'claim_state';
  IF actual <> '''idle''::text' THEN RAISE EXCEPTION 'jobs claim_state default drifted'; END IF;
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO actual FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE n.nspname = 'public' AND c.relname = 'x_deliveries' AND a.attname = 'claim_state';
  IF actual <> '''idle''::text' THEN RAISE EXCEPTION 'x_deliveries claim_state default drifted'; END IF;
END $$;

DO $$
DECLARE
  required text[] := ARRAY[
    'delivery_key:text:no', 'claim_token:uuid:no', 'claim_generation:bigint:yes',
    'claim_state:text:yes', 'claim_source:text:no', 'claim_started_at:timestamp with time zone:no',
    'claim_expires_at:timestamp with time zone:no', 'provider_started_at:timestamp with time zone:no',
    'provider_message_ids:ARRAY:no', 'claim_last_error:text:no'
  ];
  missing text[];
BEGIN
  SELECT array_agg(item ORDER BY item) INTO missing
  FROM unnest(required) item
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'deliveries' AND NOT a.attisdropped
      AND (item = 'provider_message_ids:ARRAY:no' AND a.attname = 'provider_message_ids' AND a.atttypid = 'text[]'::regtype OR item <> 'provider_message_ids:ARRAY:no' AND format('%s:%s:%s', a.attname, format_type(a.atttypid, a.atttypmod), CASE WHEN a.attnotnull THEN 'yes' ELSE 'no' END) = item)
  );
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'deliveries Telegram fence columns missing: %', missing; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deliveries_claim_state_check' AND pg_get_constraintdef(oid) LIKE '%ambiguous%') THEN RAISE EXCEPTION 'deliveries claim state constraint missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_deliveries_telegram_delivery_key') THEN RAISE EXCEPTION 'deliveries Telegram key index missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_deliveries_telegram_active_claims') THEN RAISE EXCEPTION 'deliveries Telegram active index missing'; END IF;
END $$;

DO $$
DECLARE
  table_name text;
  policy_count integer;
  rls_enabled boolean;
  client_acl_count integer;
  service_acl_count integer;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['video_renders', 'video_render_feedback', 'video_renderer_heartbeats', 'manual_video_intakes'] LOOP
    SELECT relrowsecurity INTO rls_enabled FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = table_name;
    IF rls_enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'RLS disabled for protected raw table %', table_name; END IF;
    SELECT count(*) INTO policy_count FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name;
    IF policy_count <> 1 THEN RAISE EXCEPTION 'protected raw table % has % policies, expected exactly one', table_name, policy_count; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name AND policyname = CASE table_name WHEN 'video_renders' THEN 'Service role can manage video renders' WHEN 'video_render_feedback' THEN 'Service role can manage video render feedback' WHEN 'video_renderer_heartbeats' THEN 'Service role can manage video renderer heartbeats' ELSE 'Service role can manage manual video intakes' END AND cmd = 'ALL' AND 'service_role' = ANY(roles)) THEN
      RAISE EXCEPTION 'service_role ALL policy missing for protected raw table %', table_name;
    END IF;
    SELECT count(*) INTO client_acl_count
    FROM aclexplode((SELECT relacl FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = table_name)) x
    LEFT JOIN pg_roles r ON r.oid = x.grantee
    WHERE (x.grantee = 0 OR r.rolname IN ('anon', 'authenticated')) AND x.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER');
    IF client_acl_count <> 0 THEN RAISE EXCEPTION 'client table grants remain for protected raw table %', table_name; END IF;
    IF has_table_privilege('anon', format('public.%I', table_name), 'SELECT') OR has_table_privilege('anon', format('public.%I', table_name), 'INSERT') OR has_table_privilege('anon', format('public.%I', table_name), 'UPDATE') OR has_table_privilege('anon', format('public.%I', table_name), 'DELETE') OR has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT') OR has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT') OR has_table_privilege('authenticated', format('public.%I', table_name), 'UPDATE') OR has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE') THEN
      RAISE EXCEPTION 'effective browser table privilege remains for protected raw table %', table_name;
    END IF;
    SELECT count(*) INTO service_acl_count
    FROM aclexplode((SELECT relacl FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = table_name)) x
    JOIN pg_roles r ON r.oid = x.grantee
    WHERE r.rolname = 'service_role' AND x.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER');
    IF service_acl_count <> 7 THEN RAISE EXCEPTION 'service_role table ALL grant missing for protected raw table %', table_name; END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  table_name text;
  client_acl_count integer;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['media_objects', 'webhook_receipts', 'digest_runs'] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = table_name AND NOT c.relrowsecurity) THEN RAISE EXCEPTION 'RLS disabled for fenced table %', table_name; END IF;
    SELECT count(*) INTO client_acl_count
    FROM aclexplode((SELECT relacl FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = table_name)) x
    LEFT JOIN pg_roles r ON r.oid = x.grantee
    WHERE (x.grantee = 0 OR r.rolname IN ('anon', 'authenticated')) AND x.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER');
    IF client_acl_count <> 0 THEN RAISE EXCEPTION 'client table grants remain for service-only fenced table %', table_name; END IF;
    IF has_table_privilege('anon', format('public.%I', table_name), 'SELECT') OR has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT') THEN RAISE EXCEPTION 'effective browser SELECT privilege remains for service-only fenced table %', table_name; END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  table_name text;
  expected_policy text;
  policy_count integer;
  actual_qual text;
  actual_with_check text;
BEGIN
  PERFORM set_config('search_path', 'pg_catalog', true);
  FOREACH table_name IN ARRAY ARRAY['jobs', 'x_deliveries', 'deliveries'] LOOP
    expected_policy := CASE table_name WHEN 'jobs' THEN 'Admins can manage jobs' WHEN 'x_deliveries' THEN 'Admins can manage x_deliveries' ELSE 'Admins can manage deliveries' END;
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = table_name AND NOT c.relrowsecurity) THEN RAISE EXCEPTION 'RLS disabled for admin fenced table %', table_name; END IF;
    SELECT count(*) INTO policy_count FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name;
    IF policy_count <> 1 THEN RAISE EXCEPTION 'admin fenced table % has % policies, expected one', table_name, policy_count; END IF;
    SELECT regexp_replace(regexp_replace(regexp_replace(qual, '\s+', ' ', 'g'), '^\((.*)\)$', '\1'), '\s*([(),])\s*', '\1', 'g'),
           regexp_replace(regexp_replace(regexp_replace(with_check, '\s+', ' ', 'g'), '^\((.*)\)$', '\1'), '\s*([(),])\s*', '\1', 'g')
      INTO actual_qual, actual_with_check
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = table_name AND policyname = expected_policy AND cmd = 'ALL'
       AND roles = ARRAY['authenticated'::name]
     LIMIT 1;
    IF actual_qual IS NULL OR actual_with_check IS NULL
      OR actual_qual <> 'private.has_role((SELECT auth.uid()AS uid),''admin''::public.app_role)'
      OR actual_with_check <> 'private.has_role((SELECT auth.uid()AS uid),''admin''::public.app_role)' THEN
      RAISE EXCEPTION 'exact admin policy missing for % qual=% with_check=%', table_name, left(COALESCE(actual_qual, '<missing>'), 240), left(COALESCE(actual_with_check, '<missing>'), 240);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name AND policyname IN ('Authenticated can view jobs', 'Authenticated can view x_deliveries', 'Authenticated can view deliveries')) THEN
      RAISE EXCEPTION 'broad authenticated view policy remains for %', table_name;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  bad_default integer;
  default_details text;
  renderer_role integer;
BEGIN
  SELECT count(*) INTO bad_default
  FROM pg_default_acl d
  CROSS JOIN LATERAL aclexplode(d.defaclacl) x
  LEFT JOIN pg_roles r ON r.oid = x.grantee
  WHERE d.defaclnamespace = 'public'::regnamespace
    AND d.defaclobjtype IN ('r', 'S', 'f')
    AND (x.grantee = 0 OR r.rolname IN ('anon', 'authenticated'))
    AND (
      d.defaclobjtype IN ('r', 'S')
      OR x.privilege_type = 'EXECUTE'
    );
  WITH offending AS (
    SELECT d.defaclrole::text AS defaclrole_id,
           COALESCE(owner_role.rolname, format('oid:%s', d.defaclrole::text)) AS defaclrole_name,
           CASE WHEN d.defaclnamespace = 0 THEN '<global>' ELSE COALESCE(ns.nspname, '<missing>') END AS namespace_marker,
           d.defaclobjtype::text AS objtype,
           CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE COALESCE(grantee_role.rolname, format('oid:%s', x.grantee::text)) END AS grantee_name,
           x.privilege_type,
           x.is_grantable
    FROM pg_default_acl d
    LEFT JOIN pg_namespace ns ON ns.oid = d.defaclnamespace
    LEFT JOIN pg_roles owner_role ON owner_role.oid = d.defaclrole
    CROSS JOIN LATERAL aclexplode(d.defaclacl) x
    LEFT JOIN pg_roles grantee_role ON grantee_role.oid = x.grantee
    WHERE d.defaclnamespace = 'public'::regnamespace
      AND d.defaclobjtype IN ('r', 'S', 'f')
      AND (x.grantee = 0 OR grantee_role.rolname IN ('anon', 'authenticated'))
      AND (
        d.defaclobjtype IN ('r', 'S')
        OR x.privilege_type = 'EXECUTE'
      )
    ORDER BY d.defaclrole, d.defaclnamespace, d.defaclobjtype, x.grantee, x.privilege_type, x.is_grantable
    LIMIT 20
  )
  SELECT left(COALESCE(string_agg(format('defaclrole=%s[%s];namespace=%s;objtype=%s;grantee=%s;privilege_type=%s;is_grantable=%s', defaclrole_id, defaclrole_name, namespace_marker, objtype, grantee_name, privilege_type, is_grantable), ' | ' ORDER BY defaclrole_id, namespace_marker, objtype, grantee_name, privilege_type, is_grantable), '<none>'), 1000)
    INTO default_details
    FROM offending;
  IF bad_default <> 0 THEN RAISE EXCEPTION 'broad browser future-object default privileges remain: % details=%', bad_default, left(COALESCE(default_details, '<none>'), 1000); END IF;
  SELECT count(*) INTO renderer_role FROM pg_roles WHERE rolname IN ('renderer', 'video_renderer', 'render_worker');
  IF renderer_role <> 0 THEN RAISE EXCEPTION 'renderer database role exists'; END IF;
END $$;

DO $$
DECLARE
  expected text[] := ARRAY[
    'media_objects_claim_old(text,integer,integer)|TABLE(object_id uuid, bucket text, storage_path text, mime_type text, deletion_token uuid)',
    'media_objects_preview_old(text,integer,integer)|TABLE(object_id uuid, bucket text, storage_path text, mime_type text)',
    '_media_object_eligible(uuid,text,integer)|boolean',
    'media_objects_finalize_delete(uuid,uuid)|boolean',
    'reserve_webhook_receipt(text,text,text,integer)|jsonb', 'complete_webhook_receipt(text,uuid,bigint,jsonb)|boolean',
    'fail_webhook_receipt(text,uuid,bigint,text)|boolean', 'reconcile_expired_webhook_receipts(integer)|jsonb',
    'reserve_digest_run(text,text,timestamp with time zone,timestamp with time zone,text[],text,integer)|jsonb',
    'mark_digest_provider_started(text,uuid,bigint)|boolean', 'persist_digest_output(text,uuid,bigint,text,text,jsonb,text)|boolean',
    'persist_skipped_digest(text,uuid,bigint,text,text)|boolean', 'fail_digest_run(text,uuid,bigint,text)|boolean',
    'checkpoint_digest_delivery_disabled(text,text)|boolean',
    'claim_jobs(integer,text[],text)|SETOF public.jobs', 'mark_job_provider_started(uuid,uuid,bigint)|boolean',
    'complete_job(uuid,uuid,bigint,timestamp with time zone,text)|boolean', 'reconcile_expired_job_claims(integer)|jsonb',
    'claim_x_post_delivery(text,text,boolean,integer)|jsonb', 'mark_x_delivery_provider_started(uuid,uuid,bigint)|boolean',
    'complete_x_post_delivery(uuid,uuid,bigint,text,integer,bigint,text,timestamp with time zone,integer,jsonb,text)|boolean',
    'fail_x_post_delivery(uuid,uuid,bigint,text,text,jsonb,timestamp with time zone,text,integer,bigint,text)|boolean',
    'claim_telegram_delivery(text,text,text,text,integer)|jsonb', 'start_telegram_delivery(uuid,uuid,bigint)|boolean',
    'complete_telegram_delivery(uuid,uuid,bigint,text[])|boolean', 'mark_telegram_delivery_ambiguous(uuid,uuid,bigint,text[],text)|boolean',
    '_video_render_should_release(text)|boolean', '_video_render_queue_delivery(text,text)|boolean',
    'enqueue_video_render(text,uuid,text,text)|uuid', 'claim_video_renders(integer,text)|SETOF public.video_renders',
    'claim_video_render_by_id(uuid,text)|SETOF public.video_renders', 'renew_video_render_lease(uuid,text,uuid,bigint,integer)|boolean',
    'complete_video_render(uuid,text,uuid,bigint,text,bigint,text,text,text,jsonb,integer,integer,integer,text,text,text,jsonb)|jsonb',
    'block_video_render(uuid,text,uuid,bigint,text,jsonb,jsonb)|jsonb', 'fail_video_render(uuid,text,uuid,bigint,text,jsonb)|jsonb',
    'mark_video_render_posted(text,integer)|integer', 'get_expired_video_render_paths(integer)|TABLE(id uuid, output_storage_path text)',
    'mark_video_renders_expired(uuid[])|integer',
    'save_video_render_feedback_if_current(uuid,text,bigint,text,text,jsonb,uuid)|TABLE(id uuid, tweet_id text, label text, note text, created_at timestamp with time zone, render_version text, render_revision bigint)'
  ];
  pair text;
  identity text;
  expected_result text;
  fn record;
BEGIN
  PERFORM set_config('search_path', 'pg_catalog', true);
  FOREACH pair IN ARRAY expected LOOP
    identity := format('public.%s', split_part(pair, '|', 1));
    expected_result := split_part(pair, '|', 2);
    SELECT p.*, n.nspname INTO fn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.oid = identity::regprocedure;
    IF fn.oid IS NULL THEN RAISE EXCEPTION 'protected RPC identity missing: %', identity; END IF;
    IF fn.prosecdef IS DISTINCT FROM true THEN RAISE EXCEPTION 'RPC is not SECURITY DEFINER: %', identity; END IF;
    IF fn.proowner IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')) THEN RAISE EXCEPTION 'RPC has browser owner: %', identity; END IF;
    IF fn.proowner NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('supabase_admin', 'postgres')) THEN RAISE EXCEPTION 'RPC owner is not trusted local owner: %', identity; END IF;
    IF NOT (COALESCE(array_to_string(fn.proconfig, ','), '') ~ 'search_path=(""|public(, ?pg_catalog)?$)') THEN RAISE EXCEPTION 'RPC search_path is open: %', identity; END IF;
    IF pg_get_function_result(fn.oid) <> expected_result THEN RAISE EXCEPTION 'RPC return shape drifted: % expected % got %', identity, expected_result, pg_get_function_result(fn.oid); END IF;
    IF has_function_privilege('anon', fn.oid, 'EXECUTE') OR has_function_privilege('authenticated', fn.oid, 'EXECUTE') THEN RAISE EXCEPTION 'browser EXECUTE grant remains: %', identity; END IF;
    IF NOT has_function_privilege('service_role', fn.oid, 'EXECUTE') THEN RAISE EXCEPTION 'service_role RPC grant missing: %', identity; END IF;
  END LOOP;
  IF to_regprocedure('public.complete_x_post_delivery(uuid,uuid,text,integer,bigint,text,timestamp with time zone,integer,jsonb,text)') IS NOT NULL
    OR to_regprocedure('public.fail_x_post_delivery(uuid,uuid,text,text,jsonb,timestamp with time zone,text,integer,bigint,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'old unfenced X overload remains';
  END IF;
  IF to_regprocedure('public.claim_video_renders(integer)') IS NOT NULL
    OR to_regprocedure('public.claim_video_render_by_id(uuid)') IS NOT NULL
    OR to_regprocedure('public.renew_video_render_lease(uuid,text,uuid,bigint)') IS NOT NULL
    OR to_regprocedure('public.complete_video_render(uuid,text,bigint,text,text,text,jsonb,integer,integer,integer,text,text,text)') IS NOT NULL
    OR to_regprocedure('public.block_video_render(uuid,text)') IS NOT NULL
    OR to_regprocedure('public.fail_video_render(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'old unfenced video overload remains';
  END IF;
END $$;

-- Catalog shape for constraints and indexes is checked by identity, not by
-- migration text.  These names are the accepted aggregate boundary surface.
DO $$
DECLARE missing text[];
BEGIN
  SELECT array_agg(expected_name ORDER BY expected_name) INTO missing
  FROM unnest(ARRAY[
    'media_objects_bucket_path_unique', 'media_objects_status_valid',
    'webhook_receipts_status_check', 'webhook_receipts_claim_state_check',
    'digest_runs_input_fingerprint_check', 'digest_runs_output_key_check',
    'digest_runs_state_check', 'digest_runs_delivery_state_check', 'digest_runs_period_check',
    'video_renders_source_version_key', 'video_renders_claim_generation_nonnegative',
    'deliveries_claim_state_check', 'jobs_claim_state_check', 'x_deliveries_claim_state_check'
  ]) expected_name
  WHERE NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' AND c.conname = expected_name);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'expected constraint identities missing: %', missing; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' AND c.conname = 'media_objects_status_valid'
      AND pg_get_constraintdef(c.oid) LIKE '%status%active%deleting%deleted%'
  ) THEN RAISE EXCEPTION 'media_objects status constraint definition drifted'; END IF;
  SELECT array_agg(expected_name ORDER BY expected_name) INTO missing
  FROM unnest(ARRAY[
    'media_objects_active_token_idx', 'media_objects_claimable_idx', 'media_objects_path_lookup_idx',
    'idx_webhook_receipts_claim_expires_at', 'idx_webhook_receipts_feed_auth',
    'digest_runs_active_lease_idx', 'digest_runs_state_updated_idx', 'idx_jobs_claim_expires_at', 'idx_jobs_claim_owner_active',
    'idx_x_deliveries_claim_generation', 'idx_video_renders_status_lease', 'idx_video_renders_tweet_status', 'idx_video_renders_expiry', 'idx_video_renders_blocked',
    'idx_video_render_feedback_render_created', 'idx_video_renderer_heartbeats_seen',
    'idx_manual_video_intakes_status_created', 'idx_manual_video_intakes_tweet_updated', 'idx_manual_video_intakes_created_by', 'uq_manual_video_intakes_active_tweet'
  ]) expected_name
  WHERE NOT EXISTS (SELECT 1 FROM pg_indexes i WHERE i.schemaname = 'public' AND i.indexname = expected_name);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'expected index identities missing: %', missing; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'media_objects_path_lookup_idx' AND indexdef LIKE '%storage_path%') THEN
    RAISE EXCEPTION 'media_objects path index definition drifted';
  END IF;
END $$;

-- Positive service-role representative calls use invalid inputs so the fixture
-- exercises fenced RPC access without creating durable work or provider calls.
BEGIN;
SET LOCAL ROLE service_role;
DO $$
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'positive fixture probes require service_role, got %', current_user; END IF;
END $$;
CREATE TEMP TABLE e7_fixture_counts AS
SELECT (SELECT count(*) FROM public.deliveries) AS deliveries_count,
       (SELECT count(*) FROM public.video_renders) AS renders_count;
SELECT public.media_objects_finalize_delete(NULL::uuid, NULL::uuid);
SELECT public.reserve_webhook_receipt(NULL::text, NULL::text, NULL::text, NULL::integer);
SELECT public.reserve_digest_run(NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::text[], NULL::text, NULL::integer);
SELECT public.claim_x_post_delivery(NULL::text, NULL::text, false, 60);
SELECT public.claim_video_render_by_id(NULL::uuid, 'e7-fixture');
SELECT public.claim_telegram_delivery(NULL::text, NULL::text, NULL::text, NULL::text, NULL::integer);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.deliveries) <> (SELECT deliveries_count FROM e7_fixture_counts)
    OR (SELECT count(*) FROM public.video_renders) <> (SELECT renders_count FROM e7_fixture_counts) THEN
    RAISE EXCEPTION 'positive service-role probes changed durable row counts';
  END IF;
END $$;
ROLLBACK;
