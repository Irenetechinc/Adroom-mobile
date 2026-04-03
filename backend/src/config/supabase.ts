
import { createClient } from '@supabase/supabase-js';
import { Request } from 'express';
import dotenv from 'dotenv';

dotenv.config();

export const getSupabaseClient = (req: Request) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
  const authHeader = req.headers.authorization;

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is missing');
  }

  if (!supabaseAnonKey) {
    throw new Error('SUPABASE_ANON_KEY is missing');
  }

  if (!authHeader) {
      throw new Error('Missing Authorization header');
  }

  // Create a Supabase client with the Auth context of the user that called the function.
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  
  return client;
};

export const getServiceSupabaseClient = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is missing');
  }

  if (!supabaseServiceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing');
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey);
};
