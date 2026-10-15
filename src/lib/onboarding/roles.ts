import { canonicalSkillName, normSkill } from '../skill-alias';
import type { Goal, Level } from './catalog';

/**
 * Entry-level job roles and the skills that matter for each. Matching is rule-based (instant, free,
 * works before sign-up): declared skills count, verified test scores count more.
 */
export interface JobRole {
  id: string;
  title: string;
  /** Core skills (weight 3), helpful skills (weight 1). Names go through the skill alias map. */
  core: string[];
  helpful: string[];
  soft: string[];
  /** Goals this role suits; 'not_sure' suits everything. */
  goals: Goal[];
  /** Roles where spoken English is a big part of the job. */
  englishHeavy?: boolean;
}

const J: Goal[] = ['job', 'internship'];
const F: Goal[] = ['job', 'internship', 'freelancing'];

export const JOB_ROLES: JobRole[] = [
  { id: 'software-dev', title: 'Software Developer (Trainee)', core: ['Java', 'Python', 'C++', 'C'], helpful: ['SQL', 'Git', 'JavaScript'], soft: ['Problem solving', 'Teamwork'], goals: J },
  { id: 'web-dev', title: 'Web Developer', core: ['HTML/CSS', 'JavaScript'], helpful: ['React', 'Git', 'SQL'], soft: ['Problem solving', 'Creativity'], goals: F },
  { id: 'frontend-dev', title: 'Frontend Developer', core: ['JavaScript', 'React', 'HTML/CSS'], helpful: ['Figma', 'Git'], soft: ['Creativity', 'Teamwork'], goals: F },
  { id: 'python-dev', title: 'Python Developer', core: ['Python'], helpful: ['SQL', 'Git'], soft: ['Problem solving'], goals: F },
  { id: 'java-dev', title: 'Java Developer', core: ['Java'], helpful: ['SQL', 'Git'], soft: ['Problem solving', 'Teamwork'], goals: J },
  { id: 'qa-tester', title: 'QA / Software Tester', core: ['Java', 'Python', 'SQL'], helpful: ['Excel', 'Git'], soft: ['Critical thinking', 'Time management'], goals: J },
  { id: 'data-analyst', title: 'Data Analyst', core: ['SQL', 'Excel', 'Python'], helpful: ['Power BI', 'Tableau', 'Statistics'], soft: ['Problem solving', 'Critical thinking', 'Presentation'], goals: J },
  { id: 'business-analyst', title: 'Business Analyst (Fresher)', core: ['Excel', 'SQL'], helpful: ['Power BI', 'PowerPoint'], soft: ['Communication', 'Presentation', 'Problem solving'], goals: J, englishHeavy: true },
  { id: 'mis-executive', title: 'MIS Executive', core: ['Excel'], helpful: ['Google Sheets', 'SQL', 'Power BI'], soft: ['Time management'], goals: J },
  { id: 'ui-ux', title: 'UI/UX Designer', core: ['Figma'], helpful: ['Canva', 'Photoshop', 'HTML/CSS'], soft: ['Creativity', 'Communication'], goals: F },
  { id: 'graphic-designer', title: 'Graphic Designer', core: ['Canva', 'Photoshop', 'Illustrator'], helpful: ['Figma', 'Video editing'], soft: ['Creativity'], goals: F },
  { id: 'video-editor', title: 'Video Editor', core: ['Video editing'], helpful: ['Canva', 'Photoshop'], soft: ['Creativity', 'Time management'], goals: F },
  { id: 'digital-marketing', title: 'Digital Marketing Executive', core: ['Digital Marketing', 'Social Media Marketing'], helpful: ['SEO', 'Canva', 'Content Writing', 'Excel'], soft: ['Creativity', 'Communication'], goals: F },
  { id: 'content-writer', title: 'Content Writer', core: ['Content Writing'], helpful: ['SEO', 'MS Word', 'Canva'], soft: ['Creativity', 'Time management'], goals: F, englishHeavy: true },
  { id: 'office-admin', title: 'Office / Admin Executive', core: ['MS Word', 'Excel'], helpful: ['PowerPoint', 'Typing', 'Google Sheets'], soft: ['Time management', 'Communication'], goals: J },
  { id: 'accounts-assistant', title: 'Accounts Assistant', core: ['Tally', 'Excel'], helpful: ['MS Word', 'Google Sheets'], soft: ['Time management', 'Problem solving'], goals: J },
  { id: 'cad-draftsman', title: 'AutoCAD Draftsman', core: ['AutoCAD'], helpful: ['Revit', 'Excel'], soft: ['Time management'], goals: F },
  { id: 'design-engineer', title: 'Design Engineer (CAD)', core: ['SolidWorks', 'CATIA', 'AutoCAD'], helpful: ['MATLAB', 'Excel'], soft: ['Problem solving', 'Teamwork'], goals: J },
  { id: 'automation-engineer', title: 'Automation / PLC Engineer (Trainee)', core: ['PLC'], helpful: ['MATLAB', 'AutoCAD', 'Excel'], soft: ['Problem solving', 'Teamwork'], goals: J },
  { id: 'customer-support', title: 'Customer Support Executive', core: [], helpful: ['MS Word', 'Excel', 'Typing'], soft: ['Communication', 'Customer handling', 'Adaptability'], goals: J, englishHeavy: true },
  { id: 'sales-executive', title: 'Sales Executive', core: ['Sales'], helpful: ['Excel', 'PowerPoint'], soft: ['Communication', 'Customer handling', 'Presentation'], goals: J, englishHeavy: true },
  { id: 'hr-executive', title: 'HR Executive (Fresher)', core: [], helpful: ['Excel', 'MS Word', 'PowerPoint'], soft: ['Communication', 'Teamwork', 'Leadership'], goals: J, englishHeavy: true },
  { id: 'teaching-assistant', title: 'Teaching Assistant / Tutor', core: [], helpful: ['PowerPoint', 'Excel', 'Python'], soft: ['Presentation', 'Communication', 'Leadership'], goals: ['job', 'higher_studies', 'freelancing'] },
  { id: 'research-assistant', title: 'Research / Project Assistant', core: ['Python', 'MATLAB', 'Statistics'], helpful: ['Excel', 'MS Word'], soft: ['Critical thinking', 'Problem solving'], goals: ['higher_studies', 'internship'] },
];

