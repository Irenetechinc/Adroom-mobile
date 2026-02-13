-- Enable pg_net extension for HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Function to call the autonomous-worker Edge Function
CREATE OR REPLACE FUNCTION trigger_autonomous_worker()
RETURNS TRIGGER AS $$
DECLARE
  project_url TEXT := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/autonomous-worker';
  service_key TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ycmdqdnJudGVubGt2c2xmdmZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NzIxMzgsImV4cCI6MjA4NTE0ODEzOH0.wIwrxgBTsYsx1jGSDDgNw3iPPHN0TZ8v7psen51Z9ks'; -- In production, use vault or env vars if possible
  payload JSONB;
BEGIN
  -- Construct payload
  payload := jsonb_build_object(
    'table', TG_TABLE_NAME,
    'type', TG_OP,
    'schema', TG_TABLE_SCHEMA,
    'record', NEW
  );

  -- Perform HTTP POST request to Edge Function
  -- Note: net.http_post is asynchronous
  PERFORM net.http_post(
    url := project_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := payload
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for Comments
DROP TRIGGER IF EXISTS on_comment_created ON comments;
CREATE TRIGGER on_comment_created
  AFTER INSERT ON comments
  FOR EACH ROW
  EXECUTE FUNCTION trigger_autonomous_worker();

-- Trigger for Messages
DROP TRIGGER IF EXISTS on_message_created ON messages;
CREATE TRIGGER on_message_created
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION trigger_autonomous_worker();

-- Schedule Cron Job for Lead Follow-up (Runs every hour)
-- Requires pg_cron extension
SELECT cron.schedule(
  'autonomous-lead-followup',
  '0 * * * *', -- Every hour
  $$
  SELECT net.http_post(
      url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/autonomous-worker',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_KEY"}'::jsonb,
      body := '{"type": "SCHEDULED_TASK"}'::jsonb
  );
  $$
);
