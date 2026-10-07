-- Main public layout only. Original legacy migrations remain immutable.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE name='003_public_schema') THEN
    RAISE EXCEPTION 'Public migration003 is required';
  END IF;
END $$;
ALTER TABLE public.role_assignments DROP CONSTRAINT role_assignments_role_check;
ALTER TABLE public.role_assignments ADD CONSTRAINT role_assignments_role_check
  CHECK (role IN ('individual','provider','customer','organization_admin'));

CREATE OR REPLACE FUNCTION public.guard_role_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE target_kind text; business_role text;
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.id,NEW.user_id,NEW.scope_type,NEW.scope_id,NEW.role)
      IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.scope_type,OLD.scope_id,OLD.role) THEN
    RAISE EXCEPTION 'Role assignment association is immutable' USING ERRCODE='23514';
  END IF;
  SELECT kind,role INTO target_kind,business_role FROM public.participants WHERE id=NEW.scope_id FOR KEY SHARE;
  IF (NEW.role='individual' AND target_kind<>'individual')
     OR (NEW.role='organization_admin' AND target_kind<>'organization')
     OR (NEW.role IN ('provider','customer') AND NEW.role<>business_role) THEN
    RAISE EXCEPTION 'Grant does not match participant kind or business role' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

INSERT INTO public.role_assignments(user_id,scope_type,scope_id,role)
SELECT p.individual_user_id,'participant',p.id,'individual'
FROM public.participants p JOIN public.participant_memberships m
  ON m.user_id=p.individual_user_id AND m.participant_id=p.id
WHERE p.kind='individual'
ON CONFLICT(user_id,scope_id,role) DO NOTHING;
DELETE FROM public.role_assignments r USING public.participants p
WHERE r.scope_id=p.id AND r.user_id=p.individual_user_id
  AND p.kind='individual' AND r.role='provider';
