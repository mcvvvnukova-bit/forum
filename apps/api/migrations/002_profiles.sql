-- First production rollout: identity tables must be empty. Populated installations
-- require a separately reviewed backfill, not fabricated identity timestamps.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM iam.users) OR EXISTS (SELECT 1 FROM party.participants)
     OR EXISTS (SELECT 1 FROM iam.role_assignments) THEN
    RAISE EXCEPTION 'Profiles rollout requires empty identity tables; use a reviewed backfill for existing users';
  END IF;
END $$;

CREATE SCHEMA profiles;

CREATE FUNCTION profiles.profile_birthdate(value text) RETURNS date
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
BEGIN
  IF value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RETURN make_date(substring(value,1,4)::int,substring(value,6,2)::int,substring(value,9,2)::int);
  ELSIF value ~ '^[0-9]{2}\.[0-9]{2}\.[0-9]{4}$' THEN
    RETURN make_date(substring(value,7,4)::int,substring(value,4,2)::int,substring(value,1,2)::int);
  END IF;
  RAISE EXCEPTION 'Unsupported Sber birthdate format' USING ERRCODE='22007';
END $$;

CREATE FUNCTION profiles.valid_sber_profile(profile jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
DECLARE
  field record; child record; allowed_children text[];
  scalar_fields constant text[] := ARRAY['sub','email','phone_number','birthdate','family_name','given_name','middle_name','place_of_birth','previous_family_name','previous_given_name','previous_middle_name','place_of_work','job_title'];
  object_fields constant text[] := ARRAY['identification','inn','snils','driving_license','international_passport','priority_doc','citizenship','address_reg','work_address','address_of_actual_residence','delivery_address','address','sts','previous_identification','education','marital_status'];
BEGIN
  IF jsonb_typeof(profile) <> 'object' THEN RETURN false; END IF;
  IF jsonb_typeof(profile->'sub') IS DISTINCT FROM 'string'
     OR length(profile->>'sub') NOT BETWEEN 1 AND 96 OR (profile->>'sub') ~ '\s' THEN RETURN false; END IF;
  FOR field IN SELECT key,value FROM jsonb_each(profile) LOOP
    IF NOT (field.key = ANY(scalar_fields || object_fields || ARRAY['gender','is_self_employed','email_verified'])) THEN RETURN false; END IF;
    IF field.value = 'null'::jsonb THEN CONTINUE; END IF;
    IF field.key = ANY(scalar_fields) THEN
      IF jsonb_typeof(field.value) <> 'string' THEN RETURN false; END IF;
    ELSIF field.key IN ('is_self_employed','email_verified') THEN
      IF jsonb_typeof(field.value) <> 'boolean' THEN RETURN false; END IF;
    ELSIF field.key = 'gender' THEN
      IF field.value NOT IN ('1'::jsonb,'2'::jsonb) THEN RETURN false; END IF;
    ELSE
      IF jsonb_typeof(field.value) <> 'object' THEN RETURN false; END IF;
      allowed_children := CASE
        WHEN field.key IN ('identification','previous_identification') THEN ARRAY['series','number','issued_by','issued_date','code']
        WHEN field.key = 'international_passport' THEN ARRAY['series','number','issued_by','issued_date','planned_end_date','name','surname']
        WHEN field.key = 'priority_doc' THEN ARRAY['type','series','number','issued_by','issued_date','code']
        WHEN field.key IN ('inn','snils','driving_license','sts') THEN ARRAY['number']
        WHEN field.key = 'citizenship' THEN ARRAY['country_code','country_name']
        WHEN field.key IN ('education','marital_status') THEN ARRAY['code','description']
        ELSE ARRAY['full_address','fias_code','post_index','country','region','district','city','settlement','street','house','building','bulk','apartment'] END;
      FOR child IN SELECT key,value FROM jsonb_each(field.value) LOOP
        IF NOT child.key = ANY(allowed_children) THEN RETURN false; END IF;
        IF child.value = 'null'::jsonb THEN CONTINUE; END IF;
        IF (field.key IN ('education','marital_status') AND child.key='code')
           OR (field.key='priority_doc' AND child.key='type') THEN
          IF jsonb_typeof(child.value) NOT IN ('string','number') THEN RETURN false; END IF;
        ELSIF jsonb_typeof(child.value) <> 'string' THEN RETURN false;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN true;
END $$;

ALTER TABLE iam.external_identities ADD CONSTRAINT external_identities_owner_subject_unique UNIQUE(provider,subject,user_id);

CREATE TABLE profiles.persons (
  user_id uuid PRIMARY KEY REFERENCES iam.users(id),
  sber_profile jsonb NOT NULL CHECK (profiles.valid_sber_profile(sber_profile)),
  identity_provider text GENERATED ALWAYS AS ('sber_id'::text) STORED,
  sub text GENERATED ALWAYS AS (sber_profile->>'sub') STORED NOT NULL UNIQUE,
  email text GENERATED ALWAYS AS (sber_profile->>'email') STORED,
  phone_number text GENERATED ALWAYS AS (sber_profile->>'phone_number') STORED,
  birthdate date GENERATED ALWAYS AS (profiles.profile_birthdate(sber_profile->>'birthdate')) STORED,
  family_name text GENERATED ALWAYS AS (sber_profile->>'family_name') STORED,
  given_name text GENERATED ALWAYS AS (sber_profile->>'given_name') STORED,
  middle_name text GENERATED ALWAYS AS (sber_profile->>'middle_name') STORED,
  gender smallint GENERATED ALWAYS AS ((sber_profile->>'gender')::smallint) STORED,
  identification jsonb GENERATED ALWAYS AS (nullif(sber_profile->'identification','null'::jsonb)) STORED,
  inn jsonb GENERATED ALWAYS AS (nullif(sber_profile->'inn','null'::jsonb)) STORED,
  snils jsonb GENERATED ALWAYS AS (nullif(sber_profile->'snils','null'::jsonb)) STORED,
  driving_license jsonb GENERATED ALWAYS AS (nullif(sber_profile->'driving_license','null'::jsonb)) STORED,
  international_passport jsonb GENERATED ALWAYS AS (nullif(sber_profile->'international_passport','null'::jsonb)) STORED,
  priority_doc jsonb GENERATED ALWAYS AS (nullif(sber_profile->'priority_doc','null'::jsonb)) STORED,
  citizenship jsonb GENERATED ALWAYS AS (nullif(sber_profile->'citizenship','null'::jsonb)) STORED,
  place_of_birth text GENERATED ALWAYS AS (sber_profile->>'place_of_birth') STORED,
  address_reg jsonb GENERATED ALWAYS AS (nullif(sber_profile->'address_reg','null'::jsonb)) STORED,
  work_address jsonb GENERATED ALWAYS AS (nullif(sber_profile->'work_address','null'::jsonb)) STORED,
  address_of_actual_residence jsonb GENERATED ALWAYS AS (nullif(sber_profile->'address_of_actual_residence','null'::jsonb)) STORED,
  delivery_address jsonb GENERATED ALWAYS AS (nullif(sber_profile->'delivery_address','null'::jsonb)) STORED,
  address jsonb GENERATED ALWAYS AS (nullif(sber_profile->'address','null'::jsonb)) STORED,
  sts jsonb GENERATED ALWAYS AS (nullif(sber_profile->'sts','null'::jsonb)) STORED,
  previous_identification jsonb GENERATED ALWAYS AS (nullif(sber_profile->'previous_identification','null'::jsonb)) STORED,
  previous_family_name text GENERATED ALWAYS AS (sber_profile->>'previous_family_name') STORED,
  previous_given_name text GENERATED ALWAYS AS (sber_profile->>'previous_given_name') STORED,
  previous_middle_name text GENERATED ALWAYS AS (sber_profile->>'previous_middle_name') STORED,
  education jsonb GENERATED ALWAYS AS (nullif(sber_profile->'education','null'::jsonb)) STORED,
  place_of_work text GENERATED ALWAYS AS (sber_profile->>'place_of_work') STORED,
  job_title text GENERATED ALWAYS AS (sber_profile->>'job_title') STORED,
  marital_status jsonb GENERATED ALWAYS AS (nullif(sber_profile->'marital_status','null'::jsonb)) STORED,
  is_self_employed boolean GENERATED ALWAYS AS ((sber_profile->>'is_self_employed')::boolean) STORED,
  profile_schema_version integer NOT NULL DEFAULT 1 CHECK (profile_schema_version=1),
  requested_scopes text[] NOT NULL DEFAULT '{}',
  granted_scopes text[],
  identified_at timestamptz NOT NULL,
  profile_received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(identity_provider,sub,user_id) REFERENCES iam.external_identities(provider,subject,user_id)
);
COMMENT ON TABLE profiles.persons IS 'Registered individuals verified through Sber ID. All package fields are generated from the current validated profile snapshot.';
COMMENT ON COLUMN profiles.persons.identity_provider IS 'Constant discriminator for the composite identity ownership foreign key.';
COMMENT ON COLUMN profiles.persons.sber_profile IS 'Allowed Sber userinfo attributes only; access tokens, ID tokens and authorization codes are prohibited.';

CREATE TABLE profiles.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_status text NOT NULL CHECK (legal_status IN ('legal_entity','individual_entrepreneur')),
  inn text NOT NULL UNIQUE,
  legal_name text NOT NULL CHECK (length(btrim(legal_name))>0),
  identity_provider text NOT NULL DEFAULT 'kontur_diadoc' CHECK (identity_provider='kontur_diadoc'),
  provider_organization_id text NOT NULL UNIQUE CHECK (length(btrim(provider_organization_id))>0),
  identified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,legal_status),
  CHECK ((legal_status='legal_entity' AND inn ~ '^[0-9]{10}$') OR
         (legal_status='individual_entrepreneur' AND inn ~ '^[0-9]{12}$'))
);
COMMENT ON TABLE profiles.organizations IS 'Registered organizations/entrepreneurs identified by Diadoc; separate from public.companies directory entries.';

