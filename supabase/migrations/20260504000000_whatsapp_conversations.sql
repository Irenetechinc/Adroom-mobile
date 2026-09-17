-- Add reply_content to messages table for storing AI replies
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_content TEXT,
  ADD COLUMN IF NOT EXISTS is_liked BOOLEAN DEFAULT FALSE;

-- Add conversation_history to agent_leads for multi-turn conversation tracking
ALTER TABLE public.agent_leads
  ADD COLUMN IF NOT EXISTS conversation_history JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS conversation_stage TEXT DEFAULT 'intro';

-- Index for fast WhatsApp lead lookups by phone
CREATE INDEX IF NOT EXISTS idx_agent_leads_whatsapp_phone
  ON public.agent_leads (user_id, platform, platform_user_id)
  WHERE platform = 'whatsapp';
