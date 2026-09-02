-- XOT V2 additive runtime-control and activation bridge.
--
-- This migration keeps both known runtime_controls caller contracts alive:
-- production V1 uses singleton_key and Preview/V2 uses singleton_id.  The
-- aliases are made one physical, one-row control record.  No existing RPC is
-- removed or replaced.  V2 callers use explicit wrappers below.
--
-- T1 is the immutable V1 boundary.  T2 is appended only by the explicit
-- service_role activation RPC, using the database clock.  No activation row
-- is seeded by this migration.

BEGIN;

CREATE TABLE IF NOT EXISTS public.runtime_controls (
  singleton_id boolean NOT NULL DEFAULT true CHECK (singleton_id),
  singleton_key boolean NOT NULL DEFAULT true CHECK (singleton_key),
  environment text NOT NULL DEFAULT 'preview'
    CHECK (environment IN ('production', 'preview')),
  dedupe_enabled boolean NOT NULL DEFAULT false,
  translation_enabled boolean NOT NULL DEFAULT false,
  posting_mode text NOT NULL DEFAULT 'blocked'
    CHECK (posting_mode IN ('blocked', 'enabled')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

-- Known starting shapes may have only one of the two singleton aliases.  Add
-- the missing columns and normalize only when the existing row is unambiguous.
ALTER TABLE public.runtime_controls
  ADD COLUMN IF NOT EXISTS singleton_id boolean,
  ADD COLUMN IF NOT EXISTS singleton_key boolean,
  ADD COLUMN IF NOT EXISTS environment text,
  ADD COLUMN IF NOT EXISTS dedupe_enabled boolean,
  ADD COLUMN IF NOT EXISTS translation_enabled boolean,
  ADD COLUMN IF NOT EXISTS posting_mode text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

DO $$
DECLARE
  v_rows bigint;
BEGIN
  SELECT count(*) INTO v_rows FROM public.runtime_controls;
  IF v_rows > 1 THEN
    RAISE EXCEPTION 'runtime_controls_bridge_ambiguous_singleton: % rows', v_rows;
  END IF;

  -- An empty known starting shape has no values to preserve.  Provision one
  -- canonical, blocked row so reads and the V2 admin RPC have an explicit,
  -- fail-closed control record.  This never enables posting.
  IF v_rows = 0 THEN
    INSERT INTO public.runtime_controls (
      singleton_id, singleton_key, environment, dedupe_enabled,
      translation_enabled, posting_mode
    )
    VALUES (true, true, 'preview', false, false, 'blocked');
  END IF;

  -- Fill an absent alias from the known alias.  Do not repair false or
  -- conflicting values: those states fail the migration closed.
  UPDATE public.runtime_controls
  SET singleton_id = COALESCE(singleton_id, singleton_key),
      singleton_key = COALESCE(singleton_key, singleton_id),
      environment = COALESCE(environment, 'preview'),
      dedupe_enabled = COALESCE(dedupe_enabled, false),
      translation_enabled = COALESCE(translation_enabled, false),
      posting_mode = COALESCE(posting_mode, 'blocked'),
      updated_at = COALESCE(updated_at, now())
  WHERE true;

  IF EXISTS (
    SELECT 1 FROM public.runtime_controls
    WHERE singleton_id IS DISTINCT FROM true
       OR singleton_key IS DISTINCT FROM true
       OR environment IS NULL
       OR posting_mode IS NULL
  ) THEN
    RAISE EXCEPTION 'runtime_controls_bridge_invalid_singleton_or_control_row';
  END IF;
END
$$;

ALTER TABLE public.runtime_controls
  ALTER COLUMN singleton_id SET DEFAULT true,
  ALTER COLUMN singleton_id SET NOT NULL,
  ALTER COLUMN singleton_key SET DEFAULT true,
  ALTER COLUMN singleton_key SET NOT NULL,
  ALTER COLUMN environment SET DEFAULT 'preview',
  ALTER COLUMN environment SET NOT NULL,
  ALTER COLUMN dedupe_enabled SET DEFAULT false,
  ALTER COLUMN dedupe_enabled SET NOT NULL,
  ALTER COLUMN translation_enabled SET DEFAULT false,
  ALTER COLUMN translation_enabled SET NOT NULL,
  ALTER COLUMN posting_mode SET DEFAULT 'blocked',
  ALTER COLUMN posting_mode SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
DECLARE
  v_singleton_id_attnum smallint;
  v_singleton_key_attnum smallint;
BEGIN
  SELECT attnum INTO v_singleton_id_attnum
    FROM pg_attribute
   WHERE attrelid = 'public.runtime_controls'::regclass
     AND attname = 'singleton_id' AND NOT attisdropped
     AND atttypid = 'pg_catalog.bool'::regtype;
  SELECT attnum INTO v_singleton_key_attnum
    FROM pg_attribute
   WHERE attrelid = 'public.runtime_controls'::regclass
     AND attname = 'singleton_key' AND NOT attisdropped
     AND atttypid = 'pg_catalog.bool'::regtype;
  IF v_singleton_id_attnum IS NULL OR v_singleton_key_attnum IS NULL THEN
    RAISE EXCEPTION 'runtime_controls_bridge_invalid_singleton_type';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_class AS index_class
      JOIN pg_index AS index_row ON index_row.indexrelid = index_class.oid
     WHERE index_class.relname = 'runtime_controls_singleton_id_bridge_uq'
       AND index_class.relkind = 'i'
       AND NOT (
         index_row.indrelid = 'public.runtime_controls'::regclass
         AND index_row.indisunique AND index_row.indisvalid
         AND index_row.indnatts = 1
         AND index_row.indkey[0] = v_singleton_id_attnum
         AND index_row.indpred IS NULL
         AND regexp_replace(pg_get_indexdef(index_class.oid), '\s+', ' ', 'g') =
             regexp_replace(format(
               'CREATE UNIQUE INDEX %I ON public.runtime_controls USING btree (%I)',
               'runtime_controls_singleton_id_bridge_uq', 'singleton_id'
             ), '\s+', ' ', 'g')
       )
  ) THEN
    RAISE EXCEPTION 'runtime_controls_bridge_singleton_id_index_definition_mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class AS index_class
      JOIN pg_index AS index_row ON index_row.indexrelid = index_class.oid
     WHERE index_class.relname = 'runtime_controls_singleton_id_bridge_uq'
       AND index_class.relkind = 'i'
       AND index_row.indrelid = 'public.runtime_controls'::regclass
       AND index_row.indisunique AND index_row.indisvalid
       AND index_row.indnatts = 1
       AND index_row.indkey[0] = v_singleton_id_attnum
       AND index_row.indpred IS NULL
       AND regexp_replace(pg_get_indexdef(index_class.oid), '\s+', ' ', 'g') =
           regexp_replace(format(
             'CREATE UNIQUE INDEX %I ON public.runtime_controls USING btree (%I)',
             'runtime_controls_singleton_id_bridge_uq', 'singleton_id'
           ), '\s+', ' ', 'g')
  ) THEN
    CREATE UNIQUE INDEX runtime_controls_singleton_id_bridge_uq
      ON public.runtime_controls (singleton_id);
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_class AS index_class
      JOIN pg_index AS index_row ON index_row.indexrelid = index_class.oid
     WHERE index_class.relname = 'runtime_controls_singleton_key_bridge_uq'
       AND index_class.relkind = 'i'
       AND NOT (
         index_row.indrelid = 'public.runtime_controls'::regclass
         AND index_row.indisunique AND index_row.indisvalid
         AND index_row.indnatts = 1
         AND index_row.indkey[0] = v_singleton_key_attnum
         AND index_row.indpred IS NULL
         AND regexp_replace(pg_get_indexdef(index_class.oid), '\s+', ' ', 'g') =
             regexp_replace(format(
               'CREATE UNIQUE INDEX %I ON public.runtime_controls USING btree (%I)',
               'runtime_controls_singleton_key_bridge_uq', 'singleton_key'
             ), '\s+', ' ', 'g')
       )
  ) THEN
    RAISE EXCEPTION 'runtime_controls_bridge_singleton_key_index_definition_mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class AS index_class
      JOIN pg_index AS index_row ON index_row.indexrelid = index_class.oid
     WHERE index_class.relname = 'runtime_controls_singleton_key_bridge_uq'
       AND index_class.relkind = 'i'
       AND index_row.indrelid = 'public.runtime_controls'::regclass
       AND index_row.indisunique AND index_row.indisvalid
       AND index_row.indnatts = 1
       AND index_row.indkey[0] = v_singleton_key_attnum
       AND index_row.indpred IS NULL
       AND regexp_replace(pg_get_indexdef(index_class.oid), '\s+', ' ', 'g') =
           regexp_replace(format(
             'CREATE UNIQUE INDEX %I ON public.runtime_controls USING btree (%I)',
             'runtime_controls_singleton_key_bridge_uq', 'singleton_key'
           ), '\s+', ' ', 'g')
  ) THEN
    CREATE UNIQUE INDEX runtime_controls_singleton_key_bridge_uq
      ON public.runtime_controls (singleton_key);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.runtime_controls'::regclass
      AND conname = 'runtime_controls_dual_singleton_check'
  ) THEN
    ALTER TABLE public.runtime_controls
      ADD CONSTRAINT runtime_controls_dual_singleton_check
      CHECK (singleton_id = true AND singleton_key = true);
  END IF;
