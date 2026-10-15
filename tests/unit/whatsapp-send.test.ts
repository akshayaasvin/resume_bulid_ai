import { beforeEach, describe, expect, it, vi } from 'vitest';

// No real waiting between the two attempts (read when index.ts is loaded).
vi.hoisted(() => { process.env.WHATSAPP_RETRY_DELAY_MS = '0'; });

const { db, send } = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = { rows: [] as Row[] };
  const client = {
    state,
    from: () => ({
      insert: (row: Row) => ({
        select: () => ({
          single: async () => {
            const dup = row.attempt_id && state.rows.some((r) => r.attempt_id === row.attempt_id && r.template === row.template);
            if (dup) return { data: null, error: { code: '23505' } };
            const saved = { ...row, id: `msg-${state.rows.length + 1}` };
            state.rows.push(saved);
            return { data: { id: saved.id }, error: null };
          },
        }),
      }),
      update: (patch: Row) => ({
        eq: async (_col: string, id: string) => {
          Object.assign(state.rows.find((r) => r.id === id)!, patch);
          return { error: null };
        },
      }),
    }),
  };
  return { db: client, send: vi.fn() };
});

vi.mock('@/lib/supabase/admin', () => ({ adminClient: () => db }));
vi.mock('@/lib/whatsapp/providers', () => ({ currentProvider: () => ({ name: 'meta', send }) }));

import { sendWhatsApp } from '@/lib/whatsapp/index';

const params = ['Priya', 'SQL', 'Verified - 86%', 'https://x.app/resume', 'https://x.app/roles'];
const ctx = { profileId: 'p-1', attemptId: 'a-1' };
const row = () => db.state.rows[0];

beforeEach(() => {
  db.state.rows = [];
  send.mockReset();
});

describe('sendWhatsApp', () => {
  it('sends on the first try and logs the message', async () => {
    send.mockResolvedValueOnce({ status: 'sent', providerMessageId: 'wamid.1' });
    expect(await sendWhatsApp('+919876543210', 'skill_score_update', params, ctx)).toBe('sent');
    expect(send).toHaveBeenCalledWith('919876543210', 'skill_score_update', params);
    expect(row()).toMatchObject({
      profile_id: 'p-1', attempt_id: 'a-1', template: 'skill_score_update', params, provider: 'meta',
      status: 'sent', provider_message_id: 'wamid.1', attempts: 1, error: null,
    });
  });

  it('retries a failed send once (attempts = 2)', async () => {
    send.mockResolvedValueOnce({ status: 'failed', error: 'HTTP 500' }).mockResolvedValueOnce({ status: 'sent', providerMessageId: 'wamid.2' });
    expect(await sendWhatsApp('9876543210', 'skill_score_update', params, ctx)).toBe('sent');
    expect(send).toHaveBeenCalledTimes(2);
    expect(row()).toMatchObject({ status: 'sent', attempts: 2, provider_message_id: 'wamid.2', error: null });
  });

  it("gives up after two failures and records 'failed' with the error", async () => {
    send.mockResolvedValue({ status: 'failed', error: 'HTTP 400 template not found' });
    expect(await sendWhatsApp('9876543210', 'skill_score_update', params, ctx)).toBe('failed');
    expect(send).toHaveBeenCalledTimes(2);
    expect(row()).toMatchObject({ status: 'failed', attempts: 2, error: 'HTTP 400 template not found' });
  });

  it('treats a thrown provider error as a failed attempt (never throws)', async () => {
    send.mockRejectedValue(new Error('boom'));
    expect(await sendWhatsApp('9876543210', 'skill_score_update', params, ctx)).toBe('failed');
    expect(row()).toMatchObject({ status: 'failed', attempts: 2 });
  });

  it("records 'skipped' (log provider / not configured) without retrying", async () => {
    send.mockResolvedValue({ status: 'skipped', reason: 'log_provider' });
    expect(await sendWhatsApp('9876543210', 'skill_score_update', params, ctx)).toBe('skipped');
    expect(send).toHaveBeenCalledTimes(1);
    expect(row()).toMatchObject({ status: 'skipped', error: 'log_provider', attempts: 1 });
  });

  it('does not call the provider for an invalid phone number', async () => {
    expect(await sendWhatsApp('12345', 'skill_score_update', params, ctx)).toBe('failed');
    expect(send).not.toHaveBeenCalled();
    expect(row()).toMatchObject({ status: 'failed', error: 'invalid_phone' });
  });

  it('sends only once per test attempt (unique index -> 23505)', async () => {
    send.mockResolvedValue({ status: 'sent', providerMessageId: 'wamid.3' });
    expect(await sendWhatsApp('9876543210', 'skill_score_update', params, ctx)).toBe('sent');
    expect(await sendWhatsApp('9876543210', 'skill_score_update', params, ctx)).toBe('duplicate');
    expect(send).toHaveBeenCalledTimes(1);
    expect(db.state.rows).toHaveLength(1);
  });
});
