import {test,expect} from '@playwright/test';
import {openCanonicalMaps} from './helpers/canonical-maps';
import {auditPage,format} from './accessibility-audit';

for(const theme of ['light','dark'])for(const state of ['base','route','navigation'])test(`shared Maps text remains readable ${theme} ${state}`,async({page},info)=>{
 await openCanonicalMaps(page,state,theme);
 const problems=format(await auditPage(page,{contrast:true}));
 expect(problems,problems.join('\n')).toEqual([]);
 await page.screenshot({path:info.outputPath('map-text.png'),animations:'disabled'});
});
