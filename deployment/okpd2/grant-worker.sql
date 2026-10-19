-- Run only as the database/schema owner after `okpd2-cli migrate`.
-- psql: -v worker_role=forum_okpd2_worker -v ON_ERROR_STOP=1
BEGIN;
GRANT CONNECT ON DATABASE :"DBNAME" TO :"worker_role";
GRANT USAGE ON SCHEMA public TO :"worker_role";
GRANT SELECT(okpd,section,name,parent_code,level,is_active) ON public.okpds TO :"worker_role";
GRANT INSERT(okpd,parent_code,level,section,name,is_active),UPDATE(parent_code,level,section,name,is_active,updated_at) ON public.okpds TO :"worker_role";
GRANT SELECT,INSERT,UPDATE ON public.okpd_sections,public.okpd_imports TO :"worker_role";
GRANT SELECT,UPDATE ON public.okpd_reference_state TO :"worker_role";
GRANT USAGE,SELECT ON SEQUENCE public.okpd_imports_id_seq TO :"worker_role";
-- pg-boss maintains partitions only in its own private namespace.
ALTER SCHEMA forum_okpd2_jobs OWNER TO :"worker_role";
SELECT format('ALTER TABLE %I.%I OWNER TO %I',schemaname,tablename,:'worker_role') FROM pg_tables WHERE schemaname='forum_okpd2_jobs' \gexec
SELECT format('ALTER SEQUENCE %I.%I OWNER TO %I',sequence_schema,sequence_name,:'worker_role') FROM information_schema.sequences WHERE sequence_schema='forum_okpd2_jobs' \gexec
SELECT format('ALTER FUNCTION %s OWNER TO %I',p.oid::regprocedure,:'worker_role') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='forum_okpd2_jobs' \gexec
COMMIT;
