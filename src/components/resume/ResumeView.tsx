import { headerLines, type ResumeSnapshot } from '@/lib/resume/snapshot';
import { LEVEL_LABEL } from '@/lib/scoring';

/** HTML preview. Mirrors the PDF layout (src/lib/resume/pdf.tsx). Labels are English on the resume itself. */
export function ResumeView({ s, showPct }: { s: ResumeSnapshot; showPct: boolean }) {
  const contact = [s.phone, s.email].filter(Boolean).join(' · ');
  const sub = [s.department, s.year ? `Year ${s.year}` : null, s.college].filter(Boolean).join(' · ');
  const work = s.experience.filter((x) => x.type !== 'project');
  const projects = s.experience.filter((x) => x.type === 'project');
  const { headline, nameTamil } = headerLines(s);
  return (
    <article className="mx-auto max-w-[800px] bg-white p-6 text-[13px] leading-snug text-slate-900 shadow-sm sm:p-10">
      <header className="border-b-2 border-brand-700 pb-3">
        <h2 className="text-2xl font-bold">{s.name}</h2>
        {nameTamil && <p className="text-base text-slate-700" lang="ta">{nameTamil}</p>}
        {headline && <p className="mt-0.5 text-base font-semibold text-brand-700">{headline}</p>}
        {sub && <p className="mt-1 text-slate-700">{sub}</p>}
        {contact && <p className="text-slate-600">{contact}</p>}
      </header>

      {s.summary && (
        <Section title="Summary"><p>{s.summary}</p></Section>
      )}

      {s.verifiedSkills.length > 0 && (
        <Section title="Verified Skills">
          <ul className="space-y-1">
            {s.verifiedSkills.map((v) => (
              <li key={v.name} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{v.name}</span>
                <span>— {LEVEL_LABEL[v.level]}{showPct ? ` (${Math.round(v.scorePct)}%)` : ''}</span>
                {v.badge === 'campus_verified' && (
                  <span className="rounded bg-brand-700 px-1.5 py-0.5 text-[11px] font-semibold text-white">✓ Campus Verified</span>
                )}
                {v.badge === 'verified' && (
                  <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[11px] font-semibold text-brand-800">✓ Verified</span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-slate-500">Verified by a timed skill assessment on Resume Build AI.</p>
        </Section>
      )}

      {s.education.length > 0 && (
        <Section title="Education">
          {s.education.map((e, i) => (
            <div key={i} className="mb-1.5">
              <div className="flex justify-between gap-2">
                <span className="font-semibold">{e.degree}{e.field ? `, ${e.field}` : ''}</span>
                <span className="shrink-0 text-slate-600">{e.years}</span>
              </div>
              <div className="text-slate-700">{e.institution}{e.score ? ` · ${e.score}` : ''}</div>
            </div>
          ))}
        </Section>
      )}

      {work.length > 0 && <Section title="Experience"><Entries items={work} /></Section>}
      {projects.length > 0 && <Section title="Projects"><Entries items={projects} /></Section>}

      {s.otherSkills.length > 0 && (
        <Section title="Other Skills (self-declared)"><p>{s.otherSkills.join(' · ')}</p></Section>
      )}
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-wider text-brand-700">{title}</h3>
      {children}
    </section>
  );
}

function Entries({ items }: { items: ResumeSnapshot['experience'] }) {
  return (
    <>
      {items.map((x, i) => (
        <div key={i} className="mb-2">
          <div className="flex justify-between gap-2">
            <span className="font-semibold">{x.title}{x.organization ? ` — ${x.organization}` : ''}</span>
            <span className="shrink-0 text-slate-600">{x.period}</span>
          </div>
          {x.bullets.length > 0 && (
            <ul className="ml-4 list-disc">
              {x.bullets.map((b, j) => <li key={j}>{b}</li>)}
            </ul>
          )}
        </div>
      ))}
    </>
  );
}
