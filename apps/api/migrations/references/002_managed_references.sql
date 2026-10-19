-- Standalone additive reference migration. Never invoke the legacy company bootstrap.
CREATE TABLE IF NOT EXISTS public.regions(code smallint PRIMARY KEY,name text NOT NULL);
CREATE TABLE IF NOT EXISTS public.company_statuses(code text PRIMARY KEY,name text NOT NULL);
CREATE TABLE IF NOT EXISTS public.offer_types(code text PRIMARY KEY,name text NOT NULL UNIQUE,description text);
CREATE TABLE IF NOT EXISTS public.business_segments(code text PRIMARY KEY,name text NOT NULL UNIQUE,description text);
CREATE TABLE IF NOT EXISTS public.commercial_roles(code text PRIMARY KEY,name text NOT NULL UNIQUE,description text);
CREATE TABLE IF NOT EXISTS public.units(code text PRIMARY KEY,name text NOT NULL,description text,symbol text);
CREATE TABLE IF NOT EXISTS public.moderation_reasons(code text PRIMARY KEY,name text NOT NULL,description text);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['regions','company_statuses','offer_types','business_segments','commercial_roles','units','moderation_reasons'] LOOP
  EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
   ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
   ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK(version>0),
   ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
   ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id)',t);
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT managed_reference_deletion CHECK ((deleted_at IS NULL)=(deleted_by IS NULL))',t);
 END LOOP;
END $$;
CREATE TABLE public.reference_idempotency(
 actor_user_id uuid NOT NULL REFERENCES public.users(id),idempotency_key text NOT NULL,
 request_hash text NOT NULL,response_status integer NOT NULL CHECK(response_status IN(200,201)),
 response_body jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_user_id,idempotency_key)
);