export interface MatchInput {
  goal: Goal | null;
  englishLevel: Level | null;
  softSkills: string[];
  techSkills: string[];
  /** Verified test scores (only those shown publicly, i.e. >= the beginner threshold), by skill name. */
  verified?: Record<string, number>;
}

export interface RoleMatch {
  role: JobRole;
  /** 0-100, for display. */
  matchPct: number;
  /** Declared skills that match this role (core first). */
  skills: string[];
  /** Of those, the ones verified by a test. */
  verifiedSkills: string[];
  soft: string[];
  goalFit: boolean;
}

const key = (s: string) => normSkill(canonicalSkillName(s));

export function matchRoles(input: MatchInput, limit = 3): RoleMatch[] {
  const tech = new Set(input.techSkills.map(key));
  const soft = new Set(input.softSkills.map(key));
  const verified = new Map(Object.entries(input.verified ?? {}).map(([k, v]) => [key(k), v]));

  const scored = JOB_ROLES.map((role) => {
    let score = 0;
    let max = 0;
    const skills: string[] = [];
    const verifiedSkills: string[] = [];
    for (const [list, w] of [[role.core, 3], [role.helpful, 1]] as const) {
      for (const s of list) {
        max += w;
        const k = key(s);
        if (verified.has(k)) {
          // a verified skill counts fully, scaled a little by how well it was scored
          score += w * (1 + (verified.get(k)! - 50) / 100);
          skills.push(s);
          verifiedSkills.push(s);
        } else if (tech.has(k)) {
          score += w * 0.8;
          skills.push(s);
        }
      }
    }
    const softHits = role.soft.filter((s) => soft.has(key(s)));
    score += softHits.length * 0.75;
    max += role.soft.length * 0.75;
    const goalFit = !input.goal || input.goal === 'not_sure' || role.goals.includes(input.goal);
    if (goalFit) score += 1;
    max += 1;
    if (role.englishHeavy) {
      if (input.englishLevel === 'fluent') score += 1;
      else if (input.englishLevel === 'basic') score -= 1;
      max += 1;
    }
    // A role needs at least one technical match unless it is a soft-skill role (no core skills).
    const eligible = skills.length > 0 || (role.core.length === 0 && softHits.length > 0);
    return { role, score: eligible ? score : -1, max, skills, verifiedSkills, soft: softHits, goalFit };
  });

  // Rank by how much of the role the candidate covers, weighted by how much evidence there is
  // (so a narrow role matched by one skill doesn't beat a broad role matched by three).
  const rank = (r: { score: number; max: number }) => (r.score / r.max) * Math.sqrt(r.score);
  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => rank(b) - rank(a) || a.role.title.localeCompare(b.role.title))
    .slice(0, limit)
    .map(({ role, score, max, skills, verifiedSkills, soft: s, goalFit }) => ({
      role,
      matchPct: Math.max(30, Math.min(98, Math.round((score / max) * 100))),
      skills, verifiedSkills, soft: s, goalFit,
    }));
}

export const roleById = (id: string) => JOB_ROLES.find((r) => r.id === id) ?? null;