END
$$;

-- Keep the existing trigger names and callers.  Every known trigger invokes
-- this function, so replacing its body upgrades both schema shapes without
-- dropping a trigger or changing an RPC signature.
CREATE OR REPLACE FUNCTION public.enforce_runtime_controls_invariants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.singleton_id IS DISTINCT FROM true
     OR NEW.singleton_key IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'runtime_controls requires singleton_id=true and singleton_key=true';
  END IF;
  IF NEW.environment = 'preview' AND NEW.posting_mode <> 'blocked' THEN
    RAISE EXCEPTION 'preview runtime_controls must keep posting_mode=blocked';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.runtime_controls'::regclass
      AND tgname IN ('runtime_controls_invariants', 'trg_runtime_controls_invariants',
                     'runtime_controls_bridge_invariants')
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER runtime_controls_bridge_invariants
      BEFORE INSERT OR UPDATE ON public.runtime_controls
      FOR EACH ROW EXECUTE FUNCTION public.enforce_runtime_controls_invariants();
  END IF;
END
$$;

-- One append-only row per explicit V2 activation.  epoch_id is also the V2
-- generation fence passed by claim wrappers.  T1 is fixed and cannot be
-- changed by an application role or by a later activation.
CREATE TABLE IF NOT EXISTS public.runtime_activation_epochs (
  epoch_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  t1_cutover_at timestamptz NOT NULL DEFAULT TIMESTAMPTZ '2026-08-25 10:36:06.834081+00',
  t2_activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  activation_key text UNIQUE,
  activated_by text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT runtime_activation_epochs_t1_immutable_check
    CHECK (t1_cutover_at = TIMESTAMPTZ '2026-08-25 10:36:06.834081+00'),
  CONSTRAINT runtime_activation_epochs_after_t1_check
    CHECK (t2_activated_at > t1_cutover_at)
);

