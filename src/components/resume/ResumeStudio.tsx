'use client';
import { useState } from 'react';
import { useT } from '@/i18n/client';
import { TEMPLATES, TEMPLATE_IDS, type TemplateId } from '@/lib/resume/templates';
import { ResumePreview, type FitStatus } from './ResumePreview';

/**
 * Template switcher + live preview of the exact PDF + download. Picking a template saves it on the
 * version; the recommended template for the target role is marked.
 */
export function ResumeStudio({ version, initial, recommended, showPct }: {
  version: number; initial: TemplateId; recommended: TemplateId; showPct: boolean;
}) {
  const { t } = useT();
  const [template, setTemplate] = useState<TemplateId>(initial);
  const [fit, setFit] = useState<FitStatus>('ok');
  const [saveError, setSaveError] = useState(false);

  async function choose(id: TemplateId) {
    setTemplate(id);
    setSaveError(false);
    const res = await fetch(`/api/resume/${version}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ template_id: id }),
    }).catch(() => null);
    if (!res?.ok) setSaveError(true);
  }

  // showPct is part of the URL so toggling it re-renders the preview.
  const pdfUrl = `/api/resume/${version}/pdf?template=${template}&pct=${showPct ? 1 : 0}`;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{t('resume.template')}</h2>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="radiogroup" aria-label={t('resume.template')}>
          {TEMPLATE_IDS.map((id) => (
            <button key={id} type="button" role="radio" aria-checked={template === id} onClick={() => choose(id)}
              className={`flex shrink-0 flex-col items-start gap-1 rounded-xl border px-3 py-2 text-left text-sm ${template === id ? 'border-brand-600 ring-2 ring-brand-600' : 'border-slate-300 bg-white'}`}>
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 rounded" style={{ backgroundColor: TEMPLATES[id].accent }} aria-hidden />
                <span className="font-medium">{t(`resume.template.${id}`)}</span>
              </span>
              {id === recommended && (
                <span className="rounded-full bg-green-100 px-2 text-[11px] font-semibold text-green-800">{t('resume.recommended')}</span>
              )}
            </button>
          ))}
        </div>
        {saveError && <p className="mt-1 text-xs text-red-600">{t('save.error')}</p>}
      </div>

      {fit === 'trimmed' && (
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{t('resume.fitTrimmed')}</p>
      )}
      {fit === 'overflow' && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{t('resume.fitOverflow')}</p>
      )}

      <ResumePreview url={`${pdfUrl}&inline=1`} onFit={setFit} />

      <a href={pdfUrl} className="btn-primary w-full" download>⬇ {t('resume.download')}</a>
    </div>
  );
}