ALTER TABLE party.participants SET SCHEMA profiles;
DROP SCHEMA party; -- Deliberately no CASCADE: any unexpected remaining object aborts the transaction.
ALTER TABLE profiles.participants
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN individual_user_id DROP NOT NULL,
  DROP CONSTRAINT participants_kind_check,
  DROP CONSTRAINT participants_role_check,
  DROP CONSTRAINT participants_legal_status_check,
  ADD COLUMN organization_id uuid,
  ADD CONSTRAINT participants_person_fk FOREIGN KEY(individual_user_id) REFERENCES profiles.persons(user_id),
  ADD CONSTRAINT participants_organization_fk FOREIGN KEY(organization_id,legal_status) REFERENCES profiles.organizations(id,legal_status),
  ADD CONSTRAINT participants_shape_check CHECK (
    (kind='individual' AND role='provider' AND legal_status='individual_person' AND individual_user_id IS NOT NULL AND organization_id IS NULL)
    OR (kind='organization' AND role IN ('customer','provider') AND legal_status IN ('legal_entity','individual_entrepreneur') AND individual_user_id IS NULL AND organization_id IS NOT NULL)
  ),
  ADD CONSTRAINT participants_organization_role_unique UNIQUE(organization_id,role);
COMMENT ON TABLE profiles.participants IS 'A personal provider or an organizational customer/provider context. Context ownership and business role are immutable.';

