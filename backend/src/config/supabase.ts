
import { createClient } from '@supabase/supabase-js';
import { Request } from 'express';
import dotenv from 'dotenv';

dotenv.config();

export const getSupabaseClient = (req: Request) => {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
  const authHeader = req.headers.authorization;

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
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  
  if (!supabaseServiceRoleKey) {
      console.warn('SUPABASE_SERVICE_ROLE_KEY is missing!');
  }

  const client = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  return client;
};
