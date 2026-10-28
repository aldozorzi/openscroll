import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { E2E_CARDS, createEmailVerificationTokenForEmail, createPasswordResetTokenForEmail, makeAllCardsDue } from './db';

const PASSWORD = 'e2e-password-is-long-enough';

function emailFor(label: string): string {
  return `e2e-${label}-${randomUUID()}@example.com`;
}

async function register(page: Page, email: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);

  // In production mode Turnstile is enforced. Wait for the challenge token
  // before submitting, otherwise the server correctly rejects the request.
  const captchaWidget = page.getByRole('group', { name: 'Bot protection' });
  if (await captchaWidget.isVisible().catch(() => false)) {
    await expect(
      page.locator('input[name="cf-turnstile-response"]'),
    ).toHaveValue(/\S+/u, { timeout: 30_000 });
  }

  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

  // E2E cannot read the verification email, so mint an equivalent token for
  // the account and consume it through the real UI/endpoint.
  const token = await createEmailVerificationTokenForEmail(email);
  await page.goto(`/verify-email?token=${encodeURIComponent(token)}`);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/u);
}

async function skipOnboarding(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page).toHaveURL(/\/feed$/u);
}

async function waitForActiveCard(page: Page): Promise<string> {
  const heading = page.locator('[data-feed-active="true"] article h1').first();
  await expect(heading).toBeVisible();
  const text = await heading.innerText();
  expect(E2E_CARDS.map((card) => card.hook)).toContain(text);
  return text;
}

async function waitForActiveCardChange(page: Page, previousHook: string): Promise<string> {
  return expect.poll(async () => {
    const text = await page.locator('[data-feed-active="true"] article h1').first().innerText();
    if (text !== previousHook) {
      expect(E2E_CARDS.map((card) => card.hook)).toContain(text);
      return text;
    }
    throw new Error('still same card');
  }, { timeout: 15000, message: 'active card did not change' });
}

test('onboarding saves topics and opens a seeded feed', async ({ page }) => {
  const email = emailFor('onboarding');
  await register(page, email);

  await page.getByRole('button', { name: 'machine learning' }).click();
  await page.getByLabel('Add your own topic').fill('custom e2e topic');
  await page.getByRole('button', { name: 'Add topic' }).click();
  await expect(
    page.getByRole('button', { name: 'Remove custom e2e topic' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'What should stay out?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.getByRole('heading', { name: 'Add a source' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Finish setup' }).click();

  await expect(page).toHaveURL(/\/feed$/u);
  await waitForActiveCard(page);
  await expect(page.getByRole('heading', { name: 'Your feed' })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('scroll, keyboard navigation, save, and saved view work', async ({ page }) => {
  await register(page, emailFor('feed'));
  await skipOnboarding(page);

  const firstHook = await waitForActiveCard(page);

  await page.locator('main').evaluate((el) => {
    el.scrollTop = 1200;
  });

  const secondHook = await waitForActiveCardChange(page, firstHook);

  const activeCard = page.locator('[data-feed-active="true"]');
  await activeCard.getByRole('button', { name: 'Save card' }).click();
  await expect(page.getByText('Saved to your library.')).toBeVisible();

  const beforeKeyboard = await waitForActiveCard(page);
  await page.keyboard.press('ArrowDown');
  const afterKeyboard = await waitForActiveCardChange(page, beforeKeyboard);

  await page.getByRole('link', { name: 'Saved', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Saved cards' })).toBeVisible();
  await expect.poll(async () => {
    const text = await page.getByText(secondHook, { exact: true }).first().innerText();
    return text;
  }, { timeout: 10000, message: 'saved card not found' });
});

test('like and dislike advance to the next card', async ({ page }) => {
  await register(page, emailFor('rate'));
  await skipOnboarding(page);

  const firstHook = await waitForActiveCard(page);
  await page.locator('[data-feed-active="true"]').getByRole('button', { name: 'Like', exact: true }).click();
  const secondHook = await waitForActiveCardChange(page, firstHook);

  await page.locator('[data-feed-active="true"]').getByRole('button', { name: 'Dislike', exact: true }).click();
  const thirdHook = await waitForActiveCardChange(page, secondHook);
});

test('forgot password returns a generic confirmation', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?', exact: true }).click();
  await expect(page).toHaveURL(/\/forgot-password$/u);

  await page.getByLabel('Email', { exact: true }).fill(emailFor('forgot'));
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
});

test('a one-time link resets the password and signs in', async ({ page }) => {
  const email = emailFor('reset');
  await register(page, email);
  await skipOnboarding(page);

  const token = await createPasswordResetTokenForEmail(email);
  await page.goto(`/reset-password?token=${encodeURIComponent(token)}`);
  await page.getByLabel('New password', { exact: true }).fill('new-e2e-password-is-long');
  await page.getByLabel('Confirm password', { exact: true }).fill('new-e2e-password-is-long');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();

  await expect(page).toHaveURL(/\/feed$/u);
  await expect(page.getByText('Password updated. You are signed in.')).toBeVisible();
  await waitForActiveCard(page);

  await page.goto('/reset-password?token=invalid');
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
});

test('a due card can be reviewed from the review queue', async ({ page }) => {
  const email = emailFor('review');
  await register(page, email);
  await skipOnboarding(page);
  await makeAllCardsDue(email);

  await page.goto('/review');
  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
  await waitForActiveCard(page);

  const activeCard = page.locator('[data-feed-active="true"]');
  await activeCard.getByRole('button', { name: '7 days' }).click();
  await expect(page.getByText('Review scheduled.')).toBeVisible();
});