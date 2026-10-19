-- Administrative rollback only. Base reference rows and keys are deliberately preserved.
-- Export reference_idempotency and deletion metadata before rollback.
DO $$ DECLARE t text; used boolean; BEGIN
 FOREACH t IN ARRAY ARRAY['regions','company_statuses','offer_types','business_segments','commercial_roles','units','moderation_reasons'] LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE deleted_at IS NOT NULL)',t) INTO used;
  IF used THEN RAISE EXCEPTION 'Rollback refused: preserve soft deletion metadata before reverting managed references'; END IF;
 END LOOP;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['regions','company_statuses','offer_types','business_segments','commercial_roles','units','moderation_reasons'] LOOP
  EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT managed_reference_deletion,
   DROP COLUMN version,DROP COLUMN deleted_at,DROP COLUMN deleted_by',t);
 END LOOP;
END $$;
DROP TABLE public.reference_idempotency;
DELETE FROM public.managed_reference_schema_migrations WHERE name='002_managed_references';
