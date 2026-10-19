-- Apply as owner to both the runtime login and its inherited group, with app_role set.
\set ON_ERROR_STOP on
BEGIN;
REVOKE ALL ON public.reference_idempotency FROM :"app_role";
GRANT SELECT,INSERT ON public.reference_idempotency TO :"app_role";
SELECT format('REVOKE ALL ON public.%I FROM %I',t,:'app_role') FROM unnest(ARRAY['regions','company_statuses','offer_types','business_segments','commercial_roles','units','moderation_reasons']) t \gexec
SELECT format('REVOKE ALL PRIVILEGES (%I) ON public.%I FROM %I',a.attname,c.relname,:'app_role') FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(ARRAY['regions','company_statuses','offer_types','business_segments','commercial_roles','units','moderation_reasons']) AND a.attacl IS NOT NULL \gexec
SELECT format('GRANT SELECT,INSERT(code,name) ON public.%I TO %I',t,:'app_role') FROM unnest(ARRAY['regions','company_statuses','offer_types','business_segments','commercial_roles','units','moderation_reasons']) t \gexec
SELECT format('GRANT INSERT(description) ON public.%I TO %I',t,:'app_role') FROM unnest(ARRAY['offer_types','business_segments','commercial_roles','units','moderation_reasons']) t \gexec
GRANT INSERT(symbol) ON public.units TO :"app_role";
SELECT format('GRANT UPDATE(name,updated_at,version,deleted_at,deleted_by) ON public.%I TO %I',t,:'app_role') FROM unnest(ARRAY['regions','company_statuses','offer_types','business_segments','commercial_roles','units','moderation_reasons']) t \gexec
SELECT format('GRANT UPDATE(description) ON public.%I TO %I',t,:'app_role') FROM unnest(ARRAY['offer_types','business_segments','commercial_roles','units','moderation_reasons']) t \gexec
GRANT UPDATE(symbol) ON public.units TO :"app_role";
COMMIT;