ALTER TABLE public.runtime_activation_epochs
  ADD COLUMN IF NOT EXISTS t1_cutover_at timestamptz,
  ADD COLUMN IF NOT EXISTS t2_activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS activation_key text,
  ADD COLUMN IF NOT EXISTS activated_by text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

-- Do not silently accept a partial activation table from an interrupted or
-- hand-built deployment.  The epoch identity and all existing boundary rows
-- must be structurally and semantically valid before this bridge continues.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_attribute
     WHERE attrelid = 'public.runtime_activation_epochs'::regclass
       AND attname = 'epoch_id'
       AND NOT attisdropped
       AND atttypid = 'pg_catalog.int8'::regtype
       AND attidentity = 'a'
  ) THEN
    RAISE EXCEPTION 'runtime_activation_epochs_partial_schema: epoch_id must be bigint GENERATED ALWAYS AS IDENTITY';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES ('activation_key'), ('t1_cutover_at'),
                   ('t2_activated_at'), ('created_at')) AS required(name)
     WHERE NOT EXISTS (
       SELECT 1
         FROM pg_attribute AS attribute
        WHERE attribute.attrelid = 'public.runtime_activation_epochs'::regclass
          AND attribute.attname = required.name
          AND NOT attribute.attisdropped
          AND attribute.atttypid = CASE required.name
            WHEN 'activation_key' THEN 'pg_catalog.text'::regtype
            ELSE 'pg_catalog.timestamptz'::regtype
          END
     )
  ) THEN
    RAISE EXCEPTION 'runtime_activation_epochs_partial_schema: activation_key must be text and t1/t2/created_at must be timestamptz';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.runtime_activation_epochs
     WHERE epoch_id IS NULL
        OR t1_cutover_at IS NULL
        OR t2_activated_at IS NULL
        OR created_at IS NULL
        OR t1_cutover_at IS DISTINCT FROM TIMESTAMPTZ '2026-08-25 10:36:06.834081+00'
        OR t2_activated_at <= t1_cutover_at
  ) THEN
    RAISE EXCEPTION 'runtime_activation_epochs_partial_schema: existing rows violate immutable T1 or t2>T1';
  END IF;
END
$$;

