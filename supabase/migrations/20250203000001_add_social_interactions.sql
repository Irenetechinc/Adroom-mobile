-- Messages (Direct Messages / Inbox)
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  platform VARCHAR(50) DEFAULT 'facebook',
  conversation_id VARCHAR(255) NOT NULL, -- External conversation ID
  external_id VARCHAR(255) UNIQUE, -- Message ID from platform
  content TEXT,
  sender_name VARCHAR(255),
  is_from_page BOOLEAN DEFAULT FALSE,
  is_replied BOOLEAN DEFAULT FALSE,
  is_liked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Update Comments to support nesting and likes
ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES comments(id);
ALTER TABLE comments ADD COLUMN IF NOT EXISTS external_parent_id VARCHAR(255); -- For mapping external hierarchy
ALTER TABLE comments ADD COLUMN IF NOT EXISTS is_liked BOOLEAN DEFAULT FALSE;

-- RLS for messages
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'messages' AND policyname = 'Users can manage their own messages') THEN
        CREATE POLICY "Users can manage their own messages" ON messages FOR ALL USING (auth.uid() = user_id);
    END IF;
END $$;
