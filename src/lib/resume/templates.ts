/** One-page resume templates. Pure: shared by the PDF renderer, the API and the picker UI. */
export const TEMPLATE_IDS = ['modern', 'classic', 'minimal', 'creative', 'tech'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export interface TemplateStyle {
  /** Accent colour for headings, rules, bands. */
  accent: string;
  /** Text colour on top of the accent (header band / sidebar). */
  onAccent: string;
  /** Soft tint of the accent for pills and the sidebar. */
  tint: string;
  layout: 'single' | 'sidebar-left' | 'sidebar-right';
  header: 'band' | 'centered' | 'plain' | 'split';
  /** Section headings: uppercase small caps with a rule, or a coloured bar on the left. */
  headings: 'rule' | 'bar' | 'caps';
}

export const TEMPLATES: Record<TemplateId, TemplateStyle> = {
  modern: { accent: '#1e40af', onAccent: '#ffffff', tint: '#dbeafe', layout: 'single', header: 'band', headings: 'bar' },
  classic: { accent: '#1f2937', onAccent: '#ffffff', tint: '#e5e7eb', layout: 'single', header: 'centered', headings: 'rule' },
  minimal: { accent: '#334155', onAccent: '#ffffff', tint: '#f1f5f9', layout: 'single', header: 'plain', headings: 'caps' },
  creative: { accent: '#7c3aed', onAccent: '#ffffff', tint: '#ede9fe', layout: 'sidebar-left', header: 'plain', headings: 'bar' },
  tech: { accent: '#0f766e', onAccent: '#ffffff', tint: '#ccfbf1', layout: 'sidebar-right', header: 'split', headings: 'rule' },
};

export const isTemplateId = (v: unknown): v is TemplateId => typeof v === 'string' && (TEMPLATE_IDS as readonly string[]).includes(v);

const BY_ROLE: Record<string, TemplateId> = {
  'software-dev': 'tech', 'web-dev': 'tech', 'frontend-dev': 'tech', 'python-dev': 'tech', 'java-dev': 'tech',
  'qa-tester': 'tech', 'automation-engineer': 'tech',
  'data-analyst': 'modern', 'business-analyst': 'modern', 'mis-executive': 'modern', 'cad-draftsman': 'modern',
  'design-engineer': 'modern',
  'ui-ux': 'creative', 'graphic-designer': 'creative', 'video-editor': 'creative', 'digital-marketing': 'creative',
  'content-writer': 'creative',
  'office-admin': 'classic', 'accounts-assistant': 'classic', 'customer-support': 'classic', 'sales-executive': 'classic',
  'hr-executive': 'classic', 'teaching-assistant': 'classic',
  'research-assistant': 'minimal',
};

/** The template that suits a target role best (Modern when there is no role yet). */
export function recommendTemplate(roleId: string | null | undefined): TemplateId {
  return (roleId && BY_ROLE[roleId]) || 'modern';
}
