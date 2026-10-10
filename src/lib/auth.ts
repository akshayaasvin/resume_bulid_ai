import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

export type Role = 'candidate' | 'proctor' | 'college_admin' | 'employer' | 'super_admin';

export interface Profile {
  id: string;
  role: Role;
  full_name: string;
  name_tamil: string | null;
  phone_whatsapp: string | null;
  email: string | null;
  college_id: string | null;
  workshop_id: string | null;
  department: string | null;
  year: number | null;
  whatsapp_opt_in: boolean;
  language: 'en' | 'ta';
  show_score_pct: boolean;
  wizard_step: number;
  summary: string | null;
  company_name: string | null;
  employer_approved: boolean;
  recruiter_visible: boolean;
}

/** Current user + profile (via RLS), or null. */
export async function getSession() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single<Profile>();
  if (!profile) return null;
  return { user, profile, supabase };
}

export async function requireSession(roles?: Role[]) {
  const s = await getSession();
  if (!s) redirect('/login');
  if (roles && !roles.includes(s.profile.role)) redirect('/');
  return s;
}

/** For route handlers: returns a 401/403 Response instead of redirecting. */
export async function apiSession(roles?: Role[]) {
  const s = await getSession();
  if (!s) return { error: Response.json({ error: 'unauthenticated' }, { status: 401 }) } as const;
  if (roles && !roles.includes(s.profile.role)) {
    return { error: Response.json({ error: 'forbidden' }, { status: 403 }) } as const;
  }
  return { session: s } as const;
}
