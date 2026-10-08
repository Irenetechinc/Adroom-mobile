CREATE TABLE IF NOT EXISTS public.email_oauth_states (
  state TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.email_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_oauth_states FROM anon, authenticated;
GRANT ALL ON TABLE public.email_oauth_states TO service_role;
CREATE INDEX IF NOT EXISTS email_oauth_states_expires_idx
  ON public.email_oauth_states (expires_at);

INSERT INTO public.feature_flags (flag_key, label, description, enabled) VALUES
  ('social_email_connections', 'Email Connections', 'Allow users to connect email accounts and use email conversations', true),
  ('social_email_coming_soon', 'Email Coming Soon', 'Show email connections as unavailable while the feature is being prepared', false)
ON CONFLICT (flag_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
