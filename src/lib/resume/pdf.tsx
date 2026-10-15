import 'server-only';
import path from 'node:path';
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { headerLines, type ResumeSnapshot } from './snapshot';
import { LEVEL_LABEL } from '../scoring';
import { TEMPLATES, type TemplateId, type TemplateStyle } from './templates';

const fontDir = path.join(process.cwd(), 'public', 'fonts');
let registered = false;
export function registerFonts() {
  if (registered) return;
  Font.register({
    family: 'NotoSans',
    fonts: [
      { src: path.join(fontDir, 'NotoSans-Regular.ttf') },
      { src: path.join(fontDir, 'NotoSans-Bold.ttf'), fontWeight: 'bold' },
    ],
  });
  Font.register({
    family: 'NotoSansTamil',
    fonts: [
      { src: path.join(fontDir, 'NotoSansTamil-Regular.ttf') },
      { src: path.join(fontDir, 'NotoSansTamil-Bold.ttf'), fontWeight: 'bold' },
    ],
  });
  Font.registerHyphenationCallback((w) => [w]);
  registered = true;
}

/** How the content was fitted onto one A4 page. */
export type FitStatus = 'ok' | 'shrunk' | 'trimmed' | 'overflow';
export interface Fit { scale: number; trim: 0 | 1 | 2 | 3 }

function makeStyles(t: TemplateStyle, scale: number) {
  const f = (n: number) => Math.round(n * scale * 10) / 10;
  return StyleSheet.create({
    page: { fontFamily: 'NotoSans', fontSize: f(10), color: '#0f172a', lineHeight: 1.32, paddingBottom: 30 },
    body: { paddingHorizontal: 34, paddingTop: t.header === 'band' ? 14 : 30 },
    name: { fontSize: f(21), fontWeight: 'bold', lineHeight: 1.2 },
    tamil: { fontFamily: 'NotoSansTamil', fontSize: f(11.5), lineHeight: 1.6 },
    headline: { fontSize: f(12), fontWeight: 'bold', color: t.accent, marginTop: 1 },
    muted: { color: '#475569' },
    small: { fontSize: f(8.5) },
    section: { marginTop: f(10) },
    h3rule: { fontSize: f(9.5), fontWeight: 'bold', color: t.accent, letterSpacing: 1, textTransform: 'uppercase', borderBottomWidth: 1, borderBottomColor: t.accent, paddingBottom: 2, marginBottom: 4 },
    h3bar: { fontSize: f(10.5), fontWeight: 'bold', color: t.accent, borderLeftWidth: 3, borderLeftColor: t.accent, paddingLeft: 6, marginBottom: 4 },
    h3caps: { fontSize: f(9), fontWeight: 'bold', color: '#64748b', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 },
    row: { flexDirection: 'row', justifyContent: 'space-between' },
    bold: { fontWeight: 'bold' },
    bullet: { flexDirection: 'row', marginLeft: 6 },
    pill: { backgroundColor: t.accent, color: t.onAccent, fontSize: f(7.5), fontWeight: 'bold', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2, marginLeft: 5 },
    pillLight: { backgroundColor: t.tint, color: t.accent, fontSize: f(7.5), fontWeight: 'bold', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2, marginLeft: 5 },
    footer: { position: 'absolute', bottom: 14, left: 34, right: 34, fontSize: 7, color: '#94a3b8', textAlign: 'center' },
  });
}
type Styles = ReturnType<typeof makeStyles>;

