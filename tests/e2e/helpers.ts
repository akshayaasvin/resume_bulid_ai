import { expect, type Page } from '@playwright/test';
import pg from 'pg';

export const DB_URL = process.env.E2E_DB_URL ?? 'postgres://postgres:postgres@localhost:54329/localstack';

export function uniquePhone() {
  // 9 + 9 random digits, starts with 9 so it is a valid Indian mobile
  return `9${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 900 + 100)}`;
}

/** Goal-based onboarding through the workshop link: answers -> roles -> details -> /test. */
export async function onboard(page: Page, name = 'Test Student', skill = 'Excel') {
  const phone = uniquePhone();
  await page.goto('/join/DEMO-001');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: /^A job/ }).click();
  for (const lang of ['English', 'Tamil']) {
    await page.getByRole('group', { name: lang }).getByRole('button', { name: 'Intermediate' }).click();
  }
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Teamwork' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: skill, exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Roles that fit you' })).toBeVisible();
  await page.getByRole('button', { name: 'Save my results' }).click();
  await page.locator('#ob-full_name').fill(name);
  await page.locator('#ob-phone').fill(phone);
  await page.locator('#ob-password').fill('secret12');
  await page.locator('[id$="-institution"]').first().fill('Demo College of Engineering');
  await page.locator('[id$="-degree"]').first().fill('B.E.');
  await page.getByRole('button', { name: 'Create my account' }).click();
  await page.waitForURL('**/test');
  return phone;
}

/** After the tests: pick the first suggested role, which opens the resume. */
export async function pickRole(page: Page) {
  await page.goto('/roles');
  await page.getByRole('button', { name: 'Choose this role' }).first().click();
  await page.waitForURL('**/resume');
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
