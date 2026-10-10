/** Central env access. Server-only values throw a clear error when missing. */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? '',
  pyodideBaseUrl: process.env.NEXT_PUBLIC_PYODIDE_BASE_URL || 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/',
  sqljsBaseUrl: process.env.NEXT_PUBLIC_SQLJS_BASE_URL || 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/',
};

export function serverEnv(name: 'SUPABASE_SERVICE_ROLE_KEY' | 'APP_SECRET' | 'ANTHROPIC_API_KEY' | 'ANTHROPIC_MODEL'): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}
