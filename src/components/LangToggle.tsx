'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/i18n/client';

export function LangToggle({ className = '' }: { className?: string }) {
  const { lang, t } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className={`rounded-full border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 ${className}`}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/lang', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lang: lang === 'ta' ? 'en' : 'ta' }),
        }).catch(() => {
          document.cookie = `lang=${lang === 'ta' ? 'en' : 'ta'}; path=/; max-age=31536000`;
        });
        router.refresh();
        setBusy(false);
      }}
    >
      {t('common.language')}
    </button>
  );
}
