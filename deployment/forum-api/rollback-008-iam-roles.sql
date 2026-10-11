-- Owner-only schema rollback for an isolated/unused installation.
-- Preferred rollback: revert application bytes and retain migration008 data.
-- Run only after stopping all IAM writers and taking a recoverable DB backup.
-- Any live assignment, IAM audit, replay record, changed access version or signer
-- evidence aborts. No audit rows or accepted role decisions are ever deleted.
BEGIN;
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(hashtext('forum-auth-migrations'));
SELECT pg_advisory_xact_lock(hashtext('forum-iam-platform'));
LOCK TABLE public.iam_role_assignments,public.iam_idempotency,public.organization_authorities,
 public.organization_memberships,public.users,public.sessions,public.audit_events IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.iam_role_assignments WHERE status='active')
  OR EXISTS(SELECT 1 FROM public.audit_events WHERE action LIKE 'IAM%')
  OR EXISTS(SELECT 1 FROM public.iam_idempotency)
  OR EXISTS(SELECT 1 FROM public.users WHERE access_version<>1)
  OR EXISTS(SELECT 1 FROM public.organization_memberships WHERE version<>1)
  OR EXISTS(SELECT 1 FROM public.organization_authorities WHERE authority_type='signer' OR cardinality(allowed_actions)>0) THEN
  RAISE EXCEPTION 'IAM data exists; retain schema and roll back the application instead';
 END IF;
END $$;
DROP FUNCTION public.effective_iam_roles(uuid,uuid);
DROP TABLE public.iam_idempotency;
DROP TABLE public.iam_role_assignments;
DROP FUNCTION public.guard_iam_role_owner();
ALTER TABLE public.organization_memberships DROP CONSTRAINT organization_memberships_scoped_owner,DROP COLUMN version;
ALTER TABLE public.organization_authorities DROP COLUMN allowed_actions,DROP CONSTRAINT organization_authorities_authority_type_check,
 ADD CONSTRAINT organization_authorities_authority_type_check CHECK(authority_type IN ('administrator'));
ALTER TABLE public.sessions DROP COLUMN csrf_token;
ALTER TABLE public.users DROP COLUMN access_version;
DELETE FROM public.schema_migrations WHERE name='008_iam_roles';
COMMIT;