ALTER TABLE public.runtime_activation_epochs
  ALTER COLUMN t1_cutover_at SET DEFAULT TIMESTAMPTZ '2026-08-25 10:36:06.834081+00',
  ALTER COLUMN t1_cutover_at SET NOT NULL,
  ALTER COLUMN t2_activated_at SET DEFAULT clock_timestamp(),
  ALTER COLUMN t2_activated_at SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT clock_timestamp(),
  ALTER COLUMN created_at SET NOT NULL;

-- Use the server's parsed expression tree as the semantic reference.  This
-- rejects a same-named constraint containing an OR, a weaker predicate, or a
-- different boundary, without relying on formatting heuristics.
CREATE TEMP TABLE IF NOT EXISTS xot_runtime_epoch_constraint_reference (
  t1_cutover_at timestamptz,
  t2_activated_at timestamptz,
  CONSTRAINT xot_runtime_epoch_reference_t1
    CHECK (t1_cutover_at = TIMESTAMPTZ '2026-08-25 10:36:06.834081+00'),
  CONSTRAINT xot_runtime_epoch_reference_after_t1
    CHECK (t2_activated_at > t1_cutover_at)
) ON COMMIT DROP;

DO $$
DECLARE
  v_epoch_attnum smallint;
  v_activation_key_attnum smallint;
  v_expected boolean;
  v_reference_relid oid := 'pg_temp.xot_runtime_epoch_constraint_reference'::regclass;
  v_expected_t1_expr text;
  v_expected_after_t1_expr text;
  v_existing_expr text;
