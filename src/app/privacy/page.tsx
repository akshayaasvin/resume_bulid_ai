import { AppHeader } from '@/components/AppHeader';
import { getT } from '@/i18n/server';

export const metadata = { title: 'Privacy Policy and Terms · Resume Build AI' };

// TODO(legal): all text on this page (privacy.* in en.json / ta.json) is a plain-language draft.
// Have it reviewed before relying on it, and set NEXT_PUBLIC_CONTACT_EMAIL.
const SECTIONS = ['collected', 'use', 'whatsapp', 'sharing', 'rights'] as const;

/** Public page linked from the signup agreement checkbox. */
export default function PrivacyPage() {
  const { t } = getT();
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-2xl space-y-5 px-4 pb-16 pt-5 text-slate-800">
        <h1 className="text-2xl font-bold">{t('privacy.title')}</h1>
        <p className="text-sm text-slate-600">{t('privacy.intro')}</p>
        {SECTIONS.map((k) => (
          <section key={k}>
            <h2 className="mb-1 text-lg font-semibold">{t(`privacy.${k}.title`)}</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed">{t(`privacy.${k}.body`)}</p>
          </section>
        ))}
        <section>
          <h2 className="mb-1 text-lg font-semibold">{t('privacy.contact.title')}</h2>
          <p className="text-sm leading-relaxed">
            {t('privacy.contact.body')}{' '}
            {email && <a className="break-all text-brand-700 underline" href={`mailto:${email}`}>{email}</a>}
          </p>
        </section>
      </main>
    </>
  );
}
