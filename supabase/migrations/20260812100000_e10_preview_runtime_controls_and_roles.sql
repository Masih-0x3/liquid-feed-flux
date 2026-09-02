-- E10-P1: canonical roles, caller-bound role RPCs, and the server-authoritative
-- runtime control plane. This migration is intentionally forward-only.
-- This shared migration creates zero runtime_controls rows.
-- Staging provisioning inserts exactly one explicit preview row only after the project identity guard.
-- Production provisioning inserts one explicit production row through a separate explicit provisioning step.
-- Neither environment is selected by this migration.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type AS type
    JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = 'public' AND type.typname = 'app_role'
  ) THEN
    CREATE TYPE public.app_role AS ENUM ('admin', 'read_only');
  ELSE
    IF EXISTS (
      SELECT 1 FROM pg_enum AS enum_value
      JOIN pg_type AS type ON type.oid = enum_value.enumtypid
      JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
      WHERE namespace.nspname = 'public' AND type.typname = 'app_role'
        AND enum_value.enumlabel = 'viewer'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_enum AS enum_value
      JOIN pg_type AS type ON type.oid = enum_value.enumtypid
      JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
      WHERE namespace.nspname = 'public' AND type.typname = 'app_role'
        AND enum_value.enumlabel = 'read_only'
    ) THEN
      ALTER TYPE public.app_role RENAME VALUE 'viewer' TO 'read_only';
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_enum AS enum_value
      JOIN pg_type AS type ON type.oid = enum_value.enumtypid
      JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
      WHERE namespace.nspname = 'public' AND type.typname = 'app_role'
        AND enum_value.enumlabel NOT IN ('admin', 'read_only')
    ) THEN
      RAISE EXCEPTION 'public.app_role contains a non-canonical value';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_enum AS enum_value
      JOIN pg_type AS type ON type.oid = enum_value.enumtypid
      JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
      WHERE namespace.nspname = 'public' AND type.typname = 'app_role'
        AND enum_value.enumlabel = 'admin'
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_enum AS enum_value
      JOIN pg_type AS type ON type.oid = enum_value.enumtypid
      JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
      WHERE namespace.nspname = 'public' AND type.typname = 'app_role'
        AND enum_value.enumlabel = 'read_only'
    ) THEN
      RAISE EXCEPTION 'public.app_role is missing a canonical value';
    END IF;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- The enum rename maps historical viewer rows to read_only before duplicates
-- are reduced. An admin row wins over a read_only row for the same user.
WITH ranked_roles AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id
           ORDER BY CASE WHEN role = 'admin'::public.app_role THEN 0 ELSE 1 END,
                    created_at ASC,
                    id ASC
         ) AS row_number
  FROM public.user_roles
)
DELETE FROM public.user_roles AS user_role
USING ranked_roles
WHERE user_role.id = ranked_roles.id
  AND ranked_roles.row_number > 1;

DO $$
DECLARE
  -- Existing deployments had id as the primary key and user_id as part of a
  -- composite unique constraint. The source audit found no FK references to
  -- id, so retain it as a unique compatibility key and promote user_id.
  id_attnum smallint;
  user_id_attnum smallint;
  referenced_id boolean;
  constraint_name text;
