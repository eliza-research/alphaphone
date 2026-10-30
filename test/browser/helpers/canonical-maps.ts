import {expect,type Page} from '@playwright/test';

/** Real shared view/controller with closed provider and location ports; no real route or fix. */
export async function openCanonicalMaps(page:Page,state='base',theme='light'){
 await page.addInitScript(()=>{
  localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}));
  const w=window as any;w.mapWatchStarts=0;w.mapWatchStops=0;
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition:()=>{w.mapWatchStarts++;return 19;},clearWatch:()=>{w.mapWatchStops++;},getCurrentPosition:()=>{throw Error('Physical location forbidden');}}});
 });
 await page.route('https://tiles.openfreemap.org/**',route=>route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e7ebed'}}]}}));
 await page.goto(`/?theme=${theme}`);
 await page.evaluate(async()=>{
  const {configureMapsProvider}=await import('/src/maps/runtime.ts');
  const {MapPlane}=await import('/src/maps/map-plane.ts');
  const update=MapPlane.prototype.update;(window as any).mapPlaneInstances=new Set();
  MapPlane.prototype.update=function(...args){(window as any).layoutPlane=this;(window as any).mapPlaneInstances.add(this);return update.apply(this,args);};
  const places=[{id:'harbour',name:'Harbour',coordinate:{latitude:43.74,longitude:7.426}},{id:'garden',name:'Garden',coordinate:{latitude:43.742,longitude:7.428}}].map(place=>({...place,providerId:'layout-provider',attribution:'Controlled layout provider',fetchedAt:Date.now()}));
  configureMapsProvider({status:'configured',providerId:'layout-provider',connectionId:'conn_layout_provider_12345',revision:'one',capabilities:{map:false,search:true,placeDetails:true,modes:['drive','walk','bicycle'],traffic:'none',transit:'none',offline:{map:false,search:false,routing:false}}},{providerId:'layout-provider',connectionId:'conn_layout_provider_12345',search:async()=>places,detail:async(id:string)=>places.find(place=>place.id===id)!,route:async(from:any,to:any,mode:any)=>({providerId:'layout-provider',id:'layout-route',from,to,mode,geometry:[from,to],distanceMeters:650,durationSeconds:300,steps:[{instruction:'Continue towards Harbour',coordinate:to,distanceMeters:650}],attribution:'Controlled layout provider',fetchedAt:Date.now(),traffic:'none'})});
 });
 await page.getByRole('button',{name:'Maps',exact:true}).click();
 await expect(page.locator('[data-alpha-shared-maps] [data-maps-root]')).toBeVisible();
 if(state==='base')return;
 const search=page.getByRole('textbox',{name:'Search places',exact:true});await search.fill('Harbour');await search.press('Enter');
 await expect(page.locator('[data-maps-sheet="results"]')).toBeVisible();
 if(state==='search')return;
 await page.locator('[data-maps-sheet="results"]').getByRole('button',{name:/^Harbour/}).click();
 await expect(page.locator('[data-maps-sheet="place"]')).toBeVisible();
 if(state==='place')return;
 await page.getByRole('button',{name:'Directions',exact:true}).click();
 const origin=page.getByRole('textbox',{name:'Route origin coordinates',exact:true});await origin.fill('43.73, 7.42');await origin.press('Enter');
 await expect(page.getByRole('button',{name:'Start',exact:true})).toBeEnabled();
 if(state==='route')return;
 await page.getByRole('button',{name:'Start',exact:true}).click();
 await expect(page.locator('[data-maps-guidance]')).toBeVisible();
}
