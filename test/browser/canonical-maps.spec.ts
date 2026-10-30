import {expect,test} from '@playwright/test';
import {openCanonicalMaps} from './helpers/canonical-maps';
import {setTextScale} from './accessibility-states';
test.use({hasTouch:true,isMobile:true,video:'on'});

test('mock Maps uses the shared view without device effects or changing saved places',async({page})=>{
 test.setTimeout(60_000);
 await page.route('https://tiles.openfreemap.org/**',route=>route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e7ebed'}}]}}));
 await page.addInitScript(()=>{
  const w=window as any;w.mapEffects=[];
  const effect=(name:string)=>{w.mapEffects.push(name);throw Error('Device effects are forbidden in this preview');};
  Object.defineProperty(navigator,'geolocation',{value:{watchPosition:()=>effect('location'),getCurrentPosition:()=>effect('location'),clearWatch:()=>effect('location-stop')},configurable:true});
  Object.defineProperty(navigator,'share',{value:()=>effect('share'),configurable:true});
  window.open=()=>effect('window-open');
  localStorage.setItem('alpha.maps.saved-places.v1',JSON.stringify({version:1,items:[{id:'private-saved-place',label:'Real saved place',coordinate:{latitude:1,longitude:2},savedAt:1}]}));
  w.originalSaved=localStorage.getItem('alpha.maps.saved-places.v1');
 });
 await page.goto('/?mode=mock&start=maps');
 await expect(page.locator('[data-alpha-shared-maps] [data-maps-root]')).toBeVisible();
 await page.getByRole('button',{name:'Add location',exact:true}).click();
 await expect(page.locator('[data-maps-status]')).toContainText('Location is unavailable in this preview.');
 const search=page.getByRole('textbox',{name:'Search places',exact:true});
 await search.fill('43.74, 7.426');await search.press('Enter');
 await expect(page.getByRole('button',{name:'Rename place',exact:true})).toContainText('Dropped pin');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.getByRole('button',{name:'Remove from saved',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Share',exact:true}).click();
 await expect(page.getByText('Sharing is unavailable in this preview.',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).mapEffects)).toEqual([]);
 expect(await page.evaluate(()=>localStorage.getItem('alpha.maps.saved-places.v1'))).toBe(await page.evaluate(()=>(window as any).originalSaved));
 await page.reload();
 await expect(page.locator('[data-alpha-shared-maps] [data-maps-root]')).toBeVisible();
 await expect(page.getByText('Real saved place',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Dropped pin',{exact:true})).toHaveCount(0);
});

test('shared Maps keeps guidance and controls accessible through 300% landscape and keyboard reflow',async({page},info)=>{
 await openCanonicalMaps(page,'route');
 await setTextScale(page,3);
 await page.setViewportSize({width:915,height:412});
 const start=page.getByRole('button',{name:'Start',exact:true});
 await start.scrollIntoViewIfNeeded();await start.focus();
 await expect(start).toBeFocused();
 await page.screenshot({path:info.outputPath('alpha-directions-300-landscape.png')});
 expect(await page.evaluate(()=>(window as any).mapWatchStarts)).toBe(0);
 await start.press('Enter');
 await expect(page.locator('[data-maps-guidance]')).toContainText('Waiting for location');
 await expect.poll(()=>page.evaluate(()=>(window as any).mapWatchStarts)).toBe(1);
 await page.setViewportSize({width:390,height:450});
 await page.locator('[data-maps-scroll]').evaluate(el=>{el.scrollTop=0;});
 await page.screenshot({path:info.outputPath('alpha-guidance-300-keyboard.png')});
 const end=page.getByRole('button',{name:'End navigation',exact:true});
 await end.focus();await expect(end).toBeFocused();
 const exposed=await end.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return el===hit||el.contains(hit);});
 expect(exposed).toBe(true);
 expect(await page.evaluate(()=>(window as any).mapWatchStarts)).toBe(1);
 expect(await page.evaluate(()=>(window as any).mapPlaneInstances.size)).toBe(1);
 await info.attach('stable-map-and-watch',{body:JSON.stringify(await page.evaluate(()=>({mapPlanes:(window as any).mapPlaneInstances.size,watchStarts:(window as any).mapWatchStarts}))),contentType:'application/json'});
 await end.press('Enter');
 await expect.poll(()=>page.evaluate(()=>(window as any).mapWatchStops)).toBe(1);
});

for(const viewport of [{width:412,height:915},{width:915,height:412}])test(`route endpoints fit the uncovered Maps area at ${viewport.width}x${viewport.height}`,async({page},info)=>{
 await page.setViewportSize(viewport);
 await openCanonicalMaps(page,'route');
 const projection=()=>page.evaluate(()=>{
  const map=document.querySelector('[data-map-plane]')!.getBoundingClientRect();
  return [{longitude:7.42,latitude:43.73},{longitude:7.426,latitude:43.74}].map(point=>{
   const projected=(window as any).layoutPlane.map.project([point.longitude,point.latitude]);
   const x=map.left+projected.x,y=map.top+projected.y,hit=document.elementFromPoint(x,y);
   return {x,y,clear:x>=map.left&&x<=map.right&&y>=map.top&&y<=map.bottom&&!hit?.closest('[data-maps-primary],[data-maps-sheet],[data-maps-navigation-controls],[data-maps-credits]')};
  });
 });
 await expect.poll(async()=>(await projection()).map(point=>point.clear)).toEqual([true,true]);
 const marker=()=>page.evaluate(()=>{
  const map=document.querySelector('[data-map-plane]')!,frame=map.getBoundingClientRect();
  const overlays=Array.from(document.querySelectorAll('[data-maps-primary],[data-maps-sheet],[data-maps-navigation-controls],[data-maps-credits]')).map(el=>el.getBoundingClientRect());
  return Array.from(map.querySelectorAll('.maplibregl-marker:not([data-map-pin]):not([data-map-position])')).map(el=>{
   const r=el.getBoundingClientRect();
   return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,clear:r.left>=frame.left&&r.right<=frame.right&&r.top>=frame.top&&r.bottom<=frame.bottom&&!overlays.some(o=>o.width>0&&o.height>0&&r.left<o.right&&r.right>o.left&&r.top<o.bottom&&r.bottom>o.top)};
  });
 });
 await expect.poll(async()=>(await marker()).map(pin=>pin.clear)).toEqual([true]);
 await info.attach('selected-marker',{body:JSON.stringify(await marker()),contentType:'application/json'});
 await info.attach('route-endpoints',{body:JSON.stringify(await projection()),contentType:'application/json'});
 await page.screenshot({path:info.outputPath('route-clearance.png')});
});
