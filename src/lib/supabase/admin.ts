import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from '../env';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: SupabaseClient<any, 'public', any> | null = null;

/** Service-role client. Bypasses RLS: use only after authorising the caller yourself. */
export function adminClient() {
  client ??= createClient(publicEnv.supabaseUrl, serverEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
