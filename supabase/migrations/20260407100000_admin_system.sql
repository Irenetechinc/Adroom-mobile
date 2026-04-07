-- Device push tokens for Expo push notifications
CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  token TEXT NOT NULL,
  platform TEXT DEFAULT 'unknown',
  app_version TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, token)
);

ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own push tokens" ON public.device_push_tokens FOR ALL USING (auth.uid() = user_id);

-- Admin action audit log
CREATE TABLE IF NOT EXISTS public.admin_action_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target_user_id UUID,
  target_user_email TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User status overrides (suspend/terminate)
CREATE TABLE IF NOT EXISTS public.user_status_overrides (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  reason TEXT,
  applied_by TEXT,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notification delivery log
CREATE TABLE IF NOT EXISTS public.notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_by TEXT NOT NULL,
  target TEXT NOT NULL, -- 'all', 'user:<id>', 'plan:<plan>'
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  recipients_count INT DEFAULT 0,
  delivery_results JSONB DEFAULT '{}',
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

NOTIFY pgrst, 'reload schema';
