UPDATE public.feature_flags
SET enabled = true,
    updated_at = NOW()
WHERE flag_key = 'social_delta_chat_connections';