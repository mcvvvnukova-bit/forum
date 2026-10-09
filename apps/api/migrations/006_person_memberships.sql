-- Owner transaction under forum-auth-migrations. Forward-only: application
-- rollback retains these data and nullable, deprecated Sber compatibility fields.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE name='005_public_individual_role') THEN
    RAISE EXCEPTION 'Public migration005 is required';
  END IF;
END $$;

CREATE TABLE public.identity_providers (
  provider text PRIMARY KEY CHECK (provider ~ '^[a-z][a-z0-9_]{0,63}$'),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.identity_providers(provider)
SELECT provider FROM public.external_identities UNION SELECT 'sber_id' UNION SELECT 'kontur_diadoc';
ALTER TABLE public.external_identities DROP CONSTRAINT external_identities_provider_check;
ALTER TABLE public.external_identities
  ADD CONSTRAINT external_identities_provider_fk FOREIGN KEY(provider) REFERENCES public.identity_providers(provider),
  ADD CONSTRAINT external_identities_identity_owner_unique UNIQUE(id,user_id);

CREATE TABLE public.identity_profiles (
  identity_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.persons(user_id),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  requested_scopes text[] NOT NULL DEFAULT '{}',
  granted_scopes text[],
  identified_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  FOREIGN KEY(identity_id,user_id) REFERENCES public.external_identities(id,user_id)
);
CREATE INDEX identity_profiles_user ON public.identity_profiles(user_id);
INSERT INTO public.identity_profiles(identity_id,user_id,snapshot,requested_scopes,granted_scopes,identified_at,received_at)
SELECT e.id,p.user_id,p.sber_profile,p.requested_scopes,p.granted_scopes,p.identified_at,p.profile_received_at
FROM public.persons p JOIN public.external_identities e
  ON e.provider=p.identity_provider AND e.subject=p.sub AND e.user_id=p.user_id;
COMMENT ON TABLE public.identity_profiles IS 'Validated adapter snapshots with exact identity ownership and source times; never public profile payloads.';

-- Only the reviewed person attributes are converted, using the catalog to avoid
-- assuming a generated-column mode. DROP EXPRESSION preserves stored values.
DO $$ DECLARE attribute record;
BEGIN
  FOR attribute IN SELECT attname FROM pg_attribute
    WHERE attrelid='public.persons'::regclass AND attgenerated<>'' AND NOT attisdropped
      AND attname=ANY(ARRAY['identity_provider','sub','email','phone_number','birthdate','family_name','given_name','middle_name','gender','identification','inn','snils','driving_license','international_passport','priority_doc','citizenship','place_of_birth','address_reg','work_address','address_of_actual_residence','delivery_address','address','sts','previous_identification','previous_family_name','previous_given_name','previous_middle_name','education','place_of_work','job_title','marital_status','is_self_employed'])
  LOOP
    EXECUTE format('ALTER TABLE public.persons ALTER COLUMN %I DROP EXPRESSION',attribute.attname);
  END LOOP;
END $$;
ALTER TABLE public.persons DROP CONSTRAINT persons_identity_provider_sub_user_id_fkey;
ALTER TABLE public.persons ALTER COLUMN sber_profile DROP NOT NULL,
  ALTER COLUMN sub DROP NOT NULL, ALTER COLUMN identified_at DROP NOT NULL,
  ALTER COLUMN profile_received_at DROP NOT NULL;
COMMENT ON TABLE public.persons IS 'Canonical provider-neutral person account; independent of business participants and source identity snapshots.';
COMMENT ON COLUMN public.persons.sber_profile IS 'Deprecated nullable Sber compatibility snapshot for application rollback; canonical profile reads must not use it.';
COMMENT ON COLUMN public.persons.identity_provider IS 'Deprecated nullable primary Sber source marker retained for rollback.';
COMMENT ON COLUMN public.persons.sub IS 'Deprecated nullable primary Sber subject retained for rollback; identity ownership lives in external_identities.';
DROP TRIGGER person_requires_participant ON public.persons;
DROP TRIGGER keep_personal_participant ON public.participants;
DROP FUNCTION public.require_personal_participant();

ALTER TABLE public.organizations DROP CONSTRAINT organizations_identity_provider_check,
  ALTER COLUMN identity_provider DROP NOT NULL, ALTER COLUMN identity_provider DROP DEFAULT,
  ALTER COLUMN provider_organization_id DROP NOT NULL, ALTER COLUMN identified_at DROP NOT NULL,
  ADD COLUMN registration_state text NOT NULL DEFAULT 'pending' CHECK(registration_state IN ('pending','registered','rejected')),
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','restricted','deactivated')),
  ADD COLUMN created_by_user_id uuid REFERENCES public.users(id),
  ADD COLUMN registered_at timestamptz,
  ADD COLUMN registration_basis_type text NOT NULL DEFAULT 'card' CHECK(length(btrim(registration_basis_type))>0),
  ADD COLUMN registration_basis_reference text,
  ADD CONSTRAINT organizations_registration_effective_check CHECK(
    (registration_state='registered' AND registered_at IS NOT NULL) OR
    (registration_state IN ('pending','rejected') AND registered_at IS NULL));
-- Existing organizations have recorded provider identification; no administrator
-- approval is inferred from that fact. Preserve its exact time and identifier.
ALTER TABLE public.organizations DISABLE TRIGGER organizations_updated;
UPDATE public.organizations SET registration_state='registered',registered_at=identified_at,
  registration_basis_type='legacy',registration_basis_reference=identity_provider||':'||provider_organization_id;
ALTER TABLE public.organizations ENABLE TRIGGER organizations_updated;
CREATE INDEX organizations_creator ON public.organizations(created_by_user_id);

CREATE TABLE public.organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','revoked')),
  basis_type text NOT NULL CHECK(length(btrim(basis_type))>0),
  basis_reference text NOT NULL CHECK(length(btrim(basis_reference))>0),
  created_by_user_id uuid REFERENCES public.users(id),
  approved_by_user_id uuid REFERENCES public.users(id),
  effective_from timestamptz,
  effective_until timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,organization_id),
  CHECK(effective_until IS NULL OR (effective_from IS NOT NULL AND effective_until>effective_from)),
  CHECK((status='pending' AND approved_by_user_id IS NULL AND effective_from IS NULL AND effective_until IS NULL AND revoked_at IS NULL)
    OR (status='active' AND effective_from IS NOT NULL AND revoked_at IS NULL AND (approved_by_user_id IS NOT NULL OR basis_type='legacy'))
    OR (status='revoked' AND revoked_at IS NOT NULL))
);
CREATE INDEX organization_memberships_organization ON public.organization_memberships(organization_id);
CREATE INDEX organization_memberships_creator ON public.organization_memberships(created_by_user_id);
CREATE INDEX organization_memberships_approver ON public.organization_memberships(approved_by_user_id);
-- Participant access is existing evidence only of legacy membership, never admin
-- authority. Aggregate multiple contexts without revoking an active one.
INSERT INTO public.organization_memberships(user_id,organization_id,status,basis_type,basis_reference,effective_from,revoked_at,created_at,updated_at)
SELECT m.user_id,p.organization_id,
  CASE WHEN bool_or(m.status='active') THEN 'active' ELSE 'revoked' END,
  'legacy','migration006:participant_memberships',
  min(m.created_at),CASE WHEN bool_or(m.status='active') THEN NULL ELSE max(m.revoked_at) END,
  min(m.created_at),max(m.updated_at)