BEGIN
  SELECT pg_get_expr(conbin, conrelid)
    INTO v_expected_t1_expr
    FROM pg_constraint
   WHERE conrelid = v_reference_relid
     AND conname = 'xot_runtime_epoch_reference_t1';
  SELECT pg_get_expr(conbin, conrelid)
    INTO v_expected_after_t1_expr
    FROM pg_constraint
   WHERE conrelid = v_reference_relid
     AND conname = 'xot_runtime_epoch_reference_after_t1';
  IF v_expected_t1_expr IS NULL OR v_expected_after_t1_expr IS NULL THEN
    RAISE EXCEPTION 'runtime_activation_epochs_constraint_reference_unavailable';
  END IF;

  SELECT attnum INTO v_epoch_attnum
    FROM pg_attribute
   WHERE attrelid = 'public.runtime_activation_epochs'::regclass
     AND attname = 'epoch_id' AND NOT attisdropped;
  SELECT attnum INTO v_activation_key_attnum
    FROM pg_attribute
   WHERE attrelid = 'public.runtime_activation_epochs'::regclass
     AND attname = 'activation_key' AND NOT attisdropped;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.runtime_activation_epochs'::regclass
      AND conname = 'runtime_activation_epochs_pkey'
      AND NOT (contype = 'p' AND conkey = ARRAY[v_epoch_attnum]::smallint[])
  ) THEN
    RAISE EXCEPTION 'runtime_activation_epochs_partial_schema: runtime_activation_epochs_pkey definition mismatch';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.runtime_activation_epochs'::regclass
      AND conname = 'runtime_activation_epochs_pkey'
      AND contype = 'p'
      AND conkey = ARRAY[v_epoch_attnum]::smallint[]
  ) INTO v_expected;
  IF NOT v_expected THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.runtime_activation_epochs'::regclass
        AND contype = 'p'
    ) THEN
      RAISE EXCEPTION 'runtime_activation_epochs_partial_schema: primary key name or definition mismatch';
    END IF;
    ALTER TABLE public.runtime_activation_epochs
      ADD CONSTRAINT runtime_activation_epochs_pkey PRIMARY KEY (epoch_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class AS index_class
    JOIN pg_index AS index_row ON index_row.indexrelid = index_class.oid
    WHERE index_class.relname = 'runtime_activation_epochs_epoch_id_bridge_uq'
      AND index_class.relkind = 'i'
      AND NOT (
        index_row.indrelid = 'public.runtime_activation_epochs'::regclass
        AND index_row.indisunique
        AND index_row.indisvalid
        AND index_row.indnatts = 1
        AND index_row.indkey[0] = v_epoch_attnum
        AND index_row.indpred IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'runtime_activation_epochs_partial_schema: epoch_id bridge index definition mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class AS index_class
    JOIN pg_index AS index_row ON index_row.indexrelid = index_class.oid
    WHERE index_class.relname = 'runtime_activation_epochs_epoch_id_bridge_uq'
      AND index_class.relkind = 'i'
      AND index_row.indrelid = 'public.runtime_activation_epochs'::regclass
      AND index_row.indisunique
      AND index_row.indisvalid
      AND index_row.indnatts = 1
      AND index_row.indkey[0] = v_epoch_attnum
      AND index_row.indpred IS NULL
  ) THEN
    CREATE UNIQUE INDEX runtime_activation_epochs_epoch_id_bridge_uq
      ON public.runtime_activation_epochs (epoch_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.runtime_activation_epochs'::regclass
      AND conname = 'runtime_activation_epochs_activation_key_key'
      AND NOT (
        contype = 'u'
        AND conkey = ARRAY[v_activation_key_attnum]::smallint[]
      )
  ) THEN
    RAISE EXCEPTION 'runtime_activation_epochs_partial_schema: activation key constraint definition mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.runtime_activation_epochs'::regclass
      AND conname = 'runtime_activation_epochs_t1_immutable_check'
  ) THEN
    ALTER TABLE public.runtime_activation_epochs
      ADD CONSTRAINT runtime_activation_epochs_t1_immutable_check
      CHECK (t1_cutover_at = TIMESTAMPTZ '2026-08-25 10:36:06.834081+00');
  ELSE
    SELECT pg_get_expr(conbin, conrelid)
      INTO v_existing_expr
      FROM pg_constraint
     WHERE conrelid = 'public.runtime_activation_epochs'::regclass
       AND conname = 'runtime_activation_epochs_t1_immutable_check';
    IF v_existing_expr IS DISTINCT FROM v_expected_t1_expr THEN
      RAISE EXCEPTION 'runtime_activation_epochs_partial_schema: T1 constraint definition mismatch';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.runtime_activation_epochs'::regclass
      AND conname = 'runtime_activation_epochs_after_t1_check'
  ) THEN
    ALTER TABLE public.runtime_activation_epochs
      ADD CONSTRAINT runtime_activation_epochs_after_t1_check
      CHECK (t2_activated_at > t1_cutover_at);
  ELSE
    SELECT pg_get_expr(conbin, conrelid)
      INTO v_existing_expr
      FROM pg_constraint
     WHERE conrelid = 'public.runtime_activation_epochs'::regclass
       AND conname = 'runtime_activation_epochs_after_t1_check';
    IF v_existing_expr IS DISTINCT FROM v_expected_after_t1_expr THEN
      RAISE EXCEPTION 'runtime_activation_epochs_partial_schema: T2 constraint definition mismatch';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.runtime_activation_epochs'::regclass
      AND conname = 'runtime_activation_epochs_activation_key_key'
  ) THEN
    ALTER TABLE public.runtime_activation_epochs
      ADD CONSTRAINT runtime_activation_epochs_activation_key_key
      UNIQUE (activation_key);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.prevent_runtime_activation_epoch_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'runtime_activation_epochs is append-only';
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'public.runtime_activation_epochs'::regclass
       AND trigger_row.tgname = 'runtime_activation_epochs_immutable'
       AND NOT (
         NOT trigger_row.tgisinternal
         AND trigger_row.tgenabled = 'O'
         AND trigger_row.tgtype = 27
         AND trigger_row.tgfoid = 'public.prevent_runtime_activation_epoch_mutation()'::regprocedure
         AND regexp_replace(pg_get_triggerdef(trigger_row.oid), '\s+', ' ', 'g') ~
             'CREATE TRIGGER runtime_activation_epochs_immutable BEFORE (UPDATE OR DELETE|DELETE OR UPDATE) ON public.runtime_activation_epochs FOR EACH ROW EXECUTE FUNCTION (public\.)?prevent_runtime_activation_epoch_mutation\(\)'
       )
  ) THEN
    RAISE EXCEPTION 'runtime_activation_epochs_immutable_trigger_definition_mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.runtime_activation_epochs'::regclass
      AND tgname = 'runtime_activation_epochs_immutable'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER runtime_activation_epochs_immutable
      BEFORE UPDATE OR DELETE ON public.runtime_activation_epochs
      FOR EACH ROW EXECUTE FUNCTION public.prevent_runtime_activation_epoch_mutation();
  END IF;
END
$$;

ALTER TABLE public.runtime_activation_epochs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.runtime_activation_epochs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.runtime_activation_epochs FROM service_role;
GRANT SELECT ON TABLE public.runtime_activation_epochs TO service_role;
REVOKE ALL ON FUNCTION public.prevent_runtime_activation_epoch_mutation() FROM PUBLIC, anon, authenticated, service_role;

