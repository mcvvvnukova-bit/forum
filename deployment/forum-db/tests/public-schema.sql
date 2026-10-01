\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.persons') IS NULL THEN RAISE EXCEPTION 'public.persons is missing'; END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('public','information_schema')) THEN
    RAISE EXCEPTION 'Application schemas outside public remain';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE name='003_public_schema') THEN
    RAISE EXCEPTION 'Missing consolidation migration marker';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosrc ~ '\m(iam|profiles|audit|integration)\.') THEN
    RAISE EXCEPTION 'Stale schema reference in function source';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated) THEN
    RAISE EXCEPTION 'Unvalidated constraint';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='persons' AND is_generated='ALWAYS') <> 32 THEN
    RAISE EXCEPTION 'Profile projections were lost';
  END IF;
  IF has_schema_privilege('forum_app','public','CREATE')
     OR NOT has_table_privilege('forum_app','public.persons','INSERT')
     OR has_table_privilege('forum_app','public.persons','DELETE')
     OR has_table_privilege('forum_sber_sandbox_app','public.persons','SELECT')
     OR has_function_privilege('forum_sber_sandbox_app','public.valid_sber_profile(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Runtime privilege boundary changed';
  END IF;
END $$;
\echo Public schema, profile projections, constraints and runtime permissions passed.