/** Applies a trim level: fewer bullets / items, lower-priority sections dropped. */
export function trimSnapshot(s: ResumeSnapshot, trim: Fit['trim']): ResumeSnapshot {
  if (trim === 0) return s;
  const maxBullets = trim === 1 ? 3 : trim === 2 ? 2 : 1;
  const maxExp = trim === 1 ? 6 : trim === 2 ? 4 : 3;
  return {
    ...s,
    experience: s.experience.slice(0, maxExp).map((x) => ({ ...x, bullets: x.bullets.slice(0, maxBullets) })),
    education: s.education.slice(0, trim === 3 ? 2 : 3),
    awards: s.awards?.slice(0, trim === 1 ? 5 : 3),
    otherSkills: trim === 3 ? s.otherSkills.slice(0, 6) : s.otherSkills.slice(0, 10),
    softSkills: s.softSkills?.slice(0, trim === 3 ? 3 : 5),
    languages: trim === 3 ? [] : s.languages,
  };
}

function Heading({ title, st, t }: { title: string; st: Styles; t: TemplateStyle }) {
  const style = t.headings === 'rule' ? st.h3rule : t.headings === 'bar' ? st.h3bar : st.h3caps;
  return <Text style={style} minPresenceAhead={24}>{title}</Text>;
}

function Section({ title, st, t, children }: { title: string; st: Styles; t: TemplateStyle; children: React.ReactNode }) {
  return (
    <View style={st.section}>
      <Heading title={title} st={st} t={t} />
      {children}
    </View>
  );
}

function Entries({ items, st }: { items: ResumeSnapshot['experience']; st: Styles }) {
  return (
    <>
      {items.map((x, i) => (
        <View key={i} style={{ marginBottom: 4 }} wrap={false}>
          <View style={st.row}>
            <Text style={[st.bold, { flex: 1 }]}>{x.title}{x.organization ? ` — ${x.organization}` : ''}</Text>
            <Text style={st.muted}>{x.period}</Text>
          </View>
          {x.bullets.map((b, j) => (
            <View key={j} style={st.bullet}>
              <Text>•  </Text>
              <Text style={{ flex: 1 }}>{b}</Text>
            </View>
          ))}
        </View>
      ))}
    </>
  );
}

function VerifiedSkills({ s, st, showPct }: { s: ResumeSnapshot; st: Styles; showPct: boolean }) {
  return (
    <>
      {s.verifiedSkills.map((v) => (
        <View key={v.name} style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 2 }}>
          <Text style={st.bold}>{v.name}</Text>
          <Text>{`  ${LEVEL_LABEL[v.level]}${showPct ? ` · ${Math.round(v.scorePct)}%` : ''}`}</Text>
          {v.badge === 'campus_verified' ? <Text style={st.pill}>CAMPUS VERIFIED</Text> : <Text style={st.pillLight}>VERIFIED</Text>}
        </View>
      ))}
      <Text style={[st.small, st.muted, { marginTop: 1 }]}>Verified by a timed skill assessment on Resume Build AI.</Text>
    </>
  );
}

function Header({ s, st, t, onAccent }: { s: ResumeSnapshot; st: Styles; t: TemplateStyle; onAccent?: boolean }) {
  const { headline, nameTamil } = headerLines(s);
  const contact = [s.phone, s.email].filter(Boolean).join('  ·  ');
  const sub = [s.department, s.year ? `Year ${s.year}` : null, s.college].filter(Boolean).join('  ·  ');
  const color = onAccent ? { color: t.onAccent } : {};
  const align = t.header === 'centered' ? { textAlign: 'center' as const } : {};
  return (
    <View style={align}>
      <Text style={[st.name, color]}>{s.name}</Text>
      {nameTamil ? <Text style={[st.tamil, onAccent ? color : st.muted]}>{nameTamil}</Text> : null}
      {headline ? <Text style={[st.headline, onAccent ? color : {}]}>{headline}</Text> : null}
      {sub ? <Text style={onAccent ? color : st.muted}>{sub}</Text> : null}
      {contact ? <Text style={onAccent ? color : st.muted}>{contact}</Text> : null}
    </View>
  );
}

