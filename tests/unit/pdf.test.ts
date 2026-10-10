import { describe, expect, it } from 'vitest';
import { renderResumePdf } from '@/lib/resume/pdf';
import type { ResumeSnapshot } from '@/lib/resume/snapshot';

const snap: ResumeSnapshot = {
  name: 'Priya Subramanian',
  nameTamil: 'பிரியா சுப்ரமணியன்',
  phone: '+919876543210',
  email: 'priya@example.com',
  college: 'Demo College of Engineering',
  department: 'B.E. CSE',
  year: 3,
  summary: 'Final-year CSE student who enjoys data work.',
  education: [{ institution: 'Demo College', degree: 'B.E.', field: 'CSE', years: '2023 – 2027', score: '8.4' }],
  experience: [
    { type: 'internship', title: 'Data Intern', organization: 'Acme', period: 'Jun 2025 – Jul 2025', bullets: ['Cleaned 10k rows', 'Built a dashboard'] },
    { type: 'project', title: 'Library app', organization: null, period: '', bullets: ['Search and login'] },
  ],
  verifiedSkills: [
    { name: 'Python', level: 'advanced', badge: 'campus_verified', scorePct: 86 },
    { name: 'Excel', level: 'intermediate', badge: 'self', scorePct: 66 },
  ],
  otherSkills: ['Canva'],
  generatedAt: '2026-01-01T00:00:00.000Z',
};

describe('resume PDF', () => {
  it('renders an A4 PDF with Latin + Tamil text', async () => {
    const buf = await renderResumePdf(snap, false, 2);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(5_000);
    const text = buf.toString('latin1');
    // both font families embedded
    expect(text).toMatch(/NotoSans-Regular|NotoSans/);
    expect(text).toMatch(/NotoSansTamil/);
  });
});
