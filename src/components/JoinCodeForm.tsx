'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/i18n/client';

export function JoinCodeForm() {
  const { t } = useT();
  const router = useRouter();
  const [code, setCode] = useState('');
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const c = code.trim().toUpperCase();
        if (c) router.push(`/join/${encodeURIComponent(c)}`);
      }}
    >
      <input
        className="input uppercase"
        placeholder={t('landing.batchCode')}
        aria-label={t('landing.batchCode')}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoCapitalize="characters"
      />
      <button className="btn-primary shrink-0" type="submit">{t('landing.go')}</button>
    </form>
  );
}
