<<<<<<< HEAD
=======
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

>>>>>>> adroom-mobile
-- Update the function to call Railway instead of internal Edge Function
CREATE OR REPLACE FUNCTION trigger_autonomous_worker()
RETURNS TRIGGER AS $$
DECLARE
  -- REPLACE THIS WITH YOUR DEPLOYED RAILWAY URL (pointing to the database trigger endpoint)
  project_url TEXT := 'https://adroom-mobile-production.up.railway.app/webhooks/database';
  service_key TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ycmdqdnJudGVubGt2c2xmdmZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NzIxMzgsImV4cCI6MjA4NTE0ODEzOH0.wIwrxgBTsYsx1jGSDDgNw3iPPHN0TZ8v7psen51Z9ks'; -- Use vault/secrets in production
  payload JSONB;
BEGIN
  -- Construct payload
  payload := jsonb_build_object(
    'table', TG_TABLE_NAME,
    'type', TG_OP,
    'schema', TG_TABLE_SCHEMA,
    'record', NEW
  );

  -- Perform HTTP POST request to Railway
  PERFORM net.http_post(
    url := project_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json'
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

-- Schedule Cron Job for Lead Follow-up (Targeting Railway)
SELECT cron.schedule(
  'autonomous-lead-followup',
  '0 * * * *', -- Every hour
  $$
  SELECT net.http_post(
<<<<<<< HEAD
      url := 'https://your-railway-app-url.up.railway.app/webhooks/database',
=======
      url := 'adroom-mobile-production.up.railway.app/webhooks/database',
>>>>>>> adroom-mobile
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{"type": "SCHEDULED_TASK"}'::jsonb
  );
  $$
);
