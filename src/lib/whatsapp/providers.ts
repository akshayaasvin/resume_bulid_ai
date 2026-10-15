import 'server-only';
import { maskPhone } from './message';

/** Result of one send attempt. `skipped`: nothing was sent on purpose (log provider / not configured). */
export type SendResult =
  | { status: 'sent'; providerMessageId: string | null }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

export interface WhatsAppProvider {
  name: 'meta' | 'aisensy' | 'log';
  /** `to` is digits with country code ("919876543210"); params fill the template body {{1}}..{{n}}. */
  send(to: string, template: string, params: string[]): Promise<SendResult>;
}

/**
 * Per-request timeout. The submit route allows 30 s: two attempts (10 s each) + the retry delay
 * must fit, so a hung provider can't use up the whole budget.
 */
const SEND_TIMEOUT_MS = 10_000;

/** Errors as short text, never including keys or full phone numbers. */
async function httpError(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  return `HTTP ${res.status} ${body.replace(/\s+/g, ' ').slice(0, 300)}`;
}

/** Meta WhatsApp Cloud API: template messages (business-initiated). */
export const metaProvider: WhatsAppProvider = {
  name: 'meta',
  async send(to, template, params) {
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!phoneId || !token) return { status: 'skipped', reason: 'meta_not_configured' };
    const version = process.env.WHATSAPP_META_API_VERSION || 'v21.0';
    try {
      const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: template,
            language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' },
            components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
          },
        }),
      });
      if (!res.ok) return { status: 'failed', error: await httpError(res) };
      const data = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[] };
      return { status: 'sent', providerMessageId: data.messages?.[0]?.id ?? null };
    } catch (e) {
      return { status: 'failed', error: `network ${(e as Error).message ?? ''}`.slice(0, 300) };
    }
  },
};

/** AiSensy campaign API: the approved template is attached to a campaign in the AiSensy dashboard. */
export const aisensyProvider: WhatsAppProvider = {
  name: 'aisensy',
  async send(to, template, params) {
    const apiKey = process.env.AISENSY_API_KEY;
    if (!apiKey) return { status: 'skipped', reason: 'aisensy_not_configured' };
    const campaignName = process.env[`AISENSY_CAMPAIGN_${template.toUpperCase()}`] || template;
    try {
      const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        body: JSON.stringify({ apiKey, campaignName, destination: to, userName: params[0] ?? 'Candidate', templateParams: params }),
      });
      if (!res.ok) return { status: 'failed', error: await httpError(res) };
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const id = data.submitted_message_id ?? data.messageId ?? data.id ?? null;
      return { status: 'sent', providerMessageId: id == null ? null : String(id) };
    } catch (e) {
      return { status: 'failed', error: `network ${(e as Error).message ?? ''}`.slice(0, 300) };
    }
  },
};

/** Default: logs what would be sent (masked) and sends nothing. */
export const logProvider: WhatsAppProvider = {
  name: 'log',
  async send(to, template, params) {
    console.info('[whatsapp:log]', { to: maskPhone(to), template, params: params.length });
    return { status: 'skipped', reason: 'log_provider' };
  },
};

/** Provider chosen by WHATSAPP_PROVIDER ('meta' | 'aisensy' | 'log'; anything else = 'log'). */
export function currentProvider(): WhatsAppProvider {
  const p = (process.env.WHATSAPP_PROVIDER || 'log').toLowerCase();
  return p === 'meta' ? metaProvider : p === 'aisensy' ? aisensyProvider : logProvider;
}
