-- Execute as the schema owner against the main Forum database after migration 003.
-- Sandbox uses its separate runtime role and deployment configuration.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE name='003_public_schema') THEN
    RAISE EXCEPTION 'Apply the public-schema migration before granting runtime access';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO forum_app_role;
GRANT SELECT, INSERT, UPDATE ON public.users, public.external_identities,
  public.persons, public.organizations, public.participants, public.participant_memberships TO forum_app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions, public.authorization_attempts TO forum_app_role;
GRANT SELECT, INSERT, DELETE ON public.role_assignments TO forum_app_role;
GRANT SELECT, INSERT ON public.outbox_events, public.audit_events TO forum_app_role;
GRANT USAGE, SELECT ON SEQUENCE public.outbox_events_sequence_seq TO forum_app_role;
GRANT EXECUTE ON FUNCTION public.profile_birthdate(text), public.valid_sber_profile(jsonb),
  public.touch_updated_at(), public.guard_participant(), public.guard_membership(),
  public.guard_role_assignment(), public.require_personal_participant() TO forum_app_role;
COMMIT;