FROM public.participant_memberships m JOIN public.participants p ON p.id=m.participant_id
WHERE p.kind='organization' GROUP BY m.user_id,p.organization_id;
ALTER TABLE public.participant_memberships
  ADD COLUMN basis_type text NOT NULL DEFAULT 'legacy' CHECK(length(btrim(basis_type))>0),
  ADD COLUMN basis_reference text NOT NULL DEFAULT 'migration006:participant_memberships' CHECK(length(btrim(basis_reference))>0);
ALTER TABLE public.role_assignments
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  ADD COLUMN revoked_at timestamptz,
  ADD CONSTRAINT role_assignments_state_check CHECK((status='active' AND revoked_at IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL)),
  ADD COLUMN basis_type text NOT NULL DEFAULT 'legacy' CHECK(length(btrim(basis_type))>0),
  ADD COLUMN basis_reference text NOT NULL DEFAULT 'migration006:role_assignments' CHECK(length(btrim(basis_reference))>0);

-- Existing rows above retain legacy provenance; future trusted writes must not
-- claim to have been generated by migration006.
ALTER TABLE public.participant_memberships ALTER COLUMN basis_type SET DEFAULT 'internal',
  ALTER COLUMN basis_reference SET DEFAULT 'internal:trusted_membership';
ALTER TABLE public.role_assignments ALTER COLUMN basis_type SET DEFAULT 'internal',
  ALTER COLUMN basis_reference SET DEFAULT 'internal:trusted_grant';

