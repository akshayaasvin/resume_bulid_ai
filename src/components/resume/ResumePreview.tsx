'use client';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n/client';

export type FitStatus = 'ok' | 'shrunk' | 'trimmed' | 'overflow';

/**
 * Shows the exact PDF the candidate will download: fetches it and draws page 1 with pdf.js
 * (legacy build, for older Android browsers). Reports how the content was fitted onto one page.
 */
export function ResumePreview({ url, onFit }: { url: string; onFit?: (status: FitStatus) => void }) {
  const { t } = useT();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const onFitRef = useRef(onFit);
  onFitRef.current = onFit;

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    setState('loading');
    (async () => {
      try {
        const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        onFitRef.current?.((res.headers.get('x-resume-fit') as FitStatus) || 'ok');
        const data = new Uint8Array(await res.arrayBuffer());
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        // Served from public/ (copied by scripts/copy-pdf-worker.mjs); versioned so caches never mix builds.
        pdfjs.GlobalWorkerOptions.workerSrc = `/pdfjs/pdf.worker.min.${pdfjs.version}.mjs`;
        const task = pdfjs.getDocument({ data });
        const doc = await task.promise;
        const page = await doc.getPage(1);
        if (cancelled || !canvas.current || !box.current) return;
        const width = box.current.clientWidth || 360;
        const base = page.getViewport({ scale: 1 });
        const ratio = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: (width / base.width) * ratio });
        const c = canvas.current;
        c.width = Math.floor(viewport.width);
        c.height = Math.floor(viewport.height);
        c.style.width = `${width}px`;
        c.style.height = `${Math.floor(viewport.height / ratio)}px`;
        await page.render({ canvas: c, viewport }).promise;
        await task.destroy();
        if (!cancelled) setState('ready');
      } catch (e) {
        if (!cancelled && (e as Error).name !== 'AbortError') setState('error');
      }
    })();
    return () => { cancelled = true; ctrl.abort(); };
  }, [url]);

  return (
    <div ref={box} className="relative w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {state !== 'ready' && (
        <div className="flex aspect-[210/297] w-full items-center justify-center text-sm text-slate-500" role="status">
          {state === 'loading' ? t('resume.previewLoading') : t('resume.previewError')}
        </div>
      )}
      <canvas ref={canvas} className={state === 'ready' ? 'block' : 'hidden'} aria-label={t('resume.previewLabel')} role="img" />
    </div>
  );
}
