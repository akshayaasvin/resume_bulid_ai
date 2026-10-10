'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LangToggle } from './LangToggle';
import { useT } from '@/i18n/client';

export function AppHeader({ signedIn = false, home = '/' }: { signedIn?: boolean; home?: string }) {
  const { t } = useT();
  const router = useRouter();
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3">
        <Link href={home} className="text-lg font-bold text-brand-700">
          {t('app.name')}
        </Link>
        <div className="flex items-center gap-2">
          <LangToggle />
          {signedIn && (
            <button
              type="button"
              className="text-sm font-medium text-slate-600"
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' });
                router.push('/');
                router.refresh();
              }}
            >
              {t('common.logout')}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
