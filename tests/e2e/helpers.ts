import { expect, type Page } from '@playwright/test';
import pg from 'pg';

export const DB_URL = process.env.E2E_DB_URL ?? 'postgres://postgres:postgres@localhost:54329/localstack';

export function uniquePhone() {
  // 9 + 9 random digits, starts with 9 so it is a valid Indian mobile
  return `9${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 900 + 100)}`;
}

export async function register(page: Page, name = 'Test Student') {
  const phone = uniquePhone();
  await page.goto('/join/DEMO-001');
  await page.locator('#full_name').fill(name);
  await page.locator('#phone').fill(phone);
  await page.locator('#password').fill('secret12');
  await page.getByRole('button', { name: 'Register' }).click();
  await page.waitForURL('**/wizard');
  return phone;
}

export async function completeWizard(page: Page, skill = 'Excel') {
  const card = page.locator('fieldset').first();
  await card.locator('input').nth(0).fill('Demo College of Engineering');
  await card.locator('input').nth(1).fill('B.E.');
  await card.locator('input').nth(2).fill('CSE');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Experience & projects' })).toBeVisible();
  await page.getByRole('button', { name: 'Add experience or project' }).click();
  await page.locator('fieldset').first().locator('input').nth(0).fill('Library app');
  await page.locator('fieldset').first().locator('textarea').fill('Built search\nAdded login');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Skills you have' })).toBeVisible();
  await page.getByRole('button', { name: skill, exact: true }).click();
  await page.getByRole('button', { name: 'Finish & take my skill tests' }).click();
  await page.waitForURL('**/test');
}

/** Correct option text per question id, straight from the DB (test-only shortcut). */
export async function correctAnswers(ids: string[]) {
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  const { rows } = await c.query('select id, options, correct from questions where id = any($1)', [ids]);
  await c.end();
  return new Map(rows.map((r) => [r.id as string, (r.options as string[])[Number(r.correct)]]));
}

export async function startCampusTest(page: Page, slug = 'excel', pin = '1234') {
  await page.goto(`/test/${slug}`);
  await page.locator('#pin').fill(pin);
  await page.getByRole('button', { name: 'Start test' }).click();
  await page.waitForURL(/\/test\/.+\?a=/);
  const attemptId = new URL(page.url()).searchParams.get('a')!;
  const res = await page.request.get(`/api/test/${attemptId}`);
  const data = await res.json();
  return { attemptId, questions: data.questions as { id: string; type: string; options?: { text: string }[] }[] };
}

export async function answerQuestion(page: Page, text: string) {
  await page.locator('main').getByRole('button', { name: text, exact: true }).click();
}

export async function submitTest(page: Page) {
  await page.locator('footer').getByRole('button', { name: 'Submit test' }).first().click();
  await page.locator('footer').getByRole('button', { name: 'Submit test' }).last().click();
}