/** Main-column sections, in order. */
function MainSections({ s, st, t, showPct, withSkills }: { s: ResumeSnapshot; st: Styles; t: TemplateStyle; showPct: boolean; withSkills: boolean }) {
  const work = s.experience.filter((x) => x.type !== 'project');
  const projects = s.experience.filter((x) => x.type === 'project');
  return (
    <>
      {s.summary ? <Section title="Summary" st={st} t={t}><Text>{s.summary}</Text></Section> : null}
      {withSkills && s.verifiedSkills.length > 0 && (
        <Section title="Verified Skills" st={st} t={t}><VerifiedSkills s={s} st={st} showPct={showPct} /></Section>
      )}
      {work.length > 0 && <Section title="Experience" st={st} t={t}><Entries items={work} st={st} /></Section>}
      {projects.length > 0 && <Section title="Projects" st={st} t={t}><Entries items={projects} st={st} /></Section>}
      {s.education.length > 0 && (
        <Section title="Education" st={st} t={t}>
          {s.education.map((e, i) => (
            <View key={i} style={{ marginBottom: 3 }} wrap={false}>
              <View style={st.row}>
                <Text style={[st.bold, { flex: 1 }]}>{e.degree}{e.field ? `, ${e.field}` : ''}</Text>
                <Text style={st.muted}>{e.years}</Text>
              </View>
              <Text style={st.muted}>{e.institution}{e.score ? `  ·  ${e.score}` : ''}</Text>
            </View>
          ))}
        </Section>
      )}
      {withSkills && <SideSections s={s} st={st} t={t} showPct={showPct} withVerified={false} />}
    </>
  );
}

/** Skills, strengths, languages, awards: a sidebar on two-column templates, the end of the page otherwise. */
function SideSections({ s, st, t, showPct, withVerified }: { s: ResumeSnapshot; st: Styles; t: TemplateStyle; showPct: boolean; withVerified: boolean }) {
  return (
    <>
      {withVerified && s.verifiedSkills.length > 0 && (
        <Section title="Verified Skills" st={st} t={t}><VerifiedSkills s={s} st={st} showPct={showPct} /></Section>
      )}
      {s.otherSkills.length > 0 && (
        <Section title="Other Skills (self-declared)" st={st} t={t}><Text>{s.otherSkills.join('  ·  ')}</Text></Section>
      )}
      {s.softSkills && s.softSkills.length > 0 && (
        <Section title="Strengths" st={st} t={t}><Text>{s.softSkills.join('  ·  ')}</Text></Section>
      )}
      {s.languages && s.languages.length > 0 && (
        <Section title="Languages" st={st} t={t}><Text>{s.languages.map((l) => `${l.name} (${l.level})`).join('  ·  ')}</Text></Section>
      )}
      {s.awards && s.awards.length > 0 && (
        <Section title="Awards & Certificates" st={st} t={t}>
          {s.awards.map((a, i) => (
            <View key={i} style={[st.row, { marginBottom: 2 }]} wrap={false}>
              <Text style={{ flex: 1 }}><Text style={st.bold}>{a.name}</Text>{a.issuer ? ` — ${a.issuer}` : ''}</Text>
              {a.year ? <Text style={st.muted}>{` ${a.year}`}</Text> : null}
            </View>
          ))}
        </Section>
      )}
    </>
  );
}

