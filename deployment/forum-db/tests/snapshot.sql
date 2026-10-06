\set ON_ERROR_STOP on
SET search_path=pg_catalog;
SET timezone='UTC';
SET datestyle='ISO, YMD';
-- Read-only catalog/data fingerprint. Ignore only the new migration marker and
-- normalize the intended namespace change; never print application row contents.
CREATE OR REPLACE FUNCTION pg_temp.forum_snapshot() RETURNS SETOF text
LANGUAGE plpgsql AS $$
DECLARE item record; row_count bigint; digest text; last_sequence bigint; called boolean;
BEGIN
  FOR item IN SELECT c.oid,c.relname,n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','iam','profiles','audit','integration') AND c.relkind='r'
  LOOP
    EXECUTE format('SELECT count(*), md5(coalesce(string_agg(md5(to_jsonb(t)::text), %L ORDER BY md5(to_jsonb(t)::text)), %L)) FROM %I.%I t %s',
      '', '', item.nspname,item.relname,CASE WHEN item.relname='schema_migrations' THEN 'WHERE name <> ''003_public_schema''' ELSE '' END)
      INTO row_count,digest;
    RETURN NEXT jsonb_build_object('kind','data','oid',item.oid,'name',item.relname,'count',row_count,'hash',digest)::text;
  END LOOP;
  FOR item IN SELECT c.oid,c.relname,n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','iam','profiles','audit','integration') AND c.relkind='S'
  LOOP
    EXECUTE format('SELECT last_value,is_called FROM %I.%I',item.nspname,item.relname) INTO last_sequence,called;
    RETURN NEXT jsonb_build_object('kind','sequence-state','oid',item.oid,'name',item.relname,'value',last_sequence,'called',called)::text;
  END LOOP;
  RETURN QUERY
    SELECT jsonb_build_object('kind','relation','oid',c.oid,'name',c.relname,'relkind',c.relkind,'owner',c.relowner,'acl',c.relacl,
      'row_security',c.relrowsecurity,'force_row_security',c.relforcerowsecurity)::text
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','iam','profiles','audit','integration');
  RETURN QUERY
    SELECT jsonb_build_object('kind','function','oid',p.oid,'name',p.proname,'owner',p.proowner,'acl',p.proacl,
      'definition',regexp_replace(pg_get_functiondef(p.oid),'\m(iam|profiles|audit|integration)\.', 'public.','g'))::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','iam','profiles','audit','integration') AND p.prokind='f';
  RETURN QUERY
    SELECT jsonb_build_object('kind','constraint','oid',c.oid,'table',c.conrelid,'referenced',c.confrelid,'name',c.conname,
      'validated',c.convalidated,'definition',regexp_replace(pg_get_constraintdef(c.oid),'\m(iam|profiles|audit|integration)\.', 'public.','g'))::text
    FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
    WHERE n.nspname IN ('public','iam','profiles','audit','integration');
  RETURN QUERY
    SELECT jsonb_build_object('kind','column','table',a.attrelid,'number',a.attnum,'name',a.attname,'type',a.atttypid,
      'not_null',a.attnotnull,'generated',a.attgenerated,'identity',a.attidentity,
      'expression',regexp_replace(pg_get_expr(d.adbin,d.adrelid),'\m(iam|profiles|audit|integration)\.', 'public.','g'))::text
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname IN ('public','iam','profiles','audit','integration') AND a.attnum>0 AND NOT a.attisdropped;
  RETURN QUERY
    SELECT jsonb_build_object('kind','trigger','oid',t.oid,'function',t.tgfoid,'enabled',t.tgenabled,
      'definition',regexp_replace(pg_get_triggerdef(t.oid),'\m(iam|profiles|audit|integration)\.', 'public.','g'))::text
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','iam','profiles','audit','integration');
  RETURN NEXT (SELECT jsonb_build_object('kind','public-schema-acl','owner',nspowner,'acl',nspacl)::text FROM pg_namespace WHERE nspname='public');
END $$;
SELECT line FROM pg_temp.forum_snapshot() AS line ORDER BY line;
