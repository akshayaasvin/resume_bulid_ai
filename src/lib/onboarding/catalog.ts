import { z } from 'zod';

/** Onboarding answers (steps 1-4). Shared by the client flow and the register API. */
export const GOALS = ['job', 'internship', 'higher_studies', 'freelancing', 'not_sure'] as const;
export type Goal = (typeof GOALS)[number];
export const LEVELS = ['basic', 'intermediate', 'fluent'] as const;
export type Level = (typeof LEVELS)[number];

/** Languages offered by "+ Add language" (English is always there). "Other" lets the candidate type one. */
export const EXTRA_LANGUAGES = [
  'Tamil', 'Hindi', 'Malayalam', 'Telugu', 'Kannada', 'Urdu', 'Marathi', 'Bengali', 'French', 'German', 'Japanese', 'Arabic',
] as const;

export const languageEntrySchema = z.object({ name: z.string().trim().min(2).max(40), level: z.enum(LEVELS) });
export type LanguageEntry = z.infer<typeof languageEntrySchema>;

export const SOFT_SKILLS = [
  'Teamwork', 'Leadership', 'Problem solving', 'Time management', 'Presentation', 'Communication',
  'Adaptability', 'Critical thinking', 'Creativity', 'Customer handling',
] as const;

/** Technical skills grouped by domain. Names match the test catalogue where a test exists. */
export const TECH_SKILL_GROUPS: { domain: 'software' | 'data' | 'design' | 'office' | 'engineering' | 'marketing'; skills: string[] }[] = [
  { domain: 'software', skills: ['Python', 'Java', 'JavaScript', 'HTML/CSS', 'C', 'C++', 'React', 'Git'] },
  { domain: 'data', skills: ['SQL', 'Excel', 'Power BI', 'Tableau', 'Statistics'] },
  { domain: 'design', skills: ['Canva', 'Figma', 'Photoshop', 'Illustrator', 'Video editing'] },
  { domain: 'office', skills: ['MS Word', 'PowerPoint', 'Tally', 'Typing', 'Google Sheets'] },
  { domain: 'engineering', skills: ['AutoCAD', 'SolidWorks', 'CATIA', 'MATLAB', 'Revit', 'PLC'] },
  { domain: 'marketing', skills: ['Digital Marketing', 'SEO', 'Social Media Marketing', 'Content Writing', 'Sales'] },
];

export const onboardingAnswersSchema = z.object({
  goal: z.enum(GOALS),
  english_level: z.enum(LEVELS),
  /** Other spoken languages in the order added (English is separate and always first). */
  languages: z.array(languageEntrySchema).max(12)
    .refine((l) => new Set(l.map((x) => x.name.toLowerCase())).size === l.length && l.every((x) => x.name.toLowerCase() !== 'english'),
      'duplicate language')
    .default([]),
  soft_skills: z.array(z.string().trim().min(2).max(40)).max(12),
  tech_skills: z.array(z.string().trim().min(2).max(60)).min(1).max(20),
});
export type OnboardingAnswers = z.infer<typeof onboardingAnswersSchema>;