CREATE TABLE profiles.participant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES iam.users(id),
  participant_id uuid NOT NULL REFERENCES profiles.participants(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,participant_id),
  CHECK ((status='active' AND revoked_at IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL))
);
CREATE INDEX participant_memberships_participant ON profiles.participant_memberships(participant_id);
COMMENT ON TABLE profiles.participant_memberships IS 'Independent user access to each participant. Revoking one membership leaves other contexts and the user account intact.';

ALTER TABLE iam.role_assignments
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  DROP CONSTRAINT role_assignments_role_check,
  ADD CONSTRAINT role_assignments_role_check CHECK (role IN ('provider','customer','organization_admin')),
  ADD CONSTRAINT role_assignments_membership_fk FOREIGN KEY(user_id,scope_id) REFERENCES profiles.participant_memberships(user_id,participant_id);
COMMENT ON TABLE iam.role_assignments IS 'Scoped grants; effective access additionally requires active membership/user and a non-deactivated participant. Organization admin is an additional management grant.';

CREATE FUNCTION profiles.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
CREATE TRIGGER persons_updated BEFORE UPDATE ON profiles.persons FOR EACH ROW EXECUTE FUNCTION profiles.touch_updated_at();
CREATE TRIGGER organizations_updated BEFORE UPDATE ON profiles.organizations FOR EACH ROW EXECUTE FUNCTION profiles.touch_updated_at();

