import Link from 'next/link';
import { clusterOf } from '@/lib/tests/clusters';

type T = (k: string, v?: Record<string, string | number>) => string;

/** Skills on the resume that aren't verified, marked Self-declared, with "Verify later" when a test exists. */
export function SelfDeclaredSkills({ skills, t }: { skills: string[]; t: T }) {
  if (!skills.length) return null;
  const canVerify = skills.some((s) => clusterOf(s) !== null);
  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-700">{t('resume.selfDeclared')}</h2>
        {canVerify && <Link href="/test" className="btn-secondary shrink-0 text-sm">{t('resume.verifyLater')}</Link>}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {skills.map((s) => (
          <li key={s} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700">
            {s} <span className="text-slate-400">· {t('resume.selfDeclaredBadge')}</span>
          </li>
        ))}
      </ul>
      {canVerify && <p className="text-xs text-slate-500">{t('resume.selfDeclaredHint')}</p>}
    </div>
  );
}