CREATE TABLE public.organization_authorities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  authority_type text NOT NULL CHECK(authority_type IN ('administrator')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected','revoked')),
  basis_type text NOT NULL CHECK(length(btrim(basis_type))>0),
  basis_reference text NOT NULL CHECK(length(btrim(basis_reference))>0),
  created_by_user_id uuid REFERENCES public.users(id),
  approved_by_user_id uuid REFERENCES public.users(id),
  decided_at timestamptz,
  effective_from timestamptz,
  effective_until timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(effective_until IS NULL OR (effective_from IS NOT NULL AND effective_until>effective_from)),
  CHECK((status='pending' AND approved_by_user_id IS NULL AND decided_at IS NULL AND effective_from IS NULL AND effective_until IS NULL AND revoked_at IS NULL)
    OR (status='confirmed' AND approved_by_user_id IS NOT NULL AND decided_at IS NOT NULL AND effective_from IS NOT NULL AND revoked_at IS NULL)
    OR (status='rejected' AND approved_by_user_id IS NOT NULL AND decided_at IS NOT NULL AND effective_from IS NULL AND effective_until IS NULL AND revoked_at IS NULL)
    OR (status='revoked' AND revoked_at IS NOT NULL))
);
CREATE INDEX organization_authorities_owner ON public.organization_authorities(user_id,organization_id,authority_type);
CREATE INDEX organization_authorities_organization ON public.organization_authorities(organization_id);
CREATE INDEX organization_authorities_creator ON public.organization_authorities(created_by_user_id);
CREATE INDEX organization_authorities_approver ON public.organization_authorities(approved_by_user_id);
INSERT INTO public.organization_authorities(user_id,organization_id,authority_type,basis_type,basis_reference,created_at,updated_at)
SELECT r.user_id,p.organization_id,'administrator','legacy','migration006:unproven_organization_admin_grant',min(r.created_at),min(r.created_at)
FROM public.role_assignments r JOIN public.participants p ON p.id=r.scope_id
WHERE r.role='organization_admin' GROUP BY r.user_id,p.organization_id;

CREATE FUNCTION public.guard_identity_owner() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME='external_identities' THEN
    IF ROW(NEW.id,NEW.user_id,NEW.provider,NEW.subject) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.provider,OLD.subject) THEN
      RAISE EXCEPTION 'External identity ownership is immutable' USING ERRCODE='23514';
    END IF;
  ELSIF ROW(NEW.identity_id,NEW.user_id) IS DISTINCT FROM ROW(OLD.identity_id,OLD.user_id) THEN
    RAISE EXCEPTION 'Identity profile ownership is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER external_identity_owner BEFORE UPDATE ON public.external_identities FOR EACH ROW EXECUTE FUNCTION public.guard_identity_owner();
CREATE TRIGGER identity_profile_owner BEFORE UPDATE ON public.identity_profiles FOR EACH ROW EXECUTE FUNCTION public.guard_identity_owner();
CREATE FUNCTION public.guard_organization_association() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF ROW(NEW.id,NEW.user_id,NEW.organization_id,NEW.basis_type,NEW.basis_reference,NEW.created_by_user_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.organization_id,OLD.basis_type,OLD.basis_reference,OLD.created_by_user_id,OLD.created_at) THEN
    RAISE EXCEPTION 'Organization association and provenance are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='organization_authorities' THEN
    IF NEW.authority_type IS DISTINCT FROM OLD.authority_type THEN
      RAISE EXCEPTION 'Authority type is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  NEW.updated_at=now();RETURN NEW;
END $$;
CREATE TRIGGER organization_membership_owner BEFORE UPDATE ON public.organization_memberships FOR EACH ROW EXECUTE FUNCTION public.guard_organization_association();
CREATE TRIGGER organization_authority_owner BEFORE UPDATE ON public.organization_authorities FOR EACH ROW EXECUTE FUNCTION public.guard_organization_association();

-- Invoker rights: the trusted runtime gets explicit SELECT/EXECUTE, never a
-- SECURITY DEFINER bypass or approval writes. Call for every business operation.
CREATE FUNCTION public.effective_business_access(actor uuid,participant uuid,requested_role text,write_access boolean DEFAULT true)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.participant_memberships pm ON pm.user_id=u.id AND pm.status='active'
    JOIN public.participants p ON p.id=pm.participant_id
    JOIN public.role_assignments r ON r.user_id=u.id AND r.scope_type='participant' AND r.scope_id=p.id AND r.role=requested_role AND r.status='active'
    WHERE u.id=actor AND u.status='active' AND p.id=participant
      AND p.status<>'deactivated' AND (NOT write_access OR p.status='active')
      AND (requested_role IN ('provider','customer') AND requested_role=p.role OR requested_role='organization_admin' AND p.kind='organization')
      AND (p.kind='individual' OR EXISTS (
        SELECT 1 FROM public.organizations o JOIN public.organization_memberships om ON om.organization_id=o.id
        WHERE o.id=p.organization_id AND o.registration_state='registered' AND o.status<>'deactivated'
          AND (NOT write_access OR o.status='active') AND om.user_id=u.id AND om.status='active'
          AND om.effective_from<=now() AND (om.effective_until IS NULL OR om.effective_until>now())
      ))
      AND (requested_role<>'organization_admin' OR EXISTS (
        SELECT 1 FROM public.organization_authorities a
        WHERE a.organization_id=p.organization_id AND a.user_id=u.id AND a.authority_type='administrator'
          AND a.status='confirmed' AND a.effective_from<=now() AND (a.effective_until IS NULL OR a.effective_until>now())
      ))
  )
$$;
REVOKE ALL ON FUNCTION public.guard_identity_owner(),public.guard_organization_association(),
  public.effective_business_access(uuid,uuid,text,boolean) FROM PUBLIC;
