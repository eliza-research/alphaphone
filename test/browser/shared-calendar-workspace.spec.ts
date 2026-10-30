import {test,expect,type Page} from '@playwright/test';
import {returnToApps} from './app-navigation';

/** Actual renderer/controller/retained editor; closed owner-record reads only.
 * These synthetic records never reach a provider or native Calendar service. */
async function openCalendar(page:Page, mode:'ready'|'partial'|'unavailable'='ready',eventCount=1){
 await page.addInitScript(()=>localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'})));
 await page.goto('/');
 await page.evaluate(async({mode,eventCount})=>{
  const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');
  const f=(window as any).sharedCalendarFixture={owner:'first',mode,calls:[] as any[]};
  c.getAppRecordClient=()=>{
   const owner=f.owner, identity={ownerId:owner,agentId:'shared-calendar-agent',sessionId:owner,origin:location.origin};
   return {identity,sessionId:owner,current:()=>owner===f.owner,request:async(path:string,method:string,_body:unknown,signal:AbortSignal)=>{
    signal.throwIfAborted();f.calls.push({owner,path,method});if(method!=='GET')throw Error('Read-only Calendar fixture forbids writes');
    const url=new URL(path,location.origin),now=new Date().toISOString();
    const start=new Date();start.setHours(10,0,0,0);const end=new Date(start);end.setHours(11);
    const source={provider:'eliza',side:'agent',grantId:owner+'-grant',connectorAccountId:owner+'-account',accountEmail:null,calendarId:owner+'-calendar',summary:owner+' calendar',description:null,primary:true,accessRole:'owner',backgroundColor:null,foregroundColor:null,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,selected:true,includeInFeed:true,selectionVersion:0};
    const event={...source,id:owner+'-event',externalId:owner+'-external',agentId:identity.agentId,title:owner+' planning',description:'Event detail retained by the existing host',location:'',status:'confirmed',startAt:start.toISOString(),endAt:end.toISOString(),isAllDay:false,timezone:source.timeZone,htmlLink:null,conferenceLink:null,organizer:null,attendees:[],metadata:{etag:'v1'},syncedAt:now,updatedAt:now};
    if(url.pathname==='/api/notes/state')return{success:true,data:{notes:[],trash:[],revision:0}};
    if(url.pathname==='/api/lifeops/calendar/feed')return{calendarId:source.calendarId,events:f.mode==='unavailable'?[]:Array.from({length:eventCount},(_,i)=>({...event,id:owner+'-event-'+i,title:i?owner+' planning '+(i+1):event.title})),source:'cache',state:f.mode==='ready'?'complete':f.mode,sources:[],timeMin:url.searchParams.get('timeMin'),timeMax:url.searchParams.get('timeMax'),syncedAt:now};
    if(url.pathname==='/api/lifeops/calendar/calendars')return{calendars:[source]};
    if(url.pathname==='/api/lifeops/calendar/next-context')return{event:null,readScope:{selection:'next_event',timeMin:now,timeMax:new Date(Date.now()+86400000).toISOString(),exhaustive:false},calendarFeedState:f.mode==='ready'?'complete':f.mode,calendarSources:[],startsAt:null,startsInMinutes:null,attendeeCount:0,attendeeNames:[],location:null,conferenceLink:null,preparationChecklist:[],linkedMailState:'unavailable',linkedMailError:null,linkedMail:[]};
    throw Error('Unexpected Calendar fixture route '+path);
   }};
  };
  await c.offline();
 },{mode,eventCount});
 await page.getByRole('button',{name:'Calendar',exact:true}).click();
 await expect(page.locator('[data-alpha-shared-calendar]')).toBeVisible();
}

test('shared grid opens the existing exact event detail and retains the creation draft through Home',async({page})=>{
 await openCalendar(page);
 await page.getByRole('button',{name:/first planning/}).click();
 const detail=page.locator('[data-alpha-subview="calendar-detail"]:not([inert])');await expect(detail).toContainText('Event detail retained by the existing host');
 await page.getByRole('button',{name:'Back to calendar',exact:true}).click();
 await expect(page.getByRole('button',{name:'New event',exact:true})).toHaveCount(1);
 await page.getByRole('button',{name:'New event',exact:true}).click();
 await page.getByRole('textbox',{name:'Title',exact:true}).fill('Keep shared Calendar draft');
 await returnToApps(page);await page.getByRole('button',{name:'Calendar',exact:true}).click();
 const resume=page.getByRole('button',{name:'Resume event draft',exact:true});if(await resume.isVisible())await resume.click();
 const create=page.getByRole('button',{name:'New event',exact:true});if(await create.isVisible())await create.click();
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('Keep shared Calendar draft');
 expect(await page.evaluate(()=>(window as any).sharedCalendarFixture.calls.every((call:any)=>call.method==='GET'))).toBe(true);
});

test('a changed owner replaces shared events and cannot save the retained prior-owner form',async({page})=>{
 await openCalendar(page);await page.getByRole('button',{name:'New event',exact:true}).click();await page.getByRole('textbox',{name:'Title',exact:true}).fill('First owner draft');
 await page.evaluate(async()=>{(window as any).sharedCalendarFixture.owner='second';const {connectionController:c}=await import('/src/runtime/connection-ui.tsx');await c.offline();});
 await expect(page.getByRole('textbox',{name:'Title',exact:true})).toHaveValue('First owner draft');
 await expect(page.getByRole('button',{name:'Save event',exact:true})).toHaveAttribute('aria-disabled','true');
 await page.getByRole('button',{name:'Back to calendar',exact:true}).click();
 await expect(page.getByRole('button',{name:/second planning/})).toBeVisible();await expect(page.getByRole('button',{name:/first planning/})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).sharedCalendarFixture.calls.every((call:any)=>call.method==='GET'))).toBe(true);
});

