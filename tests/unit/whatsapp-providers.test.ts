import { afterEach, describe, expect, it, vi } from 'vitest';
import { aisensyProvider, currentProvider, logProvider, metaProvider } from '@/lib/whatsapp/providers';

const params = ['Priya', 'SQL', 'Verified - 86%', 'https://x.app/resume', 'https://x.app/roles'];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('currentProvider', () => {
  it("defaults to 'log' and picks meta / aisensy from WHATSAPP_PROVIDER", () => {
    vi.stubEnv('WHATSAPP_PROVIDER', '');
    expect(currentProvider().name).toBe('log');
    vi.stubEnv('WHATSAPP_PROVIDER', 'Meta');
    expect(currentProvider().name).toBe('meta');
    vi.stubEnv('WHATSAPP_PROVIDER', 'aisensy');
    expect(currentProvider().name).toBe('aisensy');
    vi.stubEnv('WHATSAPP_PROVIDER', 'twilio');
    expect(currentProvider().name).toBe('log');
  });
});

describe('log provider', () => {
  it('sends nothing and never logs the full number', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    expect(await logProvider.send('919876543210', 'skill_score_update', params)).toEqual({ status: 'skipped', reason: 'log_provider' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(info.mock.calls)).not.toContain('9876543210');
    info.mockRestore();
  });
});

describe('meta provider', () => {
  it('posts a template message with the body params and a timeout', async () => {
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '1234');
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'secret-token');
    const fetchMock = vi.fn(async () => json({ messages: [{ id: 'wamid.ABC' }] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await metaProvider.send('919876543210', 'skill_score_update', params)).toEqual({ status: 'sent', providerMessageId: 'wamid.ABC' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v21.0/1234/messages');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret-token');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ messaging_product: 'whatsapp', to: '919876543210', type: 'template' });
    expect(body.template.name).toBe('skill_score_update');
    expect(body.template.language.code).toBe('en');
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(params);
  });
  it('reports HTTP errors without the token', async () => {
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '1234');
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'secret-token');
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { message: 'Template not found' } }, 400)));
    const r = await metaProvider.send('919876543210', 'skill_score_update', params);
    expect(r).toMatchObject({ status: 'failed', error: expect.stringContaining('HTTP 400') });
    expect(JSON.stringify(r)).not.toContain('secret-token');
  });
  it('reports network failures / timeouts as failed', async () => {
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '1234');
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'secret-token');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('The operation timed out.', 'TimeoutError'); }));
    expect(await metaProvider.send('919876543210', 'skill_score_update', params)).toMatchObject({ status: 'failed' });
  });
  it('skips when not configured', async () => {
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '');
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', '');
    expect(await metaProvider.send('919876543210', 'skill_score_update', params)).toEqual({ status: 'skipped', reason: 'meta_not_configured' });
  });
});

describe('aisensy provider', () => {
  it('posts to the campaign API with the mapped campaign name', async () => {
    vi.stubEnv('AISENSY_API_KEY', 'ais-key');
    vi.stubEnv('AISENSY_CAMPAIGN_SKILL_SCORE_UPDATE', 'Skill Score Campaign');
    const fetchMock = vi.fn(async () => json({ success: 'true', submitted_message_id: 'm-1' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await aisensyProvider.send('919876543210', 'skill_score_update', params)).toEqual({ status: 'sent', providerMessageId: 'm-1' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://backend.aisensy.com/campaign/t1/api/v2');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init.body))).toEqual({
      apiKey: 'ais-key', campaignName: 'Skill Score Campaign', destination: '919876543210', userName: 'Priya', templateParams: params,
    });
  });
  it('fails on HTTP errors and skips without a key', async () => {
    vi.stubEnv('AISENSY_API_KEY', 'ais-key');
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'bad campaign' }, 401)));
    expect(await aisensyProvider.send('919876543210', 'skill_score_update', params)).toMatchObject({ status: 'failed' });
    vi.stubEnv('AISENSY_API_KEY', '');
    expect(await aisensyProvider.send('919876543210', 'skill_score_update', params)).toEqual({ status: 'skipped', reason: 'aisensy_not_configured' });
  });
});
