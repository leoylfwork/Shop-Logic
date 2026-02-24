import { test, expect } from '@playwright/test';
import { login, signOut, getCredentialsForRole } from './helpers/login';
import { createOrder } from './helpers/createOrder';
import { getOrdersFromDB, type RepairOrderRow } from './helpers/db';

const uniqueModel = () => `E2E Mechanic RO ${Date.now()}`;
const customerName = 'E2E Test Customer';

function hasRoleCreds(role: 'owner' | 'advisor' | 'foreman'): boolean {
  try {
    getCredentialsForRole(role);
    return true;
  } catch {
    return false;
  }
}

test.describe('creation', () => {
  test.beforeEach(async ({ page }) => {
    if (!hasRoleCreds('owner')) test.skip(true, 'E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD not set');
    await login(page, 'owner');
  });

  // Requires Supabase backend; create flow refetches before closing dialog so card can take a few seconds
  test('owner can create Mechanic RO, card appears, persists after refresh and in DB', async ({ page }) => {
    test.skip(!process.env.E2E_SUPABASE_URL && !process.env.VITE_SUPABASE_URL, 'Supabase URL required for DB checks');

    const model = uniqueModel();
    await createOrder(page, { model, customerName, phone: '555-E2E' });

    await expect(page.getByText(model).first()).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await page.waitForSelector('text=Workflow', { timeout: 15_000 });
    await expect(page.getByText(model).first()).toBeVisible({ timeout: 15_000 });

    const rows = await getOrdersFromDB('owner');
    const created = rows.find((r: RepairOrderRow) => r.customer_name === customerName);
    expect(created, 'Repair order should exist in DB after create').toBeDefined();
  });
});

test.describe('permissions', () => {
  test.beforeEach(async ({ page }) => {
    if (!hasRoleCreds('advisor')) test.skip(true, 'E2E_ADVISOR_EMAIL / E2E_ADVISOR_PASSWORD not set');
    await login(page, 'advisor');
  });

  test('advisor cannot see Active Bays UI', async ({ page }) => {
    await page.waitForSelector('text=Workflow', { timeout: 15_000 });
    const activeBaysAside = page.locator('aside').filter({ hasText: 'Active Bays' });
    await expect(activeBaysAside).not.toBeVisible();
  });

  test('advisor can see New Order button', async ({ page }) => {
    await page.waitForSelector('text=Workflow', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: /new order/i })).toBeVisible();
  });
});

test.describe('bay assignment', () => {
  test.beforeEach(async ({ page }) => {
    if (!hasRoleCreds('foreman')) test.skip(true, 'E2E_FOREMAN_EMAIL / E2E_FOREMAN_PASSWORD not set');
  });

  test('foreman can change status to IN_PROGRESS and assign bay', async ({ page }) => {
    if (!hasRoleCreds('owner')) test.skip(true, 'Bay assignment test also requires E2E_OWNER_* to create RO');
    test.skip(!process.env.E2E_SUPABASE_URL && !process.env.VITE_SUPABASE_URL, 'Supabase URL required for DB checks');

    const model = uniqueModel();
    await login(page, 'owner');
    await createOrder(page, { model, customerName, phone: '555-E2E' });
    await expect(page.getByText(model).first()).toBeVisible({ timeout: 15_000 });

    const rowsOwner = await getOrdersFromDB('owner');
    const created = rowsOwner.find((r: RepairOrderRow) => r.customer_name === customerName);
    expect(created).toBeDefined();
    const roId = created!.id;

    const inProgressSection = page.locator('section').filter({ has: page.locator('h2:has-text("In Progress")') }).first();
    const card = page.locator('div').filter({ has: page.locator(`h4:has-text("${model}")`) }).first();
    await card.dragTo(inProgressSection);
    await page.waitForTimeout(500);

    await signOut(page);
    await login(page, 'foreman');

    const openPlanner = page.getByRole('button', { name: /panel|active bays/i }).first();
    if (await openPlanner.isVisible()) await openPlanner.click();
    await page.waitForTimeout(300);

    const bay1 = page.locator('div').filter({ hasText: 'Bay 1' }).first();
    await bay1.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    const cardInProgress = page.locator('div').filter({ has: page.locator(`h4:has-text("${model}")`) }).first();
    await cardInProgress.dragTo(bay1);
    await page.waitForTimeout(800);

    const rowsForeman = await getOrdersFromDB('foreman');
    const updated = rowsForeman.find((r: RepairOrderRow) => r.id === roId);
    expect(updated, 'RO should still exist after status/bay update').toBeDefined();
    expect(updated!.status, 'status should be IN_PROGRESS after drag').toBe('IN_PROGRESS');
    expect(updated!.bay_id, 'bay_id should be set after assign').toBeTruthy();
  });
});
