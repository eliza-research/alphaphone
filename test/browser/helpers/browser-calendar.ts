import {expect, type Page} from '@playwright/test';

/** Use the existing Settings page; selecting a source does not grant agent access. */
export async function selectCalendarSource(page: Page, name: string) {
  const back = page.getByRole('button', {name: 'Back to apps', exact: true});
  if (await back.isVisible()) await back.click();
  await page.getByRole('button', {name: 'Settings', exact: true}).click();
  await page.getByRole('button', {name: 'Calendar', exact: true}).click();
  await page.locator('[data-settings-page="Calendar"]').getByRole('button', {name, exact: true}).click();
  await page.getByRole('button', {name: 'Back to Settings', exact: true}).click();
  if (await back.isVisible()) await back.click();
  else await page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
  await expect(page.getByRole('button', {name: 'Calendar', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Calendar', exact: true}).click();
}

/** The test-mocks-only browser provider retains its real browser transactions. */
export async function openBrowserCalendar(page: Page) {
  await expect(page.getByRole('button', {name: 'Calendar', exact: true})).toBeVisible();
  await selectCalendarSource(page, 'Browser calendar (development)');
}
