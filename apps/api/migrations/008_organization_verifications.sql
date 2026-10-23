-- Technical verification evidence only. No membership, authority or business-role writes.
CREATE TABLE public.organization_verifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 inn text NOT NULL,
 method text NOT NULL CHECK (method IN ('diadoc','kep')),
 request_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'checking' CHECK (status IN ('checking','connection_required','signature_required','access_confirmed','access_denied','unavailable','selection_required')),
 source text NOT NULL DEFAULT 'unconfigured' CHECK (source IN ('unconfigured','diadoc_staging','diadoc_production','simulation')),
 reason text,
 evidence jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(evidence)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 checked_at timestamptz,
 expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '10 minutes'),
 UNIQUE(user_id,request_id),
 FOREIGN KEY(user_id,inn) REFERENCES public.organization_additions(user_id,inn) ON DELETE CASCADE,
 CHECK ((status='checking')=(checked_at IS NULL)),
 CHECK (reason IS NULL OR length(reason)<=64)
);
CREATE INDEX organization_verifications_owner_inn ON public.organization_verifications(user_id,inn,created_at DESC,id DESC);
