import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import ta from '@/i18n/ta.json';
import { SOFT_SKILLS, TECH_SKILL_GROUPS } from '@/lib/onboarding/catalog';
import { JOB_ROLES, matchRoles } from '@/lib/onboarding/roles';
import { canonicalSkillName, normSkill } from '@/lib/skill-alias';

const allSkills = TECH_SKILL_GROUPS.flatMap((g) => g.skills);
const top = (techSkills: string[], goal: 'job' | 'freelancing' = 'job') =>
  matchRoles({ goal, englishLevel: 'intermediate', softSkills: ['Problem solving'], techSkills }, 3).map((m) => m.role.id);

describe('technical skill chips', () => {
  it('have no duplicates across groups', () => {
    expect(new Set(allSkills.map(normSkill)).size).toBe(allSkills.length);
  });
  it('put the new groups right after Data, in order', () => {
    expect(TECH_SKILL_GROUPS.map((g) => g.domain).slice(0, 7)).toEqual(['software', 'data', 'ai_ml', 'genai', 'agents', 'cloud', 'security']);
  });
  it('append the new Data skills without re-adding existing ones', () => {
    const data = TECH_SKILL_GROUPS.find((g) => g.domain === 'data')!.skills;
    expect(data.slice(0, 5)).toEqual(['SQL', 'Excel', 'Power BI', 'Tableau', 'Statistics']);
    expect(data).toEqual(expect.arrayContaining(['Pandas', 'NumPy', 'Spark', 'MLOps']));
  });
  it('have English and Tamil headings for every group', () => {
    for (const g of TECH_SKILL_GROUPS) {
      expect((en as Record<string, string>)[`ob.domain.${g.domain}`], g.domain).toBeTruthy();
      expect((ta as Record<string, string>)[`ob.domain.${g.domain}`], g.domain).toBeTruthy();
    }
    expect((ta as Record<string, string>)['ob.domain.security']).toBe('சைபர் பாதுகாப்பு');
  });
  it('resolve common short forms to the chip name', () => {
    expect(canonicalSkillName('mcp')).toBe('MCP (Model Context Protocol)');
    expect(canonicalSkillName('k8s')).toBe('Kubernetes');
    expect(canonicalSkillName('GCP')).toBe('Google Cloud');
    expect(canonicalSkillName('sklearn')).toBe('Scikit-learn');
  });
});

describe('job roles', () => {
  it('have unique ids and titles', () => {
    expect(new Set(JOB_ROLES.map((r) => r.id)).size).toBe(JOB_ROLES.length);
    expect(new Set(JOB_ROLES.map((r) => r.title)).size).toBe(JOB_ROLES.length);
  });
  it('only use skills that exist as chips (or soft skills)', () => {
    const chips = new Set(allSkills.map(normSkill));
    const soft = new Set(SOFT_SKILLS.map(normSkill));
    for (const r of JOB_ROLES) {
      for (const s of [...r.core, ...r.helpful]) expect(chips.has(normSkill(s)), `${r.id}: ${s}`).toBe(true);
      for (const s of r.soft) expect(soft.has(normSkill(s)), `${r.id}: ${s}`).toBe(true);
    }
  });
  it('match the new skill groups to the new roles', () => {
    expect(top(['Machine Learning', 'Deep Learning', 'Python', 'PyTorch'])).toContain('ai-engineer');
    expect(top(['Generative AI', 'LLMs', 'RAG', 'Python', 'LangChain'], 'freelancing')).toEqual(
      expect.arrayContaining(['genai-developer', 'llm-engineer']));
    expect(top(['AI Agents', 'MCP (Model Context Protocol)', 'Agentic Workflows', 'n8n'], 'freelancing')).toEqual(
      expect.arrayContaining(['ai-agent-developer', 'ai-automation-specialist']));
    expect(top(['Docker', 'Kubernetes', 'Linux', 'CI/CD'])[0]).toMatch(/devops-engineer|sre/);
    expect(top(['AWS', 'Azure', 'Linux'])[0]).toBe('cloud-engineer');
    expect(top(['Penetration Testing', 'Ethical Hacking', 'Kali Linux', 'Burp Suite'])[0]).toBe('penetration-tester');
    expect(top(['SOC / SIEM', 'Network Security', 'Wireshark'])).toEqual(expect.arrayContaining(['soc-analyst', 'cybersecurity-analyst']));
  });
  it('still suggests Data Analyst first for SQL + Excel + Python', () => {
    expect(top(['SQL', 'Excel', 'Python'])[0]).toBe('data-analyst');
  });
});
