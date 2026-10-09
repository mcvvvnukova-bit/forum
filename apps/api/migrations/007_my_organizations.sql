-- Additive personal cards only: this table grants no corporate access.
CREATE TABLE public.organization_additions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id),
  inn text NOT NULL CHECK (inn ~ '^([0-9]{10}|[0-9]{12})$' AND inn !~ '^0+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,inn)
);
COMMENT ON TABLE public.organization_additions IS 'Owned pending INN cards. Not verification, membership, participant or authority evidence. Retain on application rollback.';
REVOKE ALL ON public.organization_additions FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='forum_app_role') THEN
  GRANT SELECT,INSERT ON public.organization_additions TO forum_app_role;
 END IF;
END $$;
