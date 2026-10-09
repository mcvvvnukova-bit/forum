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

-- Canonical person data is independent of provider snapshots and participation.
INSERT INTO public.persons(user_id,family_name,birthdate,inn,is_self_employed) VALUES
 ('00000000-0000-4000-8000-000000000001','Canonical',DATE '2000-02-29','{"number":"000000000001"}',false),
 ('00000000-0000-4000-8000-000000000002','Generic',NULL,NULL,NULL);
INSERT INTO public.identity_profiles(identity_id,user_id,snapshot,requested_scopes,granted_scopes,identified_at,received_at) VALUES
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','{"sub":"synthetic-sber-a","family_name":"Source","birthdate":"29.02.2000"}','{openid,name}','{openid}',now(),now());
SELECT pg_temp.assert_true(family_name='Canonical' AND birthdate=DATE '2000-02-29' AND inn->>'number'='000000000001' AND is_self_employed=false,'canonical values incorrect') FROM public.persons WHERE user_id='00000000-0000-4000-8000-000000000001';
UPDATE public.identity_profiles SET snapshot=jsonb_set(snapshot,'{family_name}','"New source"') WHERE identity_id='10000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(family_name='Canonical','returning source snapshot replaced canonical data') FROM public.persons WHERE user_id='00000000-0000-4000-8000-000000000001';
UPDATE public.persons SET family_name='Edited canonical' WHERE user_id='00000000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_true(snapshot->>'family_name'='New source','canonical edit changed source data') FROM public.identity_profiles WHERE identity_id='10000000-0000-4000-8000-000000000001';
SELECT pg_temp.must_fail($q$UPDATE public.identity_profiles SET user_id='00000000-0000-4000-8000-000000000002'$q$,'23514');
SELECT pg_temp.must_fail($q$INSERT INTO public.identity_profiles(identity_id,user_id,snapshot,identified_at,received_at) VALUES ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','{}',now(),now())$q$,'23503');
SELECT pg_temp.must_fail($q$INSERT INTO public.persons(user_id) VALUES ('00000000-0000-4000-8000-000000000001')$q$,'23505');
SELECT pg_temp.assert_true(count(*)=0,'account unexpectedly required a participant') FROM public.participants;

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
SELECT pg_temp.assert_true(NOT public.effective_business_access('00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','customer',true),'pending corporate registration granted business access');
UPDATE public.role_assignments SET status='revoked',revoked_at=now() WHERE id='40000000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_true(status='revoked' AND revoked_at IS NOT NULL,'grant lifecycle mutation failed') FROM public.role_assignments WHERE id='40000000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_true(status='active','grant revocation changed membership') FROM public.participant_memberships WHERE user_id='00000000-0000-4000-8000-000000000001' AND participant_id='20000000-0000-4000-8000-000000000003';
UPDATE public.participant_memberships SET status='revoked' WHERE user_id='00000000-0000-4000-8000-000000000001' AND participant_id='20000000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_true(count(DISTINCT r.scope_id)=2,'revocation leaked to other participants or still grants revoked organization') FROM public.role_assignments r JOIN public.participant_memberships m ON (m.user_id,m.participant_id)=(r.user_id,r.scope_id) WHERE r.user_id='00000000-0000-4000-8000-000000000001' AND m.status='active';
SELECT pg_temp.assert_true(status='active','another employee lost access') FROM public.participant_memberships WHERE user_id='00000000-0000-4000-8000-000000000002';
SELECT pg_temp.must_fail($q$UPDATE public.participants SET role='provider' WHERE id='20000000-0000-4000-8000-000000000003'$q$,'23514');
SELECT pg_temp.must_fail($q$UPDATE public.participant_memberships SET user_id='00000000-0000-4000-8000-000000000002' WHERE participant_id='20000000-0000-4000-8000-000000000002'$q$,'23514');
SELECT pg_temp.assert_true(count(*)=0,'generic person acquired a mandatory personal participant') FROM public.participants WHERE individual_user_id='00000000-0000-4000-8000-000000000002';
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
\echo 'Profiles behavioral checks passed; synthetic records rolled back.'
