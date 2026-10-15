import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, sendWhatsApp } = vi.hoisted(() => {
  const state = {
    profile: null as Record<string, unknown> | null,
    attempt: null as Record<string, unknown> | null,
  };
  const client = {
    state,
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = async () => ({
        data: table === 'profiles' ? state.profile : table === 'attempts' ? state.attempt : null, // config -> defaults
      });
      return b;
    },
  };
  return { db: client, sendWhatsApp: vi.fn(async () => 'sent') };
});

vi.mock('@/lib/supabase/admin', () => ({ adminClient: () => db }));
vi.mock('@/lib/whatsapp/index', () => ({ sendWhatsApp }));
vi.mock('@vercel/functions', () => ({ waitUntil: () => undefined }));

import { notifySkillScore } from '@/lib/whatsapp/notify';

const optedIn = { full_name: 'Priya S', phone_whatsapp: '+919876543210', whatsapp_opt_in: true };
const scored = { profile_id: 'p-1', status: 'submitted', score_pct: 86, skills: { name: 'SQL' } };

beforeEach(() => {
  db.state.profile = { ...optedIn };
  db.state.attempt = { ...scored };
  sendWhatsApp.mockClear();
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example/';
  delete process.env.WHATSAPP_CTA_URL;
});

describe('notifySkillScore', () => {
  it('sends skill_score_update to an opted-in candidate, deduped by attempt', async () => {
    expect(await notifySkillScore('p-1', 'a-1')).toBe('sent');
    expect(sendWhatsApp).toHaveBeenCalledWith(
      '+919876543210', 'skill_score_update',
      ['Priya', 'SQL', 'Verified - 86%', 'https://app.example/resume', 'https://app.example/roles'],
      { profileId: 'p-1', attemptId: 'a-1' },
    );
  });

  it('uses the resume visibility threshold: a below-50 score is never sent', async () => {
    db.state.attempt = { ...scored, score_pct: 42 };
    await notifySkillScore('p-1', 'a-1');
    const sentParams = (sendWhatsApp.mock.calls[0] as unknown[])[2] as string[];
    expect(sentParams[2]).toMatch(/keep practising/i);
    expect(sentParams.join(' ')).not.toContain('42');
  });

  it.each([
    ['not opted in', () => { db.state.profile = { ...optedIn, whatsapp_opt_in: false }; }, 'not_opted_in'],
    ['no phone number', () => { db.state.profile = { ...optedIn, phone_whatsapp: null }; }, 'no_phone'],
    ['attempt belongs to another profile', () => { db.state.attempt = { ...scored, profile_id: 'someone-else' }; }, 'not_scored'],
    ['attempt not submitted', () => { db.state.attempt = { ...scored, status: 'in_progress' }; }, 'not_scored'],
    ['attempt not scored', () => { db.state.attempt = { ...scored, score_pct: null }; }, 'not_scored'],
    ['attempt missing', () => { db.state.attempt = null; }, 'not_scored'],
  ])('does not send when %s', async (_label, setup, expected) => {
    setup();
    expect(await notifySkillScore('p-1', 'a-1')).toBe(expected);
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    sendWhatsApp.mockRejectedValueOnce(new Error('db down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await notifySkillScore('p-1', 'a-1')).toBe('error');
    err.mockRestore();
  });
});
