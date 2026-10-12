-- Extends the existing bootstrap layout without deleting historical codes or mappings.
CREATE TABLE IF NOT EXISTS public.business_segments (
  code text PRIMARY KEY, name text NOT NULL UNIQUE, description text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.commercial_roles (
  code text PRIMARY KEY, name text NOT NULL UNIQUE, description text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.offer_types (
  code text PRIMARY KEY, name text NOT NULL UNIQUE, description text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.okveds (
  okved varchar(8) PRIMARY KEY,
  parent_code varchar(8) REFERENCES public.okveds(okved) ON UPDATE CASCADE ON DELETE RESTRICT,
  level smallint NOT NULL CHECK (level > 0), section char(1) NOT NULL, name text NOT NULL,
  business_segment_code text REFERENCES public.business_segments(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  commercial_role_code text REFERENCES public.commercial_roles(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  offer_type_code text REFERENCES public.offer_types(code) ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.okveds ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE public.okveds ADD COLUMN IF NOT EXISTS selectable boolean NOT NULL DEFAULT false;
ALTER TABLE public.okveds ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS public.okved_groups (
  code char(1) PRIMARY KEY, name text NOT NULL, size integer NOT NULL CHECK (size >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.okved_reference_state (
  id text PRIMARY KEY CHECK (id='okved2'), revision bigint NOT NULL DEFAULT 0,
  published_hash varchar(64), published_at timestamptz
);
INSERT INTO public.okved_reference_state(id) VALUES ('okved2') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.okved_imports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('running','unchanged','published','pending_review','rejected','superseded','failed')),
  source_url text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  snapshot_hash varchar(64), base_revision bigint, baseline_hash varchar(64),
  snapshot jsonb, diff jsonb, review_reasons jsonb NOT NULL DEFAULT '[]', error text,
  decided_by text, decided_at timestamptz, decision_reason text
);
CREATE INDEX IF NOT EXISTS okved_imports_review_idx ON public.okved_imports(status,id DESC);
CREATE INDEX IF NOT EXISTS okved_imports_hash_idx ON public.okved_imports(snapshot_hash,base_revision);
CREATE INDEX IF NOT EXISTS okveds_active_parent_idx ON public.okveds(parent_code) WHERE is_active;
COMMENT ON COLUMN public.okveds.is_active IS 'Present in the published FNS snapshot; not a legal effective-date assertion';
