import {test,expect} from '@playwright/test';
for(const theme of ['light','dark'])test(`compact Home reaches lower apps and horizontal widgets in ${theme}`,async({page},info)=>{
 // Reproduce the fresh Pixel WebView's GMT representation through the real
 // renderer startup and Home navigation, rather than testing a helper in isolation.
 await page.addInitScript(()=>{const original=Intl.DateTimeFormat.prototype.resolvedOptions;Intl.DateTimeFormat.prototype.resolvedOptions=function(){return {...original.call(this),timeZone:'+00:00'};};});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width:360,height:640});await page.goto('/?mode=dev&theme='+theme);
 const settings=page.getByRole('button',{name:'Settings',exact:true});await settings.scrollIntoViewIfNeeded();expect(await settings.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})).toBe(true);expect(await page.locator('[data-alpha-layer=home]').evaluate(el=>{const r=el.getBoundingClientRect();return parseFloat(getComputedStyle(el).top)===44&&r.top>0&&!el.contains(document.elementFromPoint(r.left+r.width/2,r.top-2));})).toBe(true);await page.screenshot({path:info.outputPath('home-bottom.png')});await settings.click();await expect(page.locator('html')).toHaveAttribute('data-active-view','settings');
 await page.getByRole('button',{name:'Home',exact:true}).click();await page.getByRole('button',{name:'Open workflows',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-active-view','workflows');await page.getByRole('button',{name:'Home',exact:true}).click();await expect(page.getByRole('textbox',{name:'Ask Alpha',exact:true})).toBeVisible();
 expect(errors).toEqual([]);
});
