import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
  await page.goto('/');
});

test('production entry uses one shared root for Home, All apps and the existing Settings view',async({page},info)=>{
  await expect(page.locator('[data-mobile-application]')).toHaveCount(1);
  await expect(page.locator('[data-mobile-shell-home]')).toHaveCount(1);
  await page.getByRole('button',{name:'All apps',exact:true}).click();
  const drawer=page.getByRole('dialog',{name:'All apps'});await expect(drawer).toBeVisible();
  await drawer.getByRole('button',{name:/^Open Settings(?: \(Alpha Phone\))?$/}).click();
  await expect(page.locator('html')).toHaveAttribute('data-active-view','settings');
  await expect(page.locator('[data-mobile-shell-home]')).toHaveAttribute('inert','');
  const back=page.getByRole('button',{name:'Back to apps',exact:true});
  await back.focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'All apps',exact:true})).toBeVisible();
  await expect(page.locator('[data-mobile-application]')).toHaveCount(1);
  await page.screenshot({path:info.outputPath('shared-alpha-home.png')});
});

test('the existing composer survives view and drawer placement without a second owner',async({page})=>{
  const composer=page.locator('[data-alpha-composer]:visible');await composer.fill('Keep my draft');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Back to apps',exact:true}).click();
  await expect(page.locator('[data-alpha-composer]:visible')).toHaveValue('Keep my draft');
  await page.getByRole('button',{name:'All apps',exact:true}).click();
  await page.getByRole('button',{name:'Close all apps',exact:true}).click();
  await expect(page.locator('[data-alpha-composer]:visible')).toHaveValue('Keep my draft');
  await expect(page.locator('[data-alpha-composer]:visible')).toHaveCount(1);
});

test('native chrome hides the explicit simulated cutout after root placement changes',async({page})=>{
  await page.evaluate(()=>document.documentElement.classList.add('native-phone'));
  await expect(page.locator('[data-alpha-system-cutout]')).toBeHidden();
  await expect(page.locator('[data-mobile-shell-home]')).toBeVisible();
});
