-- Explicit operator rollback only after preserving the task database backup/journal.
-- Queue namespace is stopped/dropped separately, never alongside the OKVED worker.
DROP TABLE public.okpd_imports;
DROP TABLE public.okpd_reference_state;
DROP TABLE public.okpds;
DROP TABLE public.okpd_sections;
DROP TABLE public.okpd_schema_migrations;
