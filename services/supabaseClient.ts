import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn('CK-Flow: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing. Supabase client will not be initialized.');
}

/** Singleton Supabase client. Null if env vars are missing. */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;

// debug only
if (typeof window !== 'undefined') {
  // @ts-ignore
  window.supabase = supabase;
}
