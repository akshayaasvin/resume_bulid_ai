import { YEAR_MIN, yearMax, type EduError } from './education-validation';

/** Client-side rules for "Awards & certificates" (wizard step 3). Same year rules as Education. */
export interface AwardInput { name: string; issuer: string | null; year: number | null }
export type AwardField = 'name' | 'issuer' | 'year';
export type AwardErrors = Partial<Record<AwardField, EduError>>;
export const AWARD_FIELDS: AwardField[] = ['name', 'issuer', 'year'];

/** An untouched card is ignored (not validated, not saved). */
export const isBlankAward = (a: AwardInput) => !a.name.trim() && !a.issuer?.trim() && a.year == null;

export function validateAward(a: AwardInput, now = new Date()): AwardErrors {
  const errors: AwardErrors = {};
  if (isBlankAward(a)) return errors;
  const name = a.name.trim();
  if (!name) errors.name = 'required';
  else if (name.length < 2) errors.name = 'tooShort';
  if (a.year != null && !(Number.isInteger(a.year) && a.year >= YEAR_MIN && a.year <= yearMax(now))) errors.year = 'year';
  return errors;
}

export function awardsValid(rows: AwardInput[], now = new Date()): boolean {
  return rows.every((r) => Object.keys(validateAward(r, now)).length === 0);
}
