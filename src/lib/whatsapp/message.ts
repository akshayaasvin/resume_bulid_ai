/** Pure helpers for WhatsApp messages (no secrets, no I/O). */

export const SKILL_SCORE_TEMPLATE = 'skill_score_update';

/** "+919876543210" -> "******3210" for logs (never log full numbers). */
export function maskPhone(phone: string | null | undefined): string {
  const d = (phone ?? '').replace(/\D/g, '');
  return d.length <= 4 ? '****' : `${'*'.repeat(d.length - 4)}${d.slice(-4)}`;
}

/** Digits with country code, no "+" (what both Meta and AiSensy expect): "+91 98765 43210" -> "919876543210". */
export function toWaNumber(phone: string): string | null {
  const d = phone.replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(d)) return `91${d}`;
  return /^\d{11,15}$/.test(d) ? d : null;
}

/** Base URL of the app without a trailing slash. */
export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://resumeaibuild.vercel.app').replace(/\/+$/, '');
}

/**
 * Body parameters for the "skill_score_update" template, in order {{1}}..{{5}}:
 * name, skill, result, resume link, next-step link. A score below the verified threshold is never
 * put in the message (same privacy rule as the resume): it says "keep practising" instead.
 */
export function skillScoreParams(input: {
  name: string; skill: string; scorePct: number; threshold: number; resumeUrl: string; ctaUrl: string;
}): string[] {
  const firstName = input.name.trim().split(/\s+/)[0] || 'there';
  const result = input.scorePct >= input.threshold
    ? `Verified - ${Math.round(input.scorePct)}%`
    : 'Keep practising - you can retake this test any time';
  return [firstName, input.skill, result, input.resumeUrl, input.ctaUrl];
}
