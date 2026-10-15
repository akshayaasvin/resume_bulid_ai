import { canonicalSkillName, normSkill } from '../skill-alias';

/**
 * Cluster-based skill tests: one combined test per skill group instead of one test per skill.
 * Pure (shared by the hub, the test runner API and unit tests).
 */
export const CLUSTERS = [
  { id: 'frontend', label: 'Frontend Web', skills: ['HTML/CSS', 'JavaScript', 'React'] },
  { id: 'programming', label: 'Programming', skills: ['Python', 'Java', 'C', 'C++', 'Git'] },
  {
    id: 'data', label: 'Data & Analytics',
    skills: [
      'SQL', 'Excel', 'Power BI', 'Tableau', 'Statistics', 'Google Sheets', 'Pandas', 'NumPy', 'Matplotlib', 'Seaborn', 'R',
      'Data Visualization', 'Data Cleaning', 'Big Data', 'Spark',
    ],
  },
  {
    id: 'ai_ml', label: 'AI & ML',
    skills: ['Machine Learning', 'Deep Learning', 'TensorFlow', 'PyTorch', 'Scikit-learn', 'NLP', 'Computer Vision', 'Keras', 'OpenCV', 'MLOps'],
  },
  {
    id: 'genai_agents', label: 'GenAI & Agents',
    skills: [
      'Generative AI', 'LLMs', 'Prompt Engineering', 'OpenAI API', 'Claude API', 'Gemini API', 'Hugging Face', 'LangChain', 'LlamaIndex',
      'RAG', 'Vector Databases', 'Fine-tuning', 'AI Agents', 'MCP (Model Context Protocol)', 'Agentic Workflows', 'CrewAI', 'LangGraph',
      'Function Calling / Tool Use',
    ],
  },
  {
    id: 'cloud', label: 'Cloud & DevOps',
    skills: ['AWS', 'Azure', 'Google Cloud', 'Linux', 'Docker', 'Kubernetes', 'Terraform', 'CI/CD', 'Jenkins', 'GitHub Actions', 'Nginx'],
  },
  {
    id: 'security', label: 'Cybersecurity',
    skills: [
      'Network Security', 'Ethical Hacking', 'Penetration Testing', 'Kali Linux', 'Wireshark', 'Nmap', 'Burp Suite', 'SOC / SIEM',
      'Cryptography', 'Firewalls', 'Web Security (OWASP)',
    ],
  },
  { id: 'engineering', label: 'Engineering / CAD', skills: ['AutoCAD', 'SolidWorks', 'CATIA', 'MATLAB', 'Revit', 'PLC'] },
  { id: 'marketing', label: 'Marketing', skills: ['Digital Marketing', 'SEO', 'Social Media Marketing', 'Content Writing', 'Sales'] },
] as const;
export type ClusterId = (typeof CLUSTERS)[number]['id'];

/** Skills that are never tested by MCQ: shown as "Self-declared". (Typing: no WPM test exists yet.) */
export const SELF_DECLARED = [
  'Canva', 'Figma', 'Photoshop', 'Illustrator', 'Video editing', 'MS Word', 'PowerPoint', 'Tally', 'Jupyter', 'n8n',
  'Claude Code', 'Cursor', 'GitHub Copilot', 'Typing',
];

export const QUESTIONS_PER_CLUSTER = 15;
export const MIN_PER_SKILL = 3;
/** 15 questions at min 3 per skill covers at most 5 skills per cluster test. */
export const MAX_SKILLS_PER_CLUSTER = Math.floor(QUESTIONS_PER_CLUSTER / MIN_PER_SKILL);
/** Clusters suggested to verify right away; the rest can be verified later. */
export const VERIFY_NOW_LIMIT = 3;

const key = (s: string) => normSkill(canonicalSkillName(s));
export const isClusterId = (v: unknown): v is ClusterId => CLUSTERS.some((c) => c.id === v);
export const clusterById = (id: ClusterId) => CLUSTERS.find((c) => c.id === id)!;

/** The cluster a skill belongs to, or null (self-declared / unknown skills). */
export function clusterOf(skill: string): ClusterId | null {
  const k = key(skill);
  if (SELF_DECLARED.some((s) => key(s) === k)) return null;
  return CLUSTERS.find((c) => c.skills.some((s) => key(s) === k))?.id ?? null;
}

/**
 * Clusters to offer for the candidate's selected skills (only those with >= 1 selected skill),
 * most selected skills first, plus the skills that stay self-declared.
 */
export function offeredClusters(selected: string[]): { clusters: { id: ClusterId; skills: string[] }[]; selfDeclared: string[] } {
  const by = new Map<ClusterId, string[]>();
  const selfDeclared: string[] = [];
  for (const s of selected) {
    const c = clusterOf(s);
    if (!c) { selfDeclared.push(s); continue; }
    by.set(c, [...(by.get(c) ?? []), s]);
  }
  const order = CLUSTERS.map((c) => c.id);
  const clusters = Array.from(by, ([id, skills]) => ({ id, skills }))
    .sort((a, b) => b.skills.length - a.skills.length || order.indexOf(a.id) - order.indexOf(b.id));
  return { clusters, selfDeclared };
}

/**
 * Splits the cluster's 15 questions evenly over the selected skills (min 3 each). At most 5 skills
 * fit; the rest are left for a later test. Earlier skills get the remainder.
 */
export function planCluster(skills: string[], total = QUESTIONS_PER_CLUSTER, min = MIN_PER_SKILL): { skill: string; count: number }[] {
  const tested = skills.slice(0, Math.max(1, Math.floor(total / min)));
  const base = Math.floor(total / tested.length);
  const extra = total - base * tested.length;
  return tested.map((skill, i) => ({ skill, count: base + (i < extra ? 1 : 0) }));
}

export interface AnswerMark { skill: string; correct: boolean }

/** Adaptive stop: a skill stops after 2 wrong answers in a row. */
export function skillStopped(skill: string, answers: AnswerMark[]): boolean {
  const mine = answers.filter((a) => a.skill === skill);
  return mine.length >= 2 && !mine[mine.length - 1].correct && !mine[mine.length - 2].correct;
}

/**
 * Next skill to ask (round-robin in plan order, skipping finished and stopped skills), or null
 * when the test is complete.
 */
export function nextSkill(plan: { skill: string; count: number }[], answers: AnswerMark[]): string | null {
  const open = plan.filter((p) => answers.filter((a) => a.skill === p.skill).length < p.count && !skillStopped(p.skill, answers));
  if (!open.length) return null;
  const last = answers[answers.length - 1]?.skill;
  const lastIdx = last ? plan.findIndex((p) => p.skill === last) : -1;
  for (let i = 1; i <= plan.length; i++) {
    const cand = plan[(lastIdx + i) % plan.length];
    if (open.some((o) => o.skill === cand.skill)) return cand.skill;
  }
  return open[0].skill;
}

/** Per-skill score: correct answers out of the planned count (questions skipped by a stop count as wrong). */
export function skillScores(plan: { skill: string; count: number }[], answers: AnswerMark[]): Record<string, number> {
  return Object.fromEntries(plan.map((p) => {
    const correct = answers.filter((a) => a.skill === p.skill && a.correct).length;
    return [p.skill, Math.round((correct / p.count) * 10000) / 100];
  }));
}
