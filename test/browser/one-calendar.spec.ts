import {test,expect,type Page} from '@playwright/test';
import {installOneCalendar} from './helpers/one-calendar';

const requests=(page:Page)=>page.evaluate(()=>(window as any).oneCalendarFixture as {requests:string[];googleCalendarLists:number});

test('Calendar, Home and Google accounts show one merged calendar without a calendar choice',async({page})=>{
 await installOneCalendar(page,{googleInFeed:true});
 const card=page.locator('[data-alpha-home-calendar]');
 // Home reads the merged feed: Google's Holidays leads tomorrow, ahead of the owner's own calendars.
 await expect(card).toContainText('Public holiday');
 await card.click();await expect(page.locator('html')).toHaveAttribute('data-active-view','calendar');
 // Holidays is shown but read only in Google: its event names the source and offers no change.
 await expect(page.getByText('Holidays in United States · Read only',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit event',exact:true}).click();
 await expect(page.getByText('This calendar is read only.',{exact:true})).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new Event('alpha-back',{cancelable:true})));
 for(const title of ['Team standup','Dentist','Design review','Public holiday'])await expect(page.getByText(title,{exact:true}).first()).toBeVisible();
 await page.evaluate(async()=>{const {googleConnectionController}=await import('/src/runtime/google-connection-ui.tsx');googleConnectionController.open();});
 const panel=page.getByRole('dialog',{name:'Google accounts',exact:true});
 await expect(panel.getByRole('status')).toHaveText('Calendar includes the calendars you show in Google.');
 await expect(panel.getByRole('radio')).toHaveCount(0);
 await expect(panel.getByText('Calendar to display')).toHaveCount(0);
 await expect(panel.getByRole('button',{name:'Add Google account',exact:true})).toBeVisible();
 await expect(panel.getByRole('button',{name:'Check Google connections',exact:true})).toBeVisible();
 const fixture=await requests(page);
 expect(fixture.googleCalendarLists,'Google accounts never lists calendars to choose from').toBe(0);
 expect(fixture.requests.every(request=>request.startsWith('GET ')),'reading the merged calendar writes nothing').toBe(true);
});

test('hiding one merged calendar in Settings is a display choice for Calendar and Home on this device',async({page})=>{
 await installOneCalendar(page,{googleInFeed:true});
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('button',{name:'Calendar',exact:true}).click();
 await expect(page.getByText('Calendars shown in Alpha',{exact:true})).toBeVisible();
 // Only calendars in the agent's feed are listed: the built-in calendar and the ones shown in Google.
 for(const name of ['Eliza Calendar','owner@example.test','Holidays in United States'])await expect(page.getByRole('switch',{name:`Show ${name} calendar`})).toBeChecked();
 await page.getByRole('switch',{name:'Show Holidays in United States calendar'}).click();
 await expect(page.getByRole('switch',{name:'Show Holidays in United States calendar'})).not.toBeChecked();
 await page.evaluate(()=>window.dispatchEvent(new Event('launcher-home')));
 await expect(page.locator('html')).toHaveAttribute('data-active-view','home');
 const card=page.locator('[data-alpha-home-calendar]');
 await expect(card).toContainText('Team standup');
 expect((await requests(page)).requests.every(request=>request.startsWith('GET ')),'a display choice changes no source').toBe(true);
});
