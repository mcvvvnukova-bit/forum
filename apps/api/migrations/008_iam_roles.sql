-- Additive IAM catalogue: business role_assignments remain a separate contract.
ALTER TABLE public.users ADD COLUMN access_version bigint NOT NULL DEFAULT 1 CHECK(access_version BETWEEN 1 AND 9007199254740991);
ALTER TABLE public.sessions ADD COLUMN csrf_token text NOT NULL DEFAULT
  translate(rtrim(encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'base64'),'='),'+/','-_')
  CHECK(csrf_token ~ '^[A-Za-z0-9_-]{43}$');
ALTER TABLE public.organization_memberships ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0),
  ADD CONSTRAINT organization_memberships_scoped_owner UNIQUE(id,user_id,organization_id);
ALTER TABLE public.organization_authorities DROP CONSTRAINT organization_authorities_authority_type_check,
  ADD CONSTRAINT organization_authorities_authority_type_check CHECK(authority_type IN ('administrator','signer')),
  ADD COLUMN allowed_actions text[] NOT NULL DEFAULT '{}' CHECK(allowed_actions <@ ARRAY['organization.documents.sign']::text[]);

CREATE TABLE public.iam_role_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.users(id),
 scope_type text NOT NULL CHECK(scope_type IN ('platform','organization')),
 scope_id uuid REFERENCES public.organizations(id),
 membership_id uuid,
 role_code text NOT NULL CHECK(role_code IN ('organization_employee','organization_admin','organization_signer','platform_moderator','platform_admin')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 effective_from timestamptz NOT NULL DEFAULT now(),
 effective_until timestamptz,
 revoked_at timestamptz,
 created_by_user_id uuid NOT NULL REFERENCES public.users(id),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(membership_id,user_id,scope_id) REFERENCES public.organization_memberships(id,user_id,organization_id),
 CHECK((scope_type='platform' AND scope_id IS NULL AND membership_id IS NULL AND role_code IN ('platform_moderator','platform_admin'))
  OR (scope_type='organization' AND scope_id IS NOT NULL AND membership_id IS NOT NULL AND role_code IN ('organization_employee','organization_admin','organization_signer'))),
 CHECK(effective_until IS NULL OR effective_until>effective_from),
 CHECK((status='active' AND revoked_at IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX iam_role_assignments_unique ON public.iam_role_assignments(user_id,scope_type,coalesce(scope_id,'00000000-0000-0000-0000-000000000000'::uuid),role_code);
CREATE INDEX iam_role_assignments_scope ON public.iam_role_assignments(scope_id,user_id);
CREATE INDEX iam_role_assignments_membership ON public.iam_role_assignments(membership_id);
CREATE INDEX iam_role_assignments_creator ON public.iam_role_assignments(created_by_user_id);
CREATE TABLE public.iam_idempotency (
 actor_user_id uuid NOT NULL REFERENCES public.users(id),
 idempotency_key text NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 response_status integer NOT NULL CHECK(response_status IN (200,201)),
 response_body jsonb NOT NULL CHECK(jsonb_typeof(response_body)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 PRIMARY KEY(actor_user_id,idempotency_key),CHECK(expires_at>=created_at+interval '24 hours')
);
CREATE INDEX iam_idempotency_expiry ON public.iam_idempotency(expires_at);

CREATE FUNCTION public.guard_iam_role_owner() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF ROW(NEW.id,NEW.user_id,NEW.scope_type,NEW.scope_id,NEW.membership_id,NEW.role_code,NEW.created_by_user_id,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.scope_type,OLD.scope_id,OLD.membership_id,OLD.role_code,OLD.created_by_user_id,OLD.created_at) THEN
  RAISE EXCEPTION 'IAM role ownership is immutable' USING ERRCODE='23514';
 END IF;
 NEW.updated_at=now();RETURN NEW;
END $$;
CREATE TRIGGER iam_role_assignment_owner BEFORE UPDATE ON public.iam_role_assignments FOR EACH ROW EXECUTE FUNCTION public.guard_iam_role_owner();

-- Invoker-rights; validity uses the current statement, including after lock waits.
-- It consumes confirmed evidence, never creates it.
CREATE FUNCTION public.effective_iam_roles(actor uuid,organization uuid DEFAULT NULL) RETURNS TABLE(role_code text)
 LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT r.role_code FROM public.iam_role_assignments r JOIN public.users u ON u.id=r.user_id
 WHERE u.id=actor AND u.status='active' AND r.status='active' AND r.effective_from<=statement_timestamp()
  AND (r.effective_until IS NULL OR r.effective_until>statement_timestamp())
  AND ((organization IS NULL AND r.scope_type='platform') OR
   (organization IS NOT NULL AND r.scope_type='organization' AND r.scope_id=organization AND EXISTS(
    SELECT 1 FROM public.organization_memberships m JOIN public.organizations o ON o.id=m.organization_id
    WHERE m.id=r.membership_id AND m.user_id=u.id AND o.id=organization AND m.status='active' AND m.revoked_at IS NULL
     AND m.effective_from<=statement_timestamp() AND (m.effective_until IS NULL OR m.effective_until>statement_timestamp())
     AND o.registration_state='registered' AND o.status='active')
    AND (r.role_code<>'organization_admin' OR EXISTS(
     SELECT 1 FROM public.organization_authorities a WHERE a.user_id=u.id AND a.organization_id=organization
      AND a.authority_type='administrator' AND a.status='confirmed' AND a.revoked_at IS NULL AND a.effective_from<=statement_timestamp()
      AND (a.effective_until IS NULL OR a.effective_until>statement_timestamp())))))
 ORDER BY r.role_code
$$;
INSERT INTO public.iam_role_assignments(user_id,scope_type,scope_id,membership_id,role_code,created_by_user_id,reason,effective_from,effective_until)
 SELECT m.user_id,'organization',m.organization_id,m.id,'organization_employee',coalesce(m.created_by_user_id,m.user_id),
  'migration008:current_confirmed_membership',m.effective_from,m.effective_until
 FROM public.organization_memberships m JOIN public.users u ON u.id=m.user_id JOIN public.organizations o ON o.id=m.organization_id
 WHERE m.status='active' AND m.revoked_at IS NULL AND m.effective_from<=now() AND (m.effective_until IS NULL OR m.effective_until>now())
  AND u.status='active' AND o.registration_state='registered' AND o.status='active';
INSERT INTO public.iam_role_assignments(user_id,scope_type,scope_id,membership_id,role_code,created_by_user_id,reason)
 SELECT m.user_id,'organization',m.organization_id,m.id,'organization_admin',coalesce(m.created_by_user_id,m.user_id),
  'migration008:legacy_grant_with_current_confirmed_administrator_authority'
 FROM public.organization_memberships m JOIN public.users u ON u.id=m.user_id JOIN public.organizations o ON o.id=m.organization_id
 WHERE m.status='active' AND m.revoked_at IS NULL AND m.effective_from<=now() AND (m.effective_until IS NULL OR m.effective_until>now())
  AND u.status='active' AND o.registration_state='registered' AND o.status='active'
  AND EXISTS(SELECT 1 FROM public.participants p JOIN public.role_assignments r ON r.scope_id=p.id
   WHERE p.organization_id=o.id AND r.user_id=u.id AND r.scope_type='participant' AND r.role='organization_admin' AND r.status='active')
  AND EXISTS(SELECT 1 FROM public.organization_authorities a WHERE a.user_id=u.id AND a.organization_id=o.id
   AND a.authority_type='administrator' AND a.status='confirmed' AND a.revoked_at IS NULL AND a.effective_from<=now()
   AND (a.effective_until IS NULL OR a.effective_until>now()));
REVOKE ALL ON public.iam_role_assignments,public.iam_idempotency FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_iam_role_owner(),public.effective_iam_roles(uuid,uuid) FROM PUBLIC;
COMMENT ON TABLE public.iam_role_assignments IS 'Scoped IAM permissions, independent of provider/customer business grants. Retain on application rollback.';