BEGIN
    SELECT attribute.attnum
      INTO id_attnum
      FROM pg_attribute AS attribute
     WHERE attribute.attrelid = 'public.user_roles'::regclass
       AND attribute.attname = 'id'
       AND NOT attribute.attisdropped;

    IF id_attnum IS NULL THEN
      ALTER TABLE public.user_roles ADD COLUMN id uuid;
      UPDATE public.user_roles SET id = gen_random_uuid() WHERE id IS NULL;
      ALTER TABLE public.user_roles ALTER COLUMN id SET DEFAULT gen_random_uuid();
      ALTER TABLE public.user_roles ALTER COLUMN id SET NOT NULL;
      SELECT attribute.attnum
        INTO id_attnum
        FROM pg_attribute AS attribute
       WHERE attribute.attrelid = 'public.user_roles'::regclass
         AND attribute.attname = 'id'
         AND NOT attribute.attisdropped;
    END IF;

    SELECT attribute.attnum
      INTO user_id_attnum
      FROM pg_attribute AS attribute
     WHERE attribute.attrelid = 'public.user_roles'::regclass
       AND attribute.attname = 'user_id'
       AND NOT attribute.attisdropped;

    SELECT EXISTS (
      SELECT 1
        FROM pg_constraint AS constraint_row
       WHERE constraint_row.confrelid = 'public.user_roles'::regclass
         AND constraint_row.contype = 'f'
         AND id_attnum = ANY (constraint_row.confkey)
    ) INTO referenced_id;

    IF referenced_id THEN
      RAISE EXCEPTION 'user_roles.id is referenced by a foreign key; role primary-key conversion is unsafe';
    END IF;

    FOR constraint_name IN
      SELECT constraint_row.conname
        FROM pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = 'public.user_roles'::regclass
         AND constraint_row.contype IN ('p', 'u')
         AND constraint_row.conname <> 'user_roles_id_key'
         AND EXISTS (
           SELECT 1
             FROM unnest(constraint_row.conkey) AS key_attnum
             JOIN pg_attribute AS attribute
               ON attribute.attrelid = constraint_row.conrelid
              AND attribute.attnum = key_attnum
            WHERE attribute.attname = 'user_id'
         )
    LOOP
      EXECUTE format('ALTER TABLE public.user_roles DROP CONSTRAINT %I', constraint_name);
    END LOOP;

    -- Drop the old id primary key as well. Its name is not assumed.
    FOR constraint_name IN
      SELECT constraint_row.conname
        FROM pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = 'public.user_roles'::regclass
         AND constraint_row.contype = 'p'
    LOOP
      EXECUTE format('ALTER TABLE public.user_roles DROP CONSTRAINT %I', constraint_name);
    END LOOP;

    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = 'public.user_roles'::regclass
         AND constraint_row.contype = 'u'
         AND constraint_row.conkey = ARRAY[id_attnum]::smallint[]
    ) THEN
      ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_id_key UNIQUE (id);
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = 'public.user_roles'::regclass
         AND constraint_row.contype = 'p'
         AND constraint_row.conkey = ARRAY[user_id_attnum]::smallint[]
    ) THEN
      ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id);
    END IF;
END
$$;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage all roles" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_select_own" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_admin_manage" ON public.user_roles;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN (SELECT auth.uid()) IS NULL THEN NULL::public.app_role
    ELSE (
      SELECT user_role.role
      FROM public.user_roles AS user_role
      WHERE user_role.user_id = (SELECT auth.uid())
      LIMIT 1
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN (SELECT auth.uid()) IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.user_roles AS user_role
      WHERE user_role.user_id = (SELECT auth.uid())
        AND user_role.role = 'admin'::public.app_role
    )
  END;
$$;

CREATE POLICY "user_roles_select_own" ON public.user_roles
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "user_roles_admin_manage" ON public.user_roles
  FOR ALL TO authenticated
  USING ((SELECT public.current_user_is_admin()))
  WITH CHECK ((SELECT public.current_user_is_admin()));

REVOKE ALL ON TABLE public.user_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.user_roles TO authenticated;
REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
REVOKE ALL ON FUNCTION public.current_user_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;

CREATE TABLE IF NOT EXISTS public.runtime_controls (
  singleton_id boolean PRIMARY KEY DEFAULT true CHECK (singleton_id),
  environment text NOT NULL CHECK (environment IN ('preview', 'production')),
  dedupe_enabled boolean NOT NULL DEFAULT false,
  translation_enabled boolean NOT NULL DEFAULT false,
  posting_mode text NOT NULL DEFAULT 'blocked' CHECK (posting_mode IN ('blocked', 'enabled')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE OR REPLACE FUNCTION public.enforce_runtime_controls_invariants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.singleton_id IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'runtime controls must use the singleton row';
  END IF;
  IF NEW.environment = 'preview' AND NEW.posting_mode <> 'blocked' THEN
    RAISE EXCEPTION 'preview external posting is always blocked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS runtime_controls_invariants ON public.runtime_controls;
CREATE TRIGGER runtime_controls_invariants
  BEFORE INSERT OR UPDATE ON public.runtime_controls
  FOR EACH ROW EXECUTE FUNCTION public.enforce_runtime_controls_invariants();

ALTER TABLE public.runtime_controls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "runtime_controls_read_authenticated" ON public.runtime_controls;
CREATE POLICY "runtime_controls_read_authenticated" ON public.runtime_controls
  FOR SELECT TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.runtime_controls FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.runtime_controls TO authenticated;

CREATE OR REPLACE FUNCTION public.update_runtime_controls(
  p_dedupe_enabled boolean,
  p_translation_enabled boolean
)
RETURNS public.runtime_controls
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  updated_row public.runtime_controls;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT (SELECT public.current_user_is_admin()) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.runtime_controls
  SET dedupe_enabled = p_dedupe_enabled,
      translation_enabled = p_translation_enabled,
      updated_at = clock_timestamp(),
      updated_by = (SELECT auth.uid())
  WHERE singleton_id = true
  RETURNING * INTO updated_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'runtime controls unavailable';
  END IF;
  RETURN updated_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_runtime_controls(boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_runtime_controls(boolean, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.enforce_runtime_controls_invariants() FROM PUBLIC, anon, authenticated;

COMMIT;