-- Every activation and every V2 claim takes this transaction-scoped lock.
-- The lock is held until the caller transaction ends, so a T2 append cannot
-- occur between a V2 lineage check and its provider-idempotent legacy claim.
CREATE OR REPLACE FUNCTION public.lock_runtime_v2_activation()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('xot.runtime_v2.activation', 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lock_runtime_v2_activation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_runtime_v2_activation() TO service_role;

-- Direct legacy claim RPCs mutate these tables and therefore pass through the
-- existing delivery-cutover triggers.  The `a_` prefix makes this trigger run
-- before the existing `trg_*_delivery_cutover` trigger, so the same advisory
-- fence covers the cutoff read and the mutation.  This keeps V1 behavior
-- unchanged before T2 while preventing activation from crossing a claim.
CREATE OR REPLACE FUNCTION public.lock_runtime_v2_delivery_mutation()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.lock_runtime_v2_activation();
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_runtime_v2_delivery_mutation() FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'public.jobs'::regclass
       AND trigger_row.tgname = 'a_runtime_v2_activation_lock_jobs'
       AND NOT (
         NOT trigger_row.tgisinternal
         AND trigger_row.tgenabled = 'O'
         AND trigger_row.tgtype = 31
         AND trigger_row.tgfoid = 'public.lock_runtime_v2_delivery_mutation()'::regprocedure
         AND regexp_replace(pg_get_triggerdef(trigger_row.oid), '\s+', ' ', 'g') ~
             'CREATE TRIGGER a_runtime_v2_activation_lock_jobs BEFORE (INSERT OR UPDATE OR DELETE|INSERT OR DELETE OR UPDATE|DELETE OR INSERT OR UPDATE|DELETE OR UPDATE OR INSERT|UPDATE OR INSERT OR DELETE|UPDATE OR DELETE OR INSERT) ON public.jobs FOR EACH ROW EXECUTE FUNCTION (public\.)?lock_runtime_v2_delivery_mutation\(\)'
       )
  ) THEN
    RAISE EXCEPTION 'a_runtime_v2_activation_lock_jobs_trigger_definition_mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.jobs'::regclass
      AND tgname = 'a_runtime_v2_activation_lock_jobs'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER a_runtime_v2_activation_lock_jobs
      BEFORE INSERT OR UPDATE OR DELETE ON public.jobs
      FOR EACH ROW EXECUTE FUNCTION public.lock_runtime_v2_delivery_mutation();
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'public.deliveries'::regclass
       AND trigger_row.tgname = 'a_runtime_v2_activation_lock_deliveries'
       AND NOT (
         NOT trigger_row.tgisinternal
         AND trigger_row.tgenabled = 'O'
         AND trigger_row.tgtype = 31
         AND trigger_row.tgfoid = 'public.lock_runtime_v2_delivery_mutation()'::regprocedure
         AND regexp_replace(pg_get_triggerdef(trigger_row.oid), '\s+', ' ', 'g') ~
             'CREATE TRIGGER a_runtime_v2_activation_lock_deliveries BEFORE (INSERT OR UPDATE OR DELETE|INSERT OR DELETE OR UPDATE|DELETE OR INSERT OR UPDATE|DELETE OR UPDATE OR INSERT|UPDATE OR INSERT OR DELETE|UPDATE OR DELETE OR INSERT) ON public.deliveries FOR EACH ROW EXECUTE FUNCTION (public\.)?lock_runtime_v2_delivery_mutation\(\)'
       )
  ) THEN
    RAISE EXCEPTION 'a_runtime_v2_activation_lock_deliveries_trigger_definition_mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.deliveries'::regclass
      AND tgname = 'a_runtime_v2_activation_lock_deliveries'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER a_runtime_v2_activation_lock_deliveries
      BEFORE INSERT OR UPDATE OR DELETE ON public.deliveries
      FOR EACH ROW EXECUTE FUNCTION public.lock_runtime_v2_delivery_mutation();
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'public.x_deliveries'::regclass
       AND trigger_row.tgname = 'a_runtime_v2_activation_lock_x_deliveries'
       AND NOT (
         NOT trigger_row.tgisinternal
         AND trigger_row.tgenabled = 'O'
         AND trigger_row.tgtype = 31
         AND trigger_row.tgfoid = 'public.lock_runtime_v2_delivery_mutation()'::regprocedure
         AND regexp_replace(pg_get_triggerdef(trigger_row.oid), '\s+', ' ', 'g') ~
             'CREATE TRIGGER a_runtime_v2_activation_lock_x_deliveries BEFORE (INSERT OR UPDATE OR DELETE|INSERT OR DELETE OR UPDATE|DELETE OR INSERT OR UPDATE|DELETE OR UPDATE OR INSERT|UPDATE OR INSERT OR DELETE|UPDATE OR DELETE OR INSERT) ON public.x_deliveries FOR EACH ROW EXECUTE FUNCTION (public\.)?lock_runtime_v2_delivery_mutation\(\)'
       )
  ) THEN
    RAISE EXCEPTION 'a_runtime_v2_activation_lock_x_deliveries_trigger_definition_mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.x_deliveries'::regclass
      AND tgname = 'a_runtime_v2_activation_lock_x_deliveries'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER a_runtime_v2_activation_lock_x_deliveries
      BEFORE INSERT OR UPDATE OR DELETE ON public.x_deliveries
      FOR EACH ROW EXECUTE FUNCTION public.lock_runtime_v2_delivery_mutation();
  END IF;
