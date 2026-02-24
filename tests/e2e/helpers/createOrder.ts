import type { Page } from '@playwright/test';

export type CreateOrderOptions = {
  model: string;
  customerName: string;
  phone?: string;
  info?: string;
};

/** Locate input by its label text (label is sibling in parent). */
function inputByLabel(page: Page, labelText: string) {
  return page.locator('div').filter({ has: page.locator(`label:has-text("${labelText}")`) }).locator('input').first();
}

/**
 * Open New Order dialog, choose Mechanic, fill form, submit. Waits for the created repair order card (by model name) to appear.
 */
export async function createOrder(
  page: Page,
  options: CreateOrderOptions
): Promise<void> {
  const { model, customerName, phone = '', info = '' } = options;

  await page.getByRole('button', { name: /new order/i }).click();
  await page.waitForSelector('text=NEW ORDER', { state: 'visible' });

  await page.getByRole('button', { name: /mechanic order/i }).click();

  await inputByLabel(page, 'MODEL').fill(model);
  await inputByLabel(page, 'CLIENT').fill(customerName);
  await inputByLabel(page, 'PHONE').fill(phone);

  if (info) {
    const infoEditor = page.locator('textarea, [contenteditable="true"]').first();
    if (await infoEditor.count() > 0) await infoEditor.fill(info);
  }

  await page.getByRole('button', { name: /initiate mechanic ro/i }).click();
  // Wait for create (Supabase insert) to complete and card to appear on board
  await page.getByText(model).first().waitFor({ state: 'visible', timeout: 20_000 });
}
