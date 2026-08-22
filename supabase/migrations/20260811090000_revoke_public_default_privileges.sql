-- E7 / AIR-009: remove browser-facing defaults from every public-schema
-- default-ACL owner without changing service_role defaults.
--
-- The owner set is discovered from the catalog rather than assuming the
-- managed Supabase owner name.  ALTER DEFAULT PRIVILEGES requires authority
-- over each discovered owner; any insufficient-privilege error must abort the
-- migration instead of being hidden.
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
  END LOOP;
END
$$;

DO $$
DECLARE
  offending_count integer;
  offending_details text;
BEGIN
  SELECT count(*)
    INTO offending_count
    FROM pg_default_acl AS defaults
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
     );

  IF offending_count <> 0 THEN
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
        SELECT defaults.defaclrole::text AS owner_id,
               defaults.defaclobjtype::text AS objtype,
               CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE COALESCE(grantee_role.rolname, acl.grantee::text) END AS grantee_name,
               acl.privilege_type,
               acl.is_grantable
          FROM pg_default_acl AS defaults
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
         ORDER BY defaults.defaclrole, defaults.defaclobjtype, acl.grantee, acl.privilege_type, acl.is_grantable
         LIMIT 20
      ) AS offending;

    RAISE EXCEPTION 'E7 browser default privileges remain: count=% details=%',
      offending_count,
      left(COALESCE(offending_details, '<none>'), 2000);
  END IF;
END
$$;

COMMIT;
