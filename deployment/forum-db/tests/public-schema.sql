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
-- Pin the complete runtime table matrix, including negative ACLs left behind
-- by earlier bootstrap/default grants. Run again after repeated configuration.
DO $$ DECLARE contract record; privilege text; allowed boolean;
BEGIN
  FOR contract IN SELECT * FROM (VALUES
    ('users', ARRAY['SELECT','INSERT','UPDATE']),
    ('external_identities', ARRAY['SELECT','INSERT','UPDATE']),
    ('persons', ARRAY['SELECT','INSERT','UPDATE']),
    ('organizations', ARRAY['SELECT','INSERT','UPDATE']),
    ('organization_additions', ARRAY['SELECT','INSERT']),
    ('participants', ARRAY['SELECT','INSERT','UPDATE']),
    ('participant_memberships', ARRAY['SELECT','INSERT','UPDATE']),
    ('sessions', ARRAY['SELECT','INSERT','UPDATE','DELETE']),
    ('authorization_attempts', ARRAY['SELECT','INSERT','UPDATE','DELETE']),
    ('role_assignments', ARRAY['SELECT','INSERT','DELETE']),
    ('audit_events', ARRAY['SELECT','INSERT']),
    ('outbox_events', ARRAY['SELECT','INSERT']),
    ('schema_migrations', ARRAY[]::text[])
  ) AS expected(table_name, privileges)
  LOOP
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
    LOOP
      allowed := privilege=ANY(contract.privileges);
      IF has_table_privilege('forum_app',format('public.%I',contract.table_name),privilege) IS DISTINCT FROM allowed THEN
        RAISE EXCEPTION 'Runtime ACL mismatch: public.% / %', contract.table_name, privilege;
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) a
      WHERE d.defaclnamespace='public'::regnamespace AND d.defaclobjtype IN ('r','S')
        AND a.grantee='forum_app_role'::regrole) THEN
    RAISE EXCEPTION 'Blanket future public runtime privileges remain';
  END IF;
  IF NOT has_sequence_privilege('forum_app','public.outbox_events_sequence_seq','USAGE')
      OR NOT has_sequence_privilege('forum_app','public.outbox_events_sequence_seq','SELECT')
      OR has_sequence_privilege('forum_app','public.outbox_events_sequence_seq','UPDATE') THEN
    RAISE EXCEPTION 'Runtime outbox sequence boundary changed';
  END IF;
END $$;
\echo Public schema, profile projections, constraints and runtime permissions passed.
