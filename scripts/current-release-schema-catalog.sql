BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT jsonb_build_object(
 'contract','xot-public-schema-catalog-capture-v1',
 'captured_at',clock_timestamp(),
 'database_version',version(),
 'schema','public',
 'namespace',(SELECT jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl) FROM pg_namespace WHERE nspname='public'),
 'relations',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl,'options',c.reloptions) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
 'columns',(SELECT jsonb_agg(jsonb_build_object('relation',c.relname,'position',a.attnum,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl) ORDER BY c.relname,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m','f')),
 'functions',(SELECT jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'definition',pg_get_functiondef(p.oid)) ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('relation',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid,true),'validated',c.convalidated) ORDER BY c.conrelid::regclass::text,c.conname) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'),
 'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.tablename,i.indexname) FROM pg_indexes i WHERE schemaname='public'),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname) FROM pg_policies p WHERE schemaname='public'),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('relation',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true)) ORDER BY c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal),
 'views',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'definition',pg_get_viewdef(c.oid,true)) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m')),
 'sequences',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'type',format_type(s.seqtypid,NULL),'start',s.seqstart,'increment',s.seqincrement,'max',s.seqmax,'min',s.seqmin,'cache',s.seqcache,'cycle',s.seqcycle) ORDER BY c.relname) FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
 'enum_values',(SELECT jsonb_agg(jsonb_build_object('type',t.typname,'label',e.enumlabel,'order',e.enumsortorder) ORDER BY t.typname,e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'),
 'default_acls',(SELECT jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'object_type',d.defaclobjtype,'acl',d.defaclacl)) FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname='public' OR d.defaclnamespace=0)
) AS schema_capture;
COMMIT;
