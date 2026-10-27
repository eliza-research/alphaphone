import {expect, type Page} from '@playwright/test';

/** Select the test-mocks-only calendar backed by the registered browser provider.
 * The platform stays web so draft persistence uses its real browser transactions.
 * Agent Calendar and retained app-calendar records remain separate sources. */
export async function openBrowserCalendar(page: Page) {
  await expect(page.getByRole('button', {name: 'Calendar', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Calendar', exact: true}).click();
  const sources = page.locator('summary').filter({hasText: 'Calendar sources'});
  await sources.click();
  await page.getByRole('button', {name: 'Browser calendar (development)', exact: true}).click();
  await sources.click();
}