CREATE FUNCTION profiles.guard_participant() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF ROW(NEW.id,NEW.kind,NEW.role,NEW.legal_status,NEW.individual_user_id,NEW.organization_id)
      IS DISTINCT FROM ROW(OLD.id,OLD.kind,OLD.role,OLD.legal_status,OLD.individual_user_id,OLD.organization_id) THEN
    RAISE EXCEPTION 'Participant identity and business role are immutable' USING ERRCODE='23514';
  END IF;
  NEW.updated_at=now(); RETURN NEW;
END $$;
CREATE TRIGGER participant_immutable BEFORE UPDATE ON profiles.participants FOR EACH ROW EXECUTE FUNCTION profiles.guard_participant();

CREATE FUNCTION profiles.guard_membership() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE target_kind text; owner_id uuid;
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.id,NEW.user_id,NEW.participant_id) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.participant_id) THEN
    RAISE EXCEPTION 'Membership association is immutable' USING ERRCODE='23514';
  END IF;
  SELECT kind,individual_user_id INTO target_kind,owner_id FROM profiles.participants WHERE id=NEW.participant_id FOR KEY SHARE;
  IF target_kind='individual' AND owner_id<>NEW.user_id THEN
    RAISE EXCEPTION 'Personal participant membership is restricted to its owner' USING ERRCODE='23514';
  END IF;
  IF NEW.status='active' THEN NEW.revoked_at=NULL;
  ELSIF NEW.status='revoked' AND NEW.revoked_at IS NULL THEN NEW.revoked_at=now(); END IF;
  NEW.updated_at=now(); RETURN NEW;
END $$;
CREATE TRIGGER membership_guard BEFORE INSERT OR UPDATE ON profiles.participant_memberships FOR EACH ROW EXECUTE FUNCTION profiles.guard_membership();

CREATE FUNCTION profiles.guard_role_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE target_kind text; business_role text;
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.id,NEW.user_id,NEW.scope_type,NEW.scope_id,NEW.role) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.scope_type,OLD.scope_id,OLD.role) THEN
    RAISE EXCEPTION 'Role assignment association is immutable' USING ERRCODE='23514';
  END IF;
  SELECT kind,role INTO target_kind,business_role FROM profiles.participants WHERE id=NEW.scope_id FOR KEY SHARE;
  IF (NEW.role='organization_admin' AND target_kind<>'organization')
     OR (NEW.role IN ('provider','customer') AND NEW.role<>business_role) THEN
    RAISE EXCEPTION 'Grant does not match participant kind or business role' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER role_assignment_guard BEFORE INSERT OR UPDATE ON iam.role_assignments FOR EACH ROW EXECUTE FUNCTION profiles.guard_role_assignment();

CREATE FUNCTION profiles.require_personal_participant() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE target_user uuid;
BEGIN
  IF TG_TABLE_NAME='persons' THEN target_user=NEW.user_id;
  ELSE target_user=OLD.individual_user_id; END IF;
  IF target_user IS NOT NULL AND EXISTS (SELECT 1 FROM profiles.persons WHERE user_id=target_user)
     AND NOT EXISTS (SELECT 1 FROM profiles.participants WHERE individual_user_id=target_user) THEN
    RAISE EXCEPTION 'A registered person requires a personal provider participant' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER person_requires_participant AFTER INSERT OR UPDATE ON profiles.persons
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION profiles.require_personal_participant();
CREATE CONSTRAINT TRIGGER keep_personal_participant AFTER DELETE OR UPDATE ON profiles.participants
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION profiles.require_personal_participant();

-- New functions are not a public API. The trusted app role receives explicit grants.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA profiles FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='forum_app_role') THEN
    GRANT USAGE ON SCHEMA iam,profiles,integration,audit TO forum_app_role;
    GRANT SELECT,INSERT,UPDATE ON iam.users,iam.external_identities,profiles.persons,profiles.organizations,profiles.participants,profiles.participant_memberships TO forum_app_role;
    GRANT SELECT,INSERT,UPDATE,DELETE ON iam.sessions,iam.authorization_attempts TO forum_app_role;
    GRANT SELECT,INSERT,DELETE ON iam.role_assignments TO forum_app_role;
    GRANT SELECT,INSERT ON integration.outbox_events,audit.audit_events TO forum_app_role;
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA integration TO forum_app_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA profiles TO forum_app_role;
  END IF;
END $$;
