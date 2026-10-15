import 'server-only';
import { adminClient } from '../supabase/admin';
import { maskPhone, toWaNumber } from './message';
import { currentProvider, type SendResult } from './providers';

export interface SendContext {
  profileId: string;
  /** Dedupe key: one message per (attempt, template). */
  attemptId?: string | null;
}

// `||` so an empty value copied from .env.example means "default", while an explicit "0" still works.
const RETRY_DELAY_MS = Number(process.env.WHATSAPP_RETRY_DELAY_MS || 2000);

/**
 * Sends a template message through the configured provider and logs every attempt in
 * whatsapp_messages. A failed send is retried once. Never throws (callers run it in the background).
 * Returns the final status, or 'duplicate' when this attempt already had this message.
 */
export async function sendWhatsApp(
  phone: string, templateName: string, params: string[], ctx: SendContext,
): Promise<SendResult['status'] | 'duplicate'> {
  const db = adminClient();
  const provider = currentProvider();
  const to = toWaNumber(phone);

  // Claim the (attempt, template) slot first; a unique index makes a second send for the same attempt a no-op.
  const { data: row, error: insertErr } = await db.from('whatsapp_messages').insert({
    profile_id: ctx.profileId, attempt_id: ctx.attemptId ?? null, template: templateName, params,
    provider: provider.name, status: 'pending', attempts: 0,
  }).select('id').single();
  if (insertErr) {
    if (insertErr.code === '23505') return 'duplicate';
    console.error('whatsapp log insert failed', { code: insertErr.code, to: maskPhone(phone) });
    return 'failed';
  }
  const update = (patch: Record<string, unknown>) =>
    db.from('whatsapp_messages').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', row.id);

  if (!to) {
    await update({ status: 'failed', error: 'invalid_phone', attempts: 0 });
    return 'failed';
  }

  let result: SendResult = { status: 'failed', error: 'not_attempted' };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      result = await provider.send(to, templateName, params);
    } catch (e) {
      result = { status: 'failed', error: `exception ${(e as Error).message ?? ''}`.slice(0, 300) };
    }
    if (result.status === 'sent') {
      await update({ status: 'sent', provider_message_id: result.providerMessageId, attempts: attempt, error: null });
      return 'sent';
    }
    if (result.status === 'skipped') {
      await update({ status: 'skipped', error: result.reason, attempts: attempt });
      return 'skipped';
    }
    await update({ status: attempt < 2 ? 'pending' : 'failed', error: result.error, attempts: attempt });
    if (attempt < 2) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }
  console.warn('whatsapp send failed', { provider: provider.name, template: templateName, to: maskPhone(phone) });
  return 'failed';
}
