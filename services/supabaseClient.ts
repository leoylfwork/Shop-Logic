import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  console.warn('CK-Flow: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing. Supabase client will not be initialized.');
}

/** Singleton Supabase client. Null if env vars are missing. */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;

// debug only
// @ts-ignore
window.supabase = supabase;
