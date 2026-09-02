-- E7 / AIR-009: remove browser-facing defaults from every public-schema
-- default-ACL owner without changing service_role defaults.
--
-- The owner set is discovered from the catalog rather than assuming a single
-- owner. ALTER DEFAULT PRIVILEGES requires authority over each discovered
-- owner. Hosted Supabase migrations run as a managed database role, so the
-- platform-owned supabase_admin ACL is the only documented non-controllable
-- exception. Every other non-controllable owner fails closed.
BEGIN;

DO $$
DECLARE
  owner_name name;
BEGIN
  FOR owner_name IN
    SELECT DISTINCT owner_role.rolname
    FROM pg_default_acl AS defaults
    JOIN pg_roles AS owner_role
      ON owner_role.oid = defaults.defaclrole
    JOIN pg_namespace AS target_schema
      ON target_schema.oid = defaults.defaclnamespace
    CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS acl
    LEFT JOIN pg_roles AS grantee_role
      ON grantee_role.oid = acl.grantee
    WHERE target_schema.nspname = 'public'
      AND defaults.defaclobjtype IN ('r', 'S', 'f')
      AND (
        acl.grantee = 0
        OR grantee_role.rolname IN ('anon', 'authenticated')
      )
      AND (
        defaults.defaclobjtype IN ('r', 'S')
        OR acl.privilege_type = 'EXECUTE'
      )
  LOOP
    IF pg_has_role(current_user, owner_name, 'USAGE') THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;',
        owner_name
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated;',
        owner_name
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;',
        owner_name
      );
    ELSIF owner_name = 'supabase_admin' THEN
      -- Provider-managed ACLs cannot be altered by the hosted migration role.
      RAISE NOTICE 'E7 provider-managed default ACL owner skipped: %', owner_name;
    ELSE
      RAISE EXCEPTION 'E7 cannot control browser default ACL owner: %', owner_name
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  controllable_count integer;
  unsupported_owner_count integer;
  offending_details text;
BEGIN
  WITH offending AS (
    SELECT owner_role.rolname AS owner_name,
           defaults.defaclobjtype::text AS objtype,
           CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE COALESCE(grantee_role.rolname, acl.grantee::text) END AS grantee_name,
           acl.privilege_type,
           acl.is_grantable
      FROM pg_default_acl AS defaults
      JOIN pg_roles AS owner_role
        ON owner_role.oid = defaults.defaclrole
      JOIN pg_namespace AS target_schema
        ON target_schema.oid = defaults.defaclnamespace
      CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS acl
      LEFT JOIN pg_roles AS grantee_role
        ON grantee_role.oid = acl.grantee
     WHERE target_schema.nspname = 'public'
       AND defaults.defaclobjtype IN ('r', 'S', 'f')
       AND (
         acl.grantee = 0
         OR grantee_role.rolname IN ('anon', 'authenticated')
       )
       AND (
         defaults.defaclobjtype IN ('r', 'S')
         OR acl.privilege_type = 'EXECUTE'
       )
  )
  SELECT count(*) FILTER (WHERE pg_has_role(current_user, owner_name, 'USAGE')),
         count(*) FILTER (WHERE NOT pg_has_role(current_user, owner_name, 'USAGE') AND owner_name <> 'supabase_admin')
    INTO controllable_count, unsupported_owner_count
    FROM offending;

  IF controllable_count <> 0 OR unsupported_owner_count <> 0 THEN
    SELECT string_agg(
      concat(
        'owner=', owner_id,
        ';objtype=', objtype,
        ';grantee=', grantee_name,
        ';privilege=', privilege_type,
        ';grantable=', is_grantable
      ),
      ' | '
      ORDER BY owner_id, objtype, grantee_name, privilege_type, is_grantable
    )
      INTO offending_details
      FROM (
        SELECT owner_role.rolname AS owner_id,
               defaults.defaclobjtype::text AS objtype,
               CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE COALESCE(grantee_role.rolname, acl.grantee::text) END AS grantee_name,
               acl.privilege_type,
               acl.is_grantable
          FROM pg_default_acl AS defaults
          JOIN pg_roles AS owner_role
            ON owner_role.oid = defaults.defaclrole
          JOIN pg_namespace AS target_schema
            ON target_schema.oid = defaults.defaclnamespace
          CROSS JOIN LATERAL aclexplode(defaults.defaclacl) AS acl
          LEFT JOIN pg_roles AS grantee_role
            ON grantee_role.oid = acl.grantee
         WHERE target_schema.nspname = 'public'
           AND defaults.defaclobjtype IN ('r', 'S', 'f')
           AND (
             acl.grantee = 0
             OR grantee_role.rolname IN ('anon', 'authenticated')
           )
           AND (
             defaults.defaclobjtype IN ('r', 'S')
             OR acl.privilege_type = 'EXECUTE'
           )
           AND (
             pg_has_role(current_user, owner_role.rolname, 'USAGE')
             OR owner_role.rolname <> 'supabase_admin'
           )
         ORDER BY owner_role.rolname, defaults.defaclobjtype, acl.grantee, acl.privilege_type, acl.is_grantable
         LIMIT 20
      ) AS offending;

    IF unsupported_owner_count <> 0 THEN
      RAISE EXCEPTION 'E7 unsupported browser default privilege owner remains: count=% details=%',
        unsupported_owner_count,
        left(COALESCE(offending_details, '<none>'), 2000)
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    RAISE EXCEPTION 'E7 browser default privileges remain for controllable owners: count=% details=%',
      controllable_count,
      left(COALESCE(offending_details, '<none>'), 2000);
  END IF;
END
$$;

COMMIT;
