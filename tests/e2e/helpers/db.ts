import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { E2ERole } from './login';
import { getCredentialsForRole } from './login';

const url = process.env.E2E_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anonKey = process.env.E2E_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

export type RepairOrderRow = {
  id: string;
  shop_id: string;
  work_type: string;
  status: string;
  vin: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  bay_id: string | null;
  [key: string]: unknown;
};

let cachedClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!url || !anonKey) throw new Error('E2E_SUPABASE_URL and E2E_SUPABASE_ANON_KEY (or VITE_*) must be set');
  if (!cachedClient) cachedClient = createClient(url, anonKey);
  return cachedClient;
}

/**
 * Sign in as the given role and return repair_orders rows. Uses real Supabase (no mocks).
 */
export async function getOrdersFromDB(role: E2ERole): Promise<RepairOrderRow[]> {
  const supabase = getSupabase();
  const { email, password } = getCredentialsForRole(role);
  const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError) throw new Error(`E2E login failed (${role}): ${authError.message}`);
  const { data, error } = await supabase
    .from('repair_orders')
    .select('*')
    .order('order_index', { ascending: true });
  if (error) throw new Error(`getOrdersFromDB: ${error.message}`);
  return (data ?? []) as RepairOrderRow[];
}