END
$$;

-- The only activation writer.  A non-null activation key makes operator
-- retries idempotent; a null key intentionally requests a fresh epoch.
CREATE OR REPLACE FUNCTION public.activate_runtime_v2(
  p_activation_key text DEFAULT NULL,
  p_activated_by text DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text := left(NULLIF(btrim(p_activation_key), ''), 256);
  v_activated_by text := left(NULLIF(btrim(p_activated_by), ''), 120);
  v_now timestamptz;
  v_t2 timestamptz;
BEGIN
  PERFORM public.lock_runtime_v2_activation();
  v_now := clock_timestamp();

  IF v_now <= TIMESTAMPTZ '2026-08-25 10:36:06.834081+00' THEN
    RAISE EXCEPTION 'runtime_v2_activation_before_t1';
  END IF;

  INSERT INTO public.runtime_activation_epochs (
    t1_cutover_at, t2_activated_at, activation_key, activated_by
  )
  VALUES (
    TIMESTAMPTZ '2026-08-25 10:36:06.834081+00', v_now, v_key, v_activated_by
  )
  ON CONFLICT (activation_key) DO NOTHING
  RETURNING t2_activated_at INTO v_t2;

  IF v_t2 IS NULL AND v_key IS NOT NULL THEN
    SELECT e.t2_activated_at
      INTO v_t2
      FROM public.runtime_activation_epochs AS e
     WHERE e.activation_key = v_key;
  END IF;

  IF v_t2 IS NULL THEN
    RAISE EXCEPTION 'runtime_v2_activation_not_recorded';
  END IF;
  RETURN v_t2;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_runtime_v2(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_runtime_v2(text, text) TO service_role;

-- A unique active maximum is required.  Null/missing lineage, equality with
-- T1/T2, an ambiguous maximum, and an old generation all fail closed.
CREATE OR REPLACE FUNCTION public.runtime_v2_allows_lineage(
  p_lineage_time timestamptz,
  p_epoch_generation bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH latest AS (
    SELECT max(e.t2_activated_at) AS t2_activated_at
      FROM public.runtime_activation_epochs AS e
  ), active AS (
    SELECT e.epoch_id, e.t1_cutover_at, e.t2_activated_at
      FROM public.runtime_activation_epochs AS e
      JOIN latest AS l ON l.t2_activated_at = e.t2_activated_at
  )
  SELECT COALESCE(
    p_lineage_time IS NOT NULL
    AND p_epoch_generation IS NOT NULL
    AND (SELECT count(*) = 1 FROM active)
    AND p_epoch_generation = (SELECT max(a.epoch_id) FROM active AS a)
    AND p_lineage_time > (
      SELECT max(greatest(a.t1_cutover_at, a.t2_activated_at))
        FROM active AS a
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.runtime_v2_allows_lineage(timestamptz, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.runtime_v2_allows_lineage(timestamptz, bigint) TO service_role;

-- Legacy V1 gates remain callable with their original names and signatures.
-- Before T2 this returns the immutable delivery_cutover value exactly as
-- before.  After T2 it returns max(T1, latest active T2), while an ambiguous
-- V1 singleton or ambiguous latest T2 remains fail-closed.
-- The operator cutover scope is explicit: pause V1 claimers and prove zero active/leased claims
-- before appending T2.  After T2, both these legacy DB
-- gates and the V2 wrappers enforce the effective cutoff; V2 wrappers also
-- hold the activation advisory lock across their lineage check and claim.
CREATE OR REPLACE FUNCTION public.get_delivery_cutover()
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
  WITH v1 AS (
    SELECT count(*) AS row_count, max(d.delivery_cutover_at) AS t1
      FROM public.delivery_cutover AS d
  ), epochs AS (
    SELECT max(e.t2_activated_at) AS latest_t2
      FROM public.runtime_activation_epochs AS e
  ), latest AS (
    SELECT e.latest_t2,
           (SELECT count(*)
              FROM public.runtime_activation_epochs AS active
             WHERE active.t2_activated_at = e.latest_t2) AS latest_count
      FROM epochs AS e
  )
  SELECT CASE
    WHEN v1.row_count <> 1 THEN NULL
    WHEN latest.latest_t2 IS NULL THEN v1.t1
    WHEN latest.latest_count <> 1 THEN NULL
    ELSE greatest(
      v1.t1,
      TIMESTAMPTZ '2026-08-25 10:36:06.834081+00',
      latest.latest_t2
    )
  END
    FROM v1 CROSS JOIN latest;
$$;

-- Existing claimers and row triggers consume this helper.  Rebinding this
-- predicate is therefore sufficient to keep direct legacy service_role claim
-- RPCs from admitting lineage at or before T2 after activation.
CREATE OR REPLACE FUNCTION public.delivery_cutover_allows_post(p_tweet_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
  SELECT COALESCE((
    SELECT count(*) = 1
      AND max(p.created_at) > public.get_delivery_cutover()
      AND public.get_delivery_cutover() IS NOT NULL
    FROM public.delivery_cutover AS c
    JOIN public.posts AS p
      ON p.tweet_id = NULLIF(btrim(p_tweet_id), '')
  ), false);
$$;

REVOKE ALL ON FUNCTION public.get_delivery_cutover() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_delivery_cutover() TO service_role;
REVOKE ALL ON FUNCTION public.delivery_cutover_allows_post(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_cutover_allows_post(text) TO service_role;

-- Versioned control RPC.  The legacy update_runtime_controls(boolean,
-- boolean) remains intact and continues to serve V1 callers.
CREATE OR REPLACE FUNCTION public.update_runtime_controls_v2(
  p_dedupe_enabled boolean,
  p_translation_enabled boolean
)
RETURNS public.runtime_controls
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.runtime_controls;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT (SELECT public.current_user_is_admin()) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.runtime_controls
     SET dedupe_enabled = p_dedupe_enabled,
         translation_enabled = p_translation_enabled,
         updated_at = clock_timestamp(),
         updated_by = (SELECT auth.uid())
   WHERE singleton_id = true AND singleton_key = true
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'runtime controls unavailable';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_runtime_controls_v2(boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_runtime_controls_v2(boolean, boolean) TO authenticated;

-- V2 claim wrappers enforce the activation epoch before invoking the legacy,
-- provider-idempotent claimers.  A blocked claim never reaches a provider.
CREATE OR REPLACE FUNCTION public.claim_telegram_delivery_v2(
  p_delivery_key text,
  p_subject_id text,
  p_chat_id text,
  p_lineage_time timestamptz,
  p_epoch_generation bigint,
  p_source text DEFAULT 'v2',
  p_claim_ttl_seconds integer DEFAULT 1800
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.lock_runtime_v2_activation();

  IF NOT public.runtime_v2_allows_lineage(p_lineage_time, p_epoch_generation) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'runtime_v2_cutover_blocked');
  END IF;
  RETURN public.claim_telegram_delivery(
    p_delivery_key, p_subject_id, p_chat_id, p_source, p_claim_ttl_seconds
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_x_post_delivery_v2(
  p_post_id text,
  p_lineage_time timestamptz,
  p_epoch_generation bigint,
  p_source text DEFAULT 'v2',
  p_force_retry boolean DEFAULT false,
  p_claim_ttl_seconds integer DEFAULT 1800
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.lock_runtime_v2_activation();

  IF NOT public.runtime_v2_allows_lineage(p_lineage_time, p_epoch_generation) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'runtime_v2_cutover_blocked');
  END IF;
  RETURN public.claim_x_post_delivery(
    p_post_id, p_source, p_force_retry, p_claim_ttl_seconds
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_telegram_delivery_v2(text, text, text, timestamptz, bigint, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_telegram_delivery_v2(text, text, text, timestamptz, bigint, text, integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.claim_x_post_delivery_v2(text, timestamptz, bigint, text, boolean, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_x_post_delivery_v2(text, timestamptz, bigint, text, boolean, integer)
  TO service_role;

COMMIT;
