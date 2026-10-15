/**
 * Maps the many ways candidates type a skill onto the catalogue name, so "JS" or "Core Java"
 * still unlocks the right test. Keys are normalised (trimmed, lower-case, single spaces).
 */
const ALIASES: Record<string, string> = {
  js: 'JavaScript', javascript: 'JavaScript', es6: 'JavaScript',
  html: 'HTML/CSS', css: 'HTML/CSS', html5: 'HTML/CSS', css3: 'HTML/CSS',
  'core java': 'Java', 'java programming': 'Java',
  ppt: 'PowerPoint', 'ms powerpoint': 'PowerPoint', powerpoint: 'PowerPoint',
  'ms excel': 'Excel', excel: 'Excel', 'advanced excel': 'Excel',
  'communication skills': 'Communication', 'english communication': 'Communication',
  'public speaking': 'Public Speaking', 'presentation skills': 'Public Speaking',
  'team work': 'Teamwork', 'team player': 'Teamwork',
  ml: 'Machine Learning', dl: 'Deep Learning', 'gen ai': 'Generative AI', genai: 'Generative AI', llm: 'LLMs',
  mcp: 'MCP (Model Context Protocol)', 'model context protocol': 'MCP (Model Context Protocol)',
  'tool use': 'Function Calling / Tool Use', 'function calling': 'Function Calling / Tool Use',
  gcp: 'Google Cloud', 'google cloud platform': 'Google Cloud', k8s: 'Kubernetes', 'ci cd': 'CI/CD', cicd: 'CI/CD',
  owasp: 'Web Security (OWASP)', siem: 'SOC / SIEM', soc: 'SOC / SIEM', sklearn: 'Scikit-learn', 'scikit learn': 'Scikit-learn',
  numpy: 'NumPy', 'data viz': 'Data Visualization', 'apache spark': 'Spark',
};

export const normSkill = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** The canonical name for a typed skill (alias target), or the trimmed input when there is no alias. */
export function canonicalSkillName(input: string): string {
  return ALIASES[normSkill(input)] ?? input.trim().replace(/\s+/g, ' ');
}

/** The catalogue skill a typed name refers to, through aliases and case-insensitive matching. */
export function findCatalogSkill<T extends { name: string }>(input: string, catalog: readonly T[]): T | null {
  const want = normSkill(canonicalSkillName(input));
  return catalog.find((c) => normSkill(c.name) === want) ?? null;
}

/** Autocomplete: catalogue skills whose name or alias contains / starts with the query. */
export function suggestSkills<T extends { name: string }>(query: string, catalog: readonly T[], limit = 5): T[] {
  const q = normSkill(query);
  if (!q) return [];
  const viaAlias = new Set(Object.entries(ALIASES).filter(([alias]) => alias.startsWith(q)).map(([, name]) => normSkill(name)));
  const hits = catalog.filter((c) => normSkill(c.name).includes(q) || viaAlias.has(normSkill(c.name)));
  // names that start with the query first, then alphabetical
  return hits
    .sort((a, b) => Number(!normSkill(a.name).startsWith(q)) - Number(!normSkill(b.name).startsWith(q)) || a.name.localeCompare(b.name))
    .slice(0, limit);
}
