/**
 * Client-side rules for the wizard's Education step. Anything that passes here also passes the
 * server schema in /api/wizard (years 1950-2100, text lengths), so a valid form never gets a 400.
 */
export interface EducationInput {
  institution: string; degree: string; field?: string | null;
  start_year: number | null; end_year: number | null; score: string | null;
}
export type EduField = 'institution' | 'degree' | 'start_year' | 'end_year' | 'score';
export type EduError = 'required' | 'tooShort' | 'year' | 'yearOrder' | 'score' | 'letters' | 'junk';
export type EduErrors = Partial<Record<EduField, EduError>>;

/** Order used to find the first invalid field to focus. */
export const EDU_FIELDS: EduField[] = ['institution', 'degree', 'start_year', 'end_year', 'score'];

export const YEAR_MIN = 1970;
export const yearMax = (now = new Date()) => now.getFullYear() + 5;

const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

/**
 * Catches keyboard mash typed into a school/college name: "Asd", "qwe", "Vbb", "aaaa".
 * Abbreviations in capitals such as "PSG", "SRM" or "IIT" are allowed.
 */
export function isJunkName(raw: string): boolean {
  const letters = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (letters.length < 3) return true;
  if (/(.)\1\1/.test(letters)) return true; // aaa, xxx
  if (letters.length <= 5 && KEYBOARD_ROWS.some((row) => row.includes(letters) || [...row].reverse().join('').includes(letters))) return true;
  // a vowel-less word is only allowed as a capitalised abbreviation (PSG, SRM)
  return raw.split(/[^A-Za-z]+/).some((w) => w.length >= 3 && !/[aeiouy]/i.test(w) && w !== w.toUpperCase());
}

/** School / college names: letters plus common punctuation, no digits. */
const NAME_CHARS = /^[A-Za-z][A-Za-z .,'&()/-]*$/;

/** A card the candidate hasn't started filling is ignored (not validated, not saved). */
export function isBlankEducation(e: EducationInput): boolean {
  return !e.institution.trim() && !e.degree.trim() && !e.field?.trim() && e.start_year == null && e.end_year == null && !e.score?.trim();
}

/**
 * CGPA 0-10 or percentage 0-100, up to 2 decimals, with an optional suffix: "%", "CGPA" or "GPA"
 * (any case, space optional). A CGPA/GPA suffix means the 0-10 scale. The text is stored as typed.
 */
export function isValidScore(raw: string): boolean {
  const m = raw.trim().match(/^(\d{1,3}(?:\.\d{1,2})?)\s*(%|cgpa|gpa)?$/i);
  if (!m) return false;
  const max = m[2] && m[2] !== '%' ? 10 : 100;
  return Number(m[1]) <= max;
}

/** Input filter for the CGPA / % field: digits, '.', '%', spaces and the letters of "CGPA" / "GPA" only. */
export const sanitizeScoreInput = (s: string) => s.replace(/[^0-9.%\scgpa]/gi, '');

const validYear = (y: number, now: Date) => Number.isInteger(y) && y >= YEAR_MIN && y <= yearMax(now);

export function validateEducation(e: EducationInput, now = new Date()): EduErrors {
  const errors: EduErrors = {};
  if (isBlankEducation(e)) return errors;
  const inst = e.institution.trim();
  const deg = e.degree.trim();
  if (!inst) errors.institution = 'required';
  else if (inst.length < 3) errors.institution = 'tooShort';
  else if (!NAME_CHARS.test(inst)) errors.institution = 'letters';
  else if (isJunkName(inst)) errors.institution = 'junk';
  if (!deg) errors.degree = 'required';
  else if (deg.length < 2) errors.degree = 'tooShort';
  if (e.start_year != null && !validYear(e.start_year, now)) errors.start_year = 'year';
  if (e.end_year != null && !validYear(e.end_year, now)) errors.end_year = 'year';
  if (!errors.start_year && !errors.end_year && e.start_year != null && e.end_year != null && e.end_year < e.start_year) {
    errors.end_year = 'yearOrder';
  }
  if (e.score?.trim() && !isValidScore(e.score)) errors.score = 'score';
  return errors;
}

export const hasErrors = (errors: EduErrors) => Object.keys(errors).length > 0;

/** True when every non-blank card is valid (so the section can be sent to the server). */
export function educationValid(rows: EducationInput[], now = new Date()): boolean {
  return rows.every((r) => !hasErrors(validateEducation(r, now)));
}