for(const mode of ['partial','unavailable'] as const)test(`shared workspace preserves ${mode} source truth`,async({page})=>{
 await openCalendar(page,mode);
 await expect(page.getByText('No events in this range',{exact:true})).toHaveCount(0);
 await expect(page.locator('[data-alpha-shared-calendar]').getByText(mode==='partial'?'Some calendar sources are unavailable. Events may be incomplete.':'Calendar unavailable',{exact:true})).toBeVisible();
 if(mode==='partial')await expect(page.getByRole('button',{name:/first planning/})).toBeVisible();
});


test('month overflow stays readable and opens the exact additional event',async({page},info)=>{
 await openCalendar(page,'ready',5);
 await page.getByRole('button',{name:'Month',exact:true}).click();
 await page.getByRole('button',{name:'+2 more',exact:true}).click();
 const overflow=page.getByTestId('lifeops-calendar-day-overflow');
 await expect(overflow).toBeVisible();
 await expect(overflow).toHaveCSS('width','256px');
 await expect(overflow).toHaveCSS('padding','0px');
 await expect(overflow).not.toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 await page.screenshot({path:info.outputPath('month-overflow.png')});
 await overflow.getByRole('button',{name:/first planning 4/}).click();
 await expect(page.locator('[data-alpha-subview="calendar-detail"]:not([inert])')).toContainText('first planning 4');
 expect(await page.evaluate(()=>(window as any).sharedCalendarFixture.calls.every((call:any)=>call.method==='GET'))).toBe(true);
});


test('a complete empty day stays empty while the broad owner feed retains other days',async({page})=>{
 await openCalendar(page);
 await expect(page.getByRole('button',{name:/first planning/})).toBeVisible();
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await expect(page.locator('[data-alpha-shared-calendar]').getByText('No events in this range',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/first planning/})).toHaveCount(0);
 await page.getByRole('button',{name:'Previous',exact:true}).click();
 await expect(page.getByRole('button',{name:/first planning/})).toBeVisible();
});
