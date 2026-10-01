\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() NOT LIKE '%\_test' THEN RAISE EXCEPTION 'Synthetic seed requires a dedicated _test database'; END IF;
END $$;
INSERT INTO iam.users(id,display_name) VALUES ('90000000-0000-4000-8000-000000000001','Synthetic transition fixture');
INSERT INTO iam.external_identities(id,user_id,provider,subject,claims_snapshot)
  VALUES ('90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000001','sber_id','public-transition-fixture','{}');
INSERT INTO profiles.persons(user_id,sber_profile,identified_at,profile_received_at)
  VALUES ('90000000-0000-4000-8000-000000000001','{"sub":"public-transition-fixture","birthdate":"2000-02-29","inn":{"number":"001234567890"}}',now(),now());
INSERT INTO profiles.participants(id,kind,role,legal_status,individual_user_id)
  VALUES ('90000000-0000-4000-8000-000000000003','individual','provider','individual_person','90000000-0000-4000-8000-000000000001');
INSERT INTO profiles.organizations(id,legal_status,inn,legal_name,provider_organization_id,identified_at)
  VALUES ('90000000-0000-4000-8000-000000000004','legal_entity','0987654321','Synthetic transition organization','public-transition-org',now());
INSERT INTO profiles.participants(id,kind,role,legal_status,organization_id)
  VALUES ('90000000-0000-4000-8000-000000000005','organization','customer','legal_entity','90000000-0000-4000-8000-000000000004');
INSERT INTO profiles.participant_memberships(user_id,participant_id) VALUES
  ('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000003'),
  ('90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000005');
INSERT INTO iam.role_assignments(user_id,scope_type,scope_id,role) VALUES
  ('90000000-0000-4000-8000-000000000001','participant','90000000-0000-4000-8000-000000000003','provider'),
  ('90000000-0000-4000-8000-000000000001','participant','90000000-0000-4000-8000-000000000005','customer');
INSERT INTO audit.audit_events(id,actor_user_id,action,data)
  VALUES ('90000000-0000-4000-8000-000000000006','90000000-0000-4000-8000-000000000001','SyntheticMigrationTest','{}');
INSERT INTO integration.outbox_events(event_id,aggregate_type,aggregate_id,event_type,payload)
  VALUES ('90000000-0000-4000-8000-000000000007','participant','90000000-0000-4000-8000-000000000003','SyntheticMigrationTest','{}');
SELECT setval('integration.outbox_events_sequence_seq',42,true);
COMMIT;
