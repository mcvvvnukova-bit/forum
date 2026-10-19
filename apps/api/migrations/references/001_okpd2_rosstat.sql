CREATE TABLE public.okpd_sections (
 code char(1) PRIMARY KEY CHECK(code BETWEEN 'A' AND 'U'),name text NOT NULL,
 is_active boolean NOT NULL DEFAULT true,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.okpds (
 okpd varchar(12) PRIMARY KEY,parent_code varchar(12) REFERENCES public.okpds(okpd) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 level smallint NOT NULL CHECK(level BETWEEN 1 AND 6),section char(1) NOT NULL REFERENCES public.okpd_sections(code),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 2000),is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX okpds_active_code_idx ON public.okpds(okpd varchar_pattern_ops) WHERE is_active;
CREATE TABLE public.okpd_reference_state (
 id text PRIMARY KEY CHECK(id='okpd2'),revision bigint NOT NULL DEFAULT 0,
 published_hash varchar(64),published_at timestamptz,source_metadata jsonb,last_checked_at timestamptz
);
INSERT INTO public.okpd_reference_state(id) VALUES ('okpd2');
CREATE TABLE public.okpd_imports (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 status text NOT NULL CHECK(status IN ('running','unchanged','published','pending_review','rejected','superseded','failed')),
 source_url text NOT NULL,started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 source_metadata jsonb,snapshot_hash varchar(64),base_revision bigint,baseline_hash varchar(64),snapshot jsonb,diff jsonb,
 review_reasons jsonb NOT NULL DEFAULT '[]',error text,decided_by text,decided_at timestamptz,decision_reason text
);
CREATE INDEX okpd_imports_review_idx ON public.okpd_imports(status,id DESC);
CREATE INDEX okpd_imports_hash_idx ON public.okpd_imports(snapshot_hash,base_revision);
COMMENT ON TABLE public.okpds IS 'Published consolidated OKPD2 from Rosstat; source edition is not a legal effective-date assertion';
