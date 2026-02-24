import type { Page } from '@playwright/test';

export type E2ERole = 'owner' | 'advisor' | 'foreman';

const ROLE_ENV: Record<E2ERole, { email: string; password: string }> = {
  owner: {
    email: process.env.E2E_OWNER_EMAIL ?? '',
    password: process.env.E2E_OWNER_PASSWORD ?? '',
  },
  advisor: {
    email: process.env.E2E_ADVISOR_EMAIL ?? '',
    password: process.env.E2E_ADVISOR_PASSWORD ?? '',
  },
  foreman: {
    email: process.env.E2E_FOREMAN_EMAIL ?? '',
    password: process.env.E2E_FOREMAN_PASSWORD ?? '',
  },
};

/**
 * Resolve credentials for a role. Throws if not set.
 */
export function getCredentialsForRole(role: E2ERole): { email: string; password: string } {
  const { email, password } = ROLE_ENV[role];
  if (!email || !password) throw new Error(`E2E_${role.toUpperCase()}_EMAIL and E2E_${role.toUpperCase()}_PASSWORD must be set`);
  return { email, password };
}

/**
 * Log in with Supabase email/password for the given role.
 * Reads E2E_OWNER_EMAIL/PASSWORD, E2E_ADVISOR_EMAIL/PASSWORD, or E2E_FOREMAN_EMAIL/PASSWORD.
 */
export async function login(page: Page, role: E2ERole): Promise<void> {
  const { email, password } = getCredentialsForRole(role);
  await page.goto('/');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForSelector('text=Workflow', { timeout: 15_000 });
}

/**
 * Sign out and return to login screen so the next login(role) can use different credentials.
 */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /sign out/i }).click();
  await page.waitForSelector('text=Sign in', { timeout: 10_000 });
}
