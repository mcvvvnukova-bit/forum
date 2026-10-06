-- Execute as the schema owner against the main Forum database after migration 003.
-- Sandbox uses its separate runtime role and deployment configuration.
\set ON_ERROR_STOP on
\if :{?app_role}
\else
  \set app_role forum_app_role
\endif
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Apply the public-schema migration before granting runtime access';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE name='003_public_schema') THEN
    RAISE EXCEPTION 'Apply the public-schema migration before granting runtime access';
  END IF;
END $$;

-- Reconcile previous blanket grants before reapplying the allowlist. Limit
-- revocation to this runtime role in public; other roles/schemas are untouched.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM :"app_role";
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM :"app_role";
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM :"app_role";
-- Table-level REVOKE does not remove independent column ACLs.
SELECT format('REVOKE ALL PRIVILEGES (%I) ON TABLE %I.%I FROM %I',
              a.attname, n.nspname, c.relname, :'app_role')
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND a.attacl IS NOT NULL
  AND EXISTS (SELECT 1 FROM aclexplode(a.attacl) acl WHERE acl.grantee=:'app_role'::regrole)
\gexec
-- Remove only public-scoped defaults held by this role, including defaults
-- created by another owner. No future public table or sequence is allowlisted.
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON %s FROM %I',
              pg_get_userbyid(d.defaclrole),
              CASE d.defaclobjtype WHEN 'r' THEN 'TABLES' ELSE 'SEQUENCES' END,
              :'app_role')
FROM pg_default_acl d
WHERE d.defaclnamespace='public'::regnamespace AND d.defaclobjtype IN ('r','S')
  AND EXISTS (SELECT 1 FROM aclexplode(d.defaclacl) acl WHERE acl.grantee=:'app_role'::regrole)
\gexec

GRANT USAGE ON SCHEMA public TO :"app_role";
GRANT SELECT, INSERT, UPDATE ON public.users, public.external_identities,
  public.persons, public.organizations, public.participants, public.participant_memberships TO :"app_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions, public.authorization_attempts TO :"app_role";
GRANT SELECT, INSERT, DELETE ON public.role_assignments TO :"app_role";
GRANT SELECT, INSERT ON public.outbox_events, public.audit_events TO :"app_role";
GRANT USAGE, SELECT ON SEQUENCE public.outbox_events_sequence_seq TO :"app_role";
GRANT EXECUTE ON FUNCTION public.profile_birthdate(text), public.valid_sber_profile(jsonb),
  public.touch_updated_at(), public.guard_participant(), public.guard_membership(),
  public.guard_role_assignment(), public.require_personal_participant() TO :"app_role";
COMMIT;
