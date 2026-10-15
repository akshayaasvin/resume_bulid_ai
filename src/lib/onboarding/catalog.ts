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
export type SkillDomain =
  | 'software' | 'data' | 'ai_ml' | 'genai' | 'agents' | 'cloud' | 'security' | 'design' | 'office' | 'engineering' | 'marketing';
export const TECH_SKILL_GROUPS: { domain: SkillDomain; skills: string[] }[] = [
  { domain: 'software', skills: ['Python', 'Java', 'JavaScript', 'HTML/CSS', 'C', 'C++', 'React', 'Git'] },
  {
    domain: 'data',
    skills: [
      'SQL', 'Excel', 'Power BI', 'Tableau', 'Statistics',
      'Pandas', 'NumPy', 'Matplotlib', 'Seaborn', 'Jupyter', 'R', 'Data Visualization', 'Data Cleaning', 'Big Data', 'Spark', 'MLOps',
    ],
  },
  {
    domain: 'ai_ml',
    skills: ['Machine Learning', 'Deep Learning', 'TensorFlow', 'PyTorch', 'Scikit-learn', 'NLP', 'Computer Vision', 'Keras', 'OpenCV'],
  },
  {
    domain: 'genai',
    skills: [
      'Generative AI', 'LLMs', 'Prompt Engineering', 'OpenAI API', 'Claude API', 'Gemini API', 'Hugging Face', 'LangChain',
      'LlamaIndex', 'RAG', 'Vector Databases', 'Fine-tuning',
    ],
  },
  {
    domain: 'agents',
    skills: [
      'AI Agents', 'MCP (Model Context Protocol)', 'Agentic Workflows', 'CrewAI', 'LangGraph', 'n8n', 'Function Calling / Tool Use',
      'Claude Code', 'Cursor', 'GitHub Copilot',
    ],
  },
  {
    domain: 'cloud',
    skills: ['AWS', 'Azure', 'Google Cloud', 'Linux', 'Docker', 'Kubernetes', 'Terraform', 'CI/CD', 'Jenkins', 'GitHub Actions', 'Nginx'],
  },
  {
    domain: 'security',
    skills: [
      'Network Security', 'Ethical Hacking', 'Penetration Testing', 'Kali Linux', 'Wireshark', 'Nmap', 'Burp Suite', 'SOC / SIEM',
      'Cryptography', 'Firewalls', 'Web Security (OWASP)',
    ],
  },
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
