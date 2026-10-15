import { expect, test } from '@playwright/test';
import { answerQuestion, correctAnswers, onboard, pickRole, startCampusTest, submitTest } from './helpers';

test('workshop flow: join -> onboarding -> campus test -> role -> verified resume', async ({ page }) => {
  await onboard(page);

  const { questions } = await startCampusTest(page);
  expect(questions).toHaveLength(15);
  const correct = await correctAnswers(questions.map((q) => q.id));

  for (let i = 0; i < questions.length; i++) {
    await expect(page.getByText(`Question ${i + 1} of 15`)).toBeVisible();
    await answerQuestion(page, correct.get(questions[i].id)!);
    if (i < questions.length - 1) await page.locator('footer').getByRole('button', { name: 'Next' }).click();
  }
  await submitTest(page);
  await page.waitForURL('**/results?attempt=*');
  await expect(page.getByText('100%')).toBeVisible();
  await expect(page.getByText('Campus Verified').first()).toBeVisible();

  await pickRole(page);
  await expect(page.getByText('Version 2 ✓')).toBeVisible();
  await expect(page.getByText('Verified Skills')).toBeVisible();
  const pdf = await page.request.get('/api/resume/2/pdf');
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
});

test('network cut mid-test: answers survive offline, submit retries and lands', async ({ page, context }) => {
  await onboard(page, 'Offline Student');
  const { questions } = await startCampusTest(page);
  const correct = await correctAnswers(questions.map((q) => q.id));

  // Answer 5 online, then reload: answers must come back from IndexedDB/server.
  for (let i = 0; i < 5; i++) {
    await answerQuestion(page, correct.get(questions[i].id)!);
    await page.locator('footer').getByRole('button', { name: 'Next' }).click();
  }
  await page.reload();
  await expect(page.getByText('Question 1 of 15')).toBeVisible();
  await expect(page.locator('main').getByRole('button', { name: correct.get(questions[0].id)!, exact: true }))
    .toHaveAttribute('aria-pressed', 'true');

  // WiFi drops: keep answering, then try to submit.
  await context.setOffline(true);
  for (let i = 0; i < 15; i++) {
    if (i >= 5) await answerQuestion(page, correct.get(questions[i].id)!);
    if (i < 14) await page.locator('footer').getByRole('button', { name: 'Next' }).click();
  }
  await submitTest(page);
  await expect(page.getByText(/No internet\. Your answers are safe/)).toBeVisible();

  // WiFi returns: the queued submission goes through on its own.
  await context.setOffline(false);
  await page.waitForURL('**/results?attempt=*', { timeout: 60_000 });
  await expect(page.getByText('100%')).toBeVisible();
});

test('slow 3G: campus test still completes', async ({ page, context }) => {
  await onboard(page, 'Slow Student');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 400, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8,
  });
  const { questions } = await startCampusTest(page);
  const correct = await correctAnswers(questions.map((q) => q.id));
  for (let i = 0; i < questions.length; i++) {
    await answerQuestion(page, correct.get(questions[i].id)!);
    if (i < questions.length - 1) await page.locator('footer').getByRole('button', { name: 'Next' }).click();
  }
  await submitTest(page);
  await page.waitForURL('**/results?attempt=*', { timeout: 90_000 });
  await expect(page.getByText('100%')).toBeVisible();
});

test('wrong PIN 5 times locks the account for 10 minutes', async ({ page }) => {
  await onboard(page, 'Lock Student');
  await page.goto('/test/sql');
  for (let i = 0; i < 5; i++) {
    await page.locator('#pin').fill('0000');
    await page.getByRole('button', { name: 'Start test' }).click();
    await expect(page.locator('p[role=alert]')).toBeVisible();
  }
  await expect(page.locator('p[role=alert]')).toContainText('Too many wrong PINs');
});

test('Tamil toggle switches candidate screens', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'தமிழ்' }).click();
  await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
  await expect(page.getByText('பயிற்சிப் பட்டறையில் சேருங்கள்')).toBeVisible();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByText('Join a workshop')).toBeVisible();
});

test('proctor board shows PIN and student status', async ({ page }) => {
  await page.goto('/proctor/DEMO-001');
  await page.locator('#pw').fill('demo1234');
  await page.getByRole('button', { name: 'Open board' }).click();
  await expect(page.getByText('1234')).toBeVisible();
  await expect(page.getByText(/DEMO workshop: fixed PIN/)).toBeVisible();
  await page.getByRole('button', { name: 'Show join QR' }).click();
  await expect(page.getByAltText(/QR code/)).toBeVisible();
});

test('python runner works in the browser (Pyodide worker)', async ({ page }) => {
  test.setTimeout(240_000);
  await onboard(page, 'Py Student', 'Python');
  await page.goto('/test/python');
  await page.getByText('On my own').click();
  await page.getByRole('button', { name: 'Start test' }).click();
  await page.waitForURL(/\?a=/);
  const id = new URL(page.url()).searchParams.get('a')!;
  const data = await (await page.request.get(`/api/test/${id}`)).json();
  const idx = (data.questions as { type: string }[]).findIndex((q) => q.type === 'code_python');
  test.skip(idx < 0, 'no coding question drawn this time');
  for (let i = 0; i < idx; i++) await page.locator('footer').getByRole('button', { name: 'Next' }).click();
  const editor = page.getByLabel('code editor');
  const q = data.questions[idx] as { calls: string[]; starterCode: string };
  const fn = q.starterCode.match(/def (\w+)/)![1];
  await editor.fill(`def ${fn}(*args):\n    return 42\n`);
  await page.getByRole('button', { name: /Run/ }).click();
  await expect(page.getByText(/→\s+42/).first()).toBeVisible({ timeout: 120_000 });
  // infinite loop is killed after 8 s
  await editor.fill(`def ${fn}(*args):\n    while True:\n        pass\n`);
  await page.getByRole('button', { name: /Run/ }).click();
  await expect(page.getByText(/longer than 8 seconds/)).toBeVisible({ timeout: 30_000 });
});
