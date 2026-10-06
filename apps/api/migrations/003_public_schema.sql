-- Run through apply-public.psql under a transaction and the migration lock.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%'
      AND nspname NOT IN ('information_schema','public','iam','profiles','audit','integration')) THEN
    RAISE EXCEPTION 'Unexpected application schema; inspect before consolidation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class source JOIN pg_namespace n ON n.oid=source.relnamespace
    JOIN pg_class target ON target.relnamespace='public'::regnamespace AND target.relname=source.relname
    WHERE n.nspname IN ('iam','profiles','audit','integration')
  ) OR EXISTS (
    SELECT 1 FROM pg_type source JOIN pg_namespace n ON n.oid=source.typnamespace
    JOIN pg_type target ON target.typnamespace='public'::regnamespace AND target.typname=source.typname
    WHERE n.nspname IN ('iam','profiles','audit','integration')
  ) OR EXISTS (
    SELECT 1 FROM pg_proc source JOIN pg_namespace n ON n.oid=source.pronamespace
    JOIN pg_proc target ON target.pronamespace='public'::regnamespace
      AND target.proname=source.proname AND target.proargtypes=source.proargtypes
    WHERE n.nspname IN ('iam','profiles','audit','integration')
  ) THEN
    RAISE EXCEPTION 'Object name collision in public; no objects moved';
  END IF;
END $$;

ALTER TABLE iam.users SET SCHEMA public;
ALTER TABLE iam.external_identities SET SCHEMA public;
ALTER TABLE iam.authorization_attempts SET SCHEMA public;
ALTER TABLE iam.sessions SET SCHEMA public;
ALTER TABLE iam.role_assignments SET SCHEMA public;
ALTER TABLE iam.schema_migrations SET SCHEMA public;
ALTER TABLE profiles.persons SET SCHEMA public;
ALTER TABLE profiles.organizations SET SCHEMA public;
ALTER TABLE profiles.participants SET SCHEMA public;
ALTER TABLE profiles.participant_memberships SET SCHEMA public;
ALTER TABLE audit.audit_events SET SCHEMA public;
ALTER TABLE integration.outbox_events SET SCHEMA public;
-- Indexes, row types and the owned outbox identity sequence follow their tables.

ALTER FUNCTION profiles.profile_birthdate(text) SET SCHEMA public;
ALTER FUNCTION profiles.valid_sber_profile(jsonb) SET SCHEMA public;
ALTER FUNCTION profiles.touch_updated_at() SET SCHEMA public;
ALTER FUNCTION profiles.guard_participant() SET SCHEMA public;
ALTER FUNCTION profiles.guard_membership() SET SCHEMA public;
ALTER FUNCTION profiles.guard_role_assignment() SET SCHEMA public;
ALTER FUNCTION profiles.require_personal_participant() SET SCHEMA public;

-- PL/pgSQL source text does not follow object renames. Replacing these known
-- bodies preserves function OIDs/ACLs and their trigger/expression dependencies.
DO $$ DECLARE definition text;
BEGIN
  FOR definition IN SELECT pg_get_functiondef(p.oid) FROM pg_proc p
    WHERE p.pronamespace='public'::regnamespace
      AND p.proname IN ('guard_membership','guard_role_assignment','require_personal_participant')
      AND p.pronargs=0
  LOOP
    EXECUTE replace(definition, 'profiles.', 'public.');
  END LOOP;
END $$;

-- Never CASCADE: an unexpected dependency/object aborts the transaction.
DROP SCHEMA iam;
DROP SCHEMA profiles;
DROP SCHEMA audit;
DROP SCHEMA integration;
-- Object ACLs and public's restricted CREATE privileges are retained.
