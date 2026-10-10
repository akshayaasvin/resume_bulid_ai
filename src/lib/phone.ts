/** Indian mobile numbers: optional +91/91/0 prefix, then 10 digits starting 6-9. */
export function normalizeIndianPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, '');
  const m = digits.match(/^(?:\+?91|0)?([6-9]\d{9})$/);
  return m ? `+91${m[1]}` : null;
}

/**
 * Auth identity: every account signs in with phone + password. Supabase Auth needs an
 * email-shaped identifier, so we derive a stable, non-routable one from the phone.
 * The candidate's real contact email (optional) lives in profiles.email.
 */
export function authEmailForPhone(e164: string): string {
  return `p${e164.replace(/\D/g, '')}@users.resumebuild.invalid`;
}
