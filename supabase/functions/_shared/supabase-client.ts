
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

export const getSupabaseClient = (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const authHeader = req.headers.get('Authorization')!;
  
  // Create a Supabase client with the Auth context of the user that called the function.
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  
  return client;
};

export const getServiceSupabaseClient = () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  
  const client = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  return client;
};
