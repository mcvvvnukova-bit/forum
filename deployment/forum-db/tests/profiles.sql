\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.persons') IS NULL THEN
    RAISE EXCEPTION 'public.persons is missing';
  END IF;
END $$;

CREATE FUNCTION pg_temp.assert_true(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;
CREATE FUNCTION pg_temp.must_fail(statement text, expected_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = expected_state THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'Expected SQLSTATE % for %', expected_state, statement;
END $$;

INSERT INTO public.users(id,display_name) VALUES
 ('00000000-0000-4000-8000-000000000001','Synthetic person A'),
 ('00000000-0000-4000-8000-000000000002','Synthetic person B');
INSERT INTO public.external_identities(id,user_id,provider,subject,claims_snapshot) VALUES
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','sber_id','synthetic-sber-a','{}'),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','sber_id','synthetic-sber-b','{}');

INSERT INTO public.persons(user_id,sber_profile,identified_at,profile_received_at)
VALUES ('00000000-0000-4000-8000-000000000001',
'{"sub":"synthetic-sber-a","email":"a@example.invalid","phone_number":"+70000000000","birthdate":"2000-02-29","family_name":"Synthetic","given_name":"A","middle_name":"Test","gender":1,"identification":{"series":"0010","number":"000001","issued_by":"TEST","issued_date":"2020-01-01","code":"000-001"},"inn":{"number":"000000000001"},"snils":{"number":"00000000001"},"driving_license":{"number":"000001"},"international_passport":{"series":"01","number":"000002","issued_by":"TEST","issued_date":"2020-01-01","planned_end_date":"2030-01-01","name":"A","surname":"Synthetic"},"priority_doc":{"type":17,"series":"0010","number":"000001","issued_by":"TEST","issued_date":"2020-01-01","code":"000-001"},"citizenship":{"country_code":"RUS","country_name":"Test"},"place_of_birth":"Test","address_reg":{"full_address":"Test 1","fias_code":"test","post_index":"000001","country":"Test","region":"Test","district":"Test","city":"Test","settlement":"Test","street":"Test","house":"1","building":"2","bulk":"3","apartment":"4"},"work_address":{"full_address":"Test 2"},"address_of_actual_residence":{"full_address":"Test 3"},"delivery_address":{"full_address":"Test 4"},"address":{"full_address":"Test legacy"},"sts":{"number":"000003"},"previous_identification":{"series":"0010","number":"000004","issued_by":"TEST","issued_date":"2015-01-01","code":"000-002"},"previous_family_name":"Before","previous_given_name":"Before A","previous_middle_name":"Before Test","education":{"code":"1","description":"Test"},"place_of_work":"Test Org","job_title":"Test Job","marital_status":{"code":1,"description":"Test"},"is_self_employed":false}',now(),now());

DO $$ DECLARE profile public.persons%ROWTYPE; column_count integer; BEGIN
 SELECT * INTO profile FROM public.persons WHERE user_id='00000000-0000-4000-8000-000000000001';
 PERFORM pg_temp.assert_true(profile.inn->>'number'='000000000001' AND profile.identification->>'series'='0010','leading zeroes were lost');
 PERFORM pg_temp.assert_true(profile.birthdate=DATE '2000-02-29' AND profile.is_self_employed=false,'typed values incorrect');
 PERFORM pg_temp.assert_true(profile.international_passport->>'surname'='Synthetic' AND profile.address_reg->>'apartment'='4' AND profile.previous_identification->>'code'='000-002','nested data lost');
 PERFORM pg_temp.assert_true((to_jsonb(profile)-ARRAY['user_id','sber_profile','identity_provider','profile_schema_version','requested_scopes','granted_scopes','identified_at','profile_received_at','created_at','updated_at'])=profile.sber_profile,'a package field was lost or mapped to the wrong column');
 SELECT count(*) INTO column_count FROM information_schema.columns WHERE table_schema='public' AND table_name='persons' AND is_generated='ALWAYS' AND column_name <> 'identity_provider';
 PERFORM pg_temp.assert_true(column_count=31,'all 30 attributes and legacy address must be projected');
END $$;
UPDATE public.persons SET sber_profile=jsonb_set(sber_profile,'{is_self_employed}','true') WHERE user_id='00000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(is_self_employed=true,'self-employment true was lost') FROM public.persons WHERE user_id='00000000-0000-4000-8000-000000000001';
UPDATE public.persons SET sber_profile='{"sub":"synthetic-sber-a","birthdate":"29.02.2000"}' WHERE user_id='00000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(is_self_employed IS NULL AND inn IS NULL AND birthdate=DATE '2000-02-29','missing data or dotted date incorrect') FROM public.persons WHERE user_id='00000000-0000-4000-8000-000000000001';
SELECT pg_temp.must_fail($q$UPDATE public.persons SET sber_profile='{"sub":"synthetic-sber-a","access_token":"never-store"}' WHERE user_id='00000000-0000-4000-8000-000000000001'$q$,'23514');
SELECT pg_temp.must_fail($q$UPDATE public.persons SET sber_profile='{"sub":"synthetic-sber-a","identification":{"access_token":"never-store"}}' WHERE user_id='00000000-0000-4000-8000-000000000001'$q$,'23514');
SELECT pg_temp.must_fail($q$UPDATE public.persons SET sber_profile='{"sub":"synthetic-sber-b"}' WHERE user_id='00000000-0000-4000-8000-000000000001'$q$,'23503');
SELECT pg_temp.must_fail($q$INSERT INTO public.persons(user_id,sber_profile,identified_at,profile_received_at) VALUES ('00000000-0000-4000-8000-000000000001','{"sub":"synthetic-sber-a"}',now(),now())$q$,'23505');

INSERT INTO public.participants(id,kind,role,legal_status,individual_user_id) VALUES
 ('20000000-0000-4000-8000-000000000001','individual','provider','individual_person','00000000-0000-4000-8000-000000000001');
SELECT pg_temp.must_fail($q$INSERT INTO public.participants(id,kind,role,legal_status,individual_user_id) VALUES ('20000000-0000-4000-8000-000000000009','individual','customer','individual_person','00000000-0000-4000-8000-000000000001')$q$,'23514');
INSERT INTO public.organizations(id,legal_status,inn,legal_name,provider_organization_id,identified_at) VALUES
 ('30000000-0000-4000-8000-000000000001','legal_entity','0000000001','Synthetic org 1','synthetic-diadoc-1',now()),
 ('30000000-0000-4000-8000-000000000002','legal_entity','0000000002','Synthetic org 2','synthetic-diadoc-2',now());
INSERT INTO public.participants(id,kind,role,legal_status,organization_id) VALUES
 ('20000000-0000-4000-8000-000000000002','organization','provider','legal_entity','30000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000003','organization','customer','legal_entity','30000000-0000-4000-8000-000000000002');
INSERT INTO public.participant_memberships(user_id,participant_id) VALUES
 ('00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002'),
 ('00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003'),
 ('00000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003');
SELECT pg_temp.must_fail($q$INSERT INTO public.participant_memberships(user_id,participant_id) VALUES ('00000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001')$q$,'23514');
SELECT pg_temp.must_fail($q$INSERT INTO public.participant_memberships(user_id,participant_id) VALUES ('00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002')$q$,'23505');
INSERT INTO public.role_assignments(id,user_id,scope_type,scope_id,role) VALUES
 ('40000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','participant','20000000-0000-4000-8000-000000000001','provider'),
 ('40000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','participant','20000000-0000-4000-8000-000000000002','provider'),
 ('40000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','participant','20000000-0000-4000-8000-000000000003','customer'),
 ('40000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','participant','20000000-0000-4000-8000-000000000003','organization_admin');
SELECT pg_temp.must_fail($q$INSERT INTO public.role_assignments(id,user_id,scope_type,scope_id,role) VALUES ('40000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000001','participant','20000000-0000-4000-8000-000000000001','organization_admin')$q$,'23514');
SELECT pg_temp.must_fail($q$INSERT INTO public.role_assignments(id,user_id,scope_type,scope_id,role) VALUES ('40000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000001','participant','20000000-0000-4000-8000-000000000002','customer')$q$,'23514');
SELECT pg_temp.must_fail($q$INSERT INTO public.role_assignments(id,user_id,scope_type,scope_id,role) VALUES ('40000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000002','participant','20000000-0000-4000-8000-000000000002','provider')$q$,'23503');
UPDATE public.participant_memberships SET status='revoked' WHERE user_id='00000000-0000-4000-8000-000000000001' AND participant_id='20000000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_true(count(DISTINCT r.scope_id)=2,'revocation leaked to other participants or still grants revoked organization') FROM public.role_assignments r JOIN public.participant_memberships m ON (m.user_id,m.participant_id)=(r.user_id,r.scope_id) WHERE r.user_id='00000000-0000-4000-8000-000000000001' AND m.status='active';
SELECT pg_temp.assert_true(status='active','another employee lost access') FROM public.participant_memberships WHERE user_id='00000000-0000-4000-8000-000000000002';
SELECT pg_temp.must_fail($q$UPDATE public.participants SET role='provider' WHERE id='20000000-0000-4000-8000-000000000003'$q$,'23514');
SELECT pg_temp.must_fail($q$UPDATE public.participant_memberships SET user_id='00000000-0000-4000-8000-000000000002' WHERE participant_id='20000000-0000-4000-8000-000000000002'$q$,'23514');
SELECT pg_temp.must_fail($q$INSERT INTO public.persons(user_id,sber_profile,identified_at,profile_received_at) VALUES ('00000000-0000-4000-8000-000000000002','{"sub":"synthetic-sber-b"}',now(),now()); SET CONSTRAINTS ALL IMMEDIATE$q$,'23514');
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
\echo 'Profiles behavioral checks passed; synthetic records rolled back.'
