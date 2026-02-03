-- Chat History
CREATE TABLE IF NOT EXISTS chat_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  text TEXT,
  sender VARCHAR(20) CHECK (sender IN ('user', 'agent')),
  image_uri TEXT,
  ui_type VARCHAR(50),
  ui_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Leads for Follow-up
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'new',
  last_interaction TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  interest_level VARCHAR(20),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Comments (simulating external platform comments)
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  platform VARCHAR(50),
  external_id VARCHAR(255),
  content TEXT,
  author_name VARCHAR(255),
  is_replied BOOLEAN DEFAULT FALSE,
  reply_content TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Policies
ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'chat_history' AND policyname = 'Users can manage their own chat history') THEN
        CREATE POLICY "Users can manage their own chat history" ON chat_history FOR ALL USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'leads' AND policyname = 'Users can manage their own leads') THEN
        CREATE POLICY "Users can manage their own leads" ON leads FOR ALL USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'comments' AND policyname = 'Users can manage their own comments') THEN
        CREATE POLICY "Users can manage their own comments" ON comments FOR ALL USING (auth.uid() = user_id);
    END IF;
END $$;