export function ResumeDocument({ s, showPct, version, template = 'modern', fit = { scale: 1, trim: 0 }, singlePage = false }: {
  s: ResumeSnapshot; showPct: boolean; version: number; template?: TemplateId; fit?: Fit; singlePage?: boolean;
}) {
  const t = TEMPLATES[template];
  const st = makeStyles(t, fit.scale);
  const data = trimSnapshot(s, fit.trim);
  const sidebar = t.layout !== 'single';
  const footer = (
    <Text style={st.footer} fixed>{`Resume v${version} · generated ${data.generatedAt.slice(0, 10)} · Resume Build AI`}</Text>
  );

  let content: React.ReactNode;
  if (!sidebar) {
    content = (
      <>
        {t.header === 'band' ? (
          <View style={{ backgroundColor: t.accent, paddingHorizontal: 34, paddingVertical: 18 }}>
            <Header s={data} st={st} t={t} onAccent />
          </View>
        ) : null}
        <View style={st.body}>
          {t.header !== 'band' && (
            <View style={t.header === 'centered' ? { borderBottomWidth: 1.5, borderBottomColor: t.accent, paddingBottom: 6 } : { paddingBottom: 4 }}>
              <Header s={data} st={st} t={t} />
            </View>
          )}
          <MainSections s={data} st={st} t={t} showPct={showPct} withSkills />
        </View>
      </>
    );
  } else {
    const side = (
      <View style={{ width: '32%', backgroundColor: t.layout === 'sidebar-left' ? t.tint : undefined, paddingHorizontal: 14, paddingTop: 30 }}>
        {t.layout === 'sidebar-left' && <Header s={data} st={st} t={t} />}
        <SideSections s={data} st={st} t={t} showPct={showPct} withVerified />
      </View>
    );
    const main = (
      <View style={{ width: '68%', paddingHorizontal: 22, paddingTop: 30 }}>
        {t.layout === 'sidebar-right' && (
          <View style={{ borderBottomWidth: 2, borderBottomColor: t.accent, paddingBottom: 6 }}>
            <Header s={data} st={st} t={t} />
          </View>
        )}
        <MainSections s={data} st={st} t={t} showPct={showPct} withSkills={false} />
      </View>
    );
    content = <View style={{ flexDirection: 'row', minHeight: '100%' }}>{t.layout === 'sidebar-left' ? <>{side}{main}</> : <>{main}{side}</>}</View>;
  }

  return (
    <Document title={`${data.name} - Resume`} author={data.name} creator="Resume Build AI">
      <Page size="A4" style={st.page} wrap={!singlePage}>
        {content}
        {footer}
      </Page>
    </Document>
  );
}

/** Pages in a rendered PDF (react-pdf writes one /Type /Page object per page). */
export function pageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

/** Fit attempts in order: shrink text a little first, then trim lower-priority content. */
const ATTEMPTS: { fit: Fit; status: FitStatus }[] = [
  { fit: { scale: 1, trim: 0 }, status: 'ok' },
  { fit: { scale: 0.93, trim: 0 }, status: 'shrunk' },
  { fit: { scale: 0.87, trim: 0 }, status: 'shrunk' },
  { fit: { scale: 0.87, trim: 1 }, status: 'trimmed' },
  { fit: { scale: 0.87, trim: 2 }, status: 'trimmed' },
  { fit: { scale: 0.85, trim: 3 }, status: 'trimmed' },
];

/**
 * Renders a strictly one-page A4 resume. If even the smallest/trimmed layout overflows, the page is
 * rendered without page breaks (content past the bottom is cut) and 'overflow' is reported so the
 * candidate is told to shorten their content.
 */
export async function renderFittedResumePdf(s: ResumeSnapshot, showPct: boolean, version: number, template: TemplateId):
  Promise<{ pdf: Buffer; status: FitStatus; fit: Fit }> {
  registerFonts();
  for (const a of ATTEMPTS) {
    const pdf = await renderToBuffer(<ResumeDocument s={s} showPct={showPct} version={version} template={template} fit={a.fit} />);
    if (pageCount(pdf) <= 1) return { pdf, status: a.status, fit: a.fit };
  }
  const last = ATTEMPTS[ATTEMPTS.length - 1].fit;
  const pdf = await renderToBuffer(<ResumeDocument s={s} showPct={showPct} version={version} template={template} fit={last} singlePage />);
  return { pdf, status: 'overflow', fit: last };
}

/** Back-compat helper (tests, older callers): the fitted one-page PDF in the default template. */
export async function renderResumePdf(s: ResumeSnapshot, showPct: boolean, version: number, template: TemplateId = 'modern'): Promise<Buffer> {
  return (await renderFittedResumePdf(s, showPct, version, template)).pdf;
}
