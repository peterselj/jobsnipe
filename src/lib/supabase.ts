import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// The publishable key is meant to be public: it only allows what the database's row-level
// security rules allow a signed-in person to do with their own data.
export const SUPABASE_URL = 'https://hzeciyeirloyzqkjvvln.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY: string = 'sb_publishable__s9Y0Pzf0CJXt9QbYMXHlA_LwHL7mIc';

export const supabaseConfigured = SUPABASE_PUBLISHABLE_KEY !== '';

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  return (client ??= createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' },
  }));
}
