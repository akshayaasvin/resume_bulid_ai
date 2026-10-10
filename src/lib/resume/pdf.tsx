import 'server-only';
import path from 'node:path';
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import type { ResumeSnapshot } from './snapshot';
import { LEVEL_LABEL } from '../scoring';

const fontDir = path.join(process.cwd(), 'public', 'fonts');
let registered = false;
function registerFonts() {
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

const BRAND = '#1e40af';
const styles = StyleSheet.create({
  page: { padding: 36, fontFamily: 'NotoSans', fontSize: 10, color: '#0f172a', lineHeight: 1.35 },
  header: { borderBottomWidth: 2, borderBottomColor: BRAND, paddingBottom: 8 },
  name: { fontSize: 20, fontWeight: 'bold', lineHeight: 1.25 },
  tamil: { fontFamily: 'NotoSansTamil', fontSize: 12, color: '#334155', lineHeight: 1.6, marginTop: 2 },
  muted: { color: '#475569' },
  section: { marginTop: 12 },
  h3: { fontSize: 9, fontWeight: 'bold', color: BRAND, letterSpacing: 1, marginBottom: 4, textTransform: 'uppercase' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  bold: { fontWeight: 'bold' },
  badge: { backgroundColor: BRAND, color: '#fff', fontSize: 8, fontWeight: 'bold', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2, marginLeft: 6 },
  badgeLight: { backgroundColor: '#d9eaff', color: BRAND, fontSize: 8, fontWeight: 'bold', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2, marginLeft: 6 },
  bullet: { flexDirection: 'row', marginLeft: 8 },
  footer: { position: 'absolute', bottom: 20, left: 36, right: 36, fontSize: 7, color: '#94a3b8', textAlign: 'center' },
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.h3} minPresenceAhead={24}>{title}</Text>
      {children}
    </View>
  );
}

function Entries({ items }: { items: ResumeSnapshot['experience'] }) {
  return (
    <>
      {items.map((x, i) => (
        <View key={i} style={{ marginBottom: 5 }} wrap={false}>
          <View style={styles.row}>
            <Text style={styles.bold}>{x.title}{x.organization ? ` — ${x.organization}` : ''}</Text>
            <Text style={styles.muted}>{x.period}</Text>
          </View>
          {x.bullets.map((b, j) => (
            <View key={j} style={styles.bullet}>
              <Text>•  </Text>
              <Text style={{ flex: 1 }}>{b}</Text>
            </View>
          ))}
        </View>
      ))}
    </>
  );
}

export function ResumeDocument({ s, showPct, version }: { s: ResumeSnapshot; showPct: boolean; version: number }) {
  const contact = [s.phone, s.email].filter(Boolean).join('  ·  ');
  const sub = [s.department, s.year ? `Year ${s.year}` : null, s.college].filter(Boolean).join('  ·  ');
  const work = s.experience.filter((x) => x.type !== 'project');
  const projects = s.experience.filter((x) => x.type === 'project');
  return (
    <Document title={`${s.name} - Resume`} author={s.name} creator="Resume Build AI">
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.name}>{s.name}</Text>
          {s.nameTamil ? <Text style={styles.tamil}>{s.nameTamil}</Text> : null}
          {sub ? <Text style={styles.muted}>{sub}</Text> : null}
          {contact ? <Text style={styles.muted}>{contact}</Text> : null}
        </View>

        {s.summary ? <Section title="Summary"><Text>{s.summary}</Text></Section> : null}

        {s.verifiedSkills.length > 0 && (
          <Section title="Verified Skills">
            {s.verifiedSkills.map((v) => (
              <View key={v.name} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                <Text style={styles.bold}>{v.name}</Text>
                <Text>{`  —  ${LEVEL_LABEL[v.level]}${showPct ? ` (${Math.round(v.scorePct)}%)` : ''}`}</Text>
                {v.badge === 'campus_verified' && <Text style={styles.badge}>CAMPUS VERIFIED</Text>}
                {v.badge === 'verified' && <Text style={styles.badgeLight}>VERIFIED</Text>}
              </View>
            ))}
            <Text style={{ fontSize: 7, color: '#64748b', marginTop: 2 }}>Verified by a timed skill assessment on Resume Build AI.</Text>
          </Section>
        )}

        {s.education.length > 0 && (
          <Section title="Education">
            {s.education.map((e, i) => (
              <View key={i} style={{ marginBottom: 4 }}>
                <View style={styles.row}>
                  <Text style={styles.bold}>{e.degree}{e.field ? `, ${e.field}` : ''}</Text>
                  <Text style={styles.muted}>{e.years}</Text>
                </View>
                <Text style={styles.muted}>{e.institution}{e.score ? `  ·  ${e.score}` : ''}</Text>
              </View>
            ))}
          </Section>
        )}

        {work.length > 0 && <Section title="Experience"><Entries items={work} /></Section>}
        {projects.length > 0 && <Section title="Projects"><Entries items={projects} /></Section>}
        {s.otherSkills.length > 0 && (
          <Section title="Other Skills (self-declared)"><Text>{s.otherSkills.join('  ·  ')}</Text></Section>
        )}

        <Text style={styles.footer} fixed>
          {`Resume v${version} · generated ${s.generatedAt.slice(0, 10)} · Resume Build AI`}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderResumePdf(s: ResumeSnapshot, showPct: boolean, version: number): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<ResumeDocument s={s} showPct={showPct} version={version} />);
}
