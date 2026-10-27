import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {build} from 'esbuild';
// Home's agenda and brief cards are the shared upstream cards (packages/ui/src/overview), rendered by
// apps/app/src/prototype/home-overview-cards.ts from the values the Home adapters computed. These
// render them to markup and check that Alpha's installed selectors, classes and states are kept.
// Source-level evidence only: no browser, device calendar or digest is involved.
const root=resolve(import.meta.dirname,'..');
const run=script=>JSON.parse(execFileSync(process.execPath,['--import=tsx','--input-type=module','-e',script],{cwd:root,encoding:'utf8',timeout:120000}));
// One bundle with the app's JSX settings (automatic runtime, as Vite builds it) and a single React.
const bundled=await build({stdin:{contents:`export {renderToStaticMarkup} from 'react-dom/server';
export * as c from ${JSON.stringify(resolve(root,'apps/app/src/prototype/home-overview-cards.ts'))};
export * as h from ${JSON.stringify(resolve(root,'apps/app/src/prototype/home-cards.ts'))};`,resolveDir:root,loader:'js'},
  bundle:true,format:'esm',platform:'node',jsx:'automatic',write:false,logLevel:'silent',
  banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"}});
const directory=mkdtempSync(resolve(tmpdir(),'home-overview-cards-'));
writeFileSync(resolve(directory,'cards.mjs'),bundled.outputFiles[0].text);
const {renderToStaticMarkup,c,h}=await import(resolve(directory,'cards.mjs'));
rmSync(directory,{recursive:true,force:true});
const html=element=>element?renderToStaticMarkup(element):null;
test('agenda card keeps the installed selectors for an event, an overdue reminder with its next item, and an empty state', () => {
  const out={};
  const base={homeCalendarTime:'Wed, Oct 7',homeCalendarOrigin:'Work',homeCalendarTitle:'Design review',homeCalendarFooter:'4:00 PM – 5:00 PM',homeCalendarHasEvent:true,homeCalendarHasMeta:true,homeCalendarSource:'',homeCalendarOverdue:false,homeCalendarHasNext:false,homeCalendarLabel:'Open calendar event: Design review',homeCalendarDescription:'Work. Read 3:04 PM from calendars on this device',homeCalendarVideo:true,ic:{video:'M1 1'},goCalendar:()=>{}};
  out.event=html(c.homeAgendaCard(base));
  out.overdue=html(c.homeAgendaCard({...base,homeCalendarTime:'Overdue reminder',homeCalendarOrigin:'',homeCalendarTitle:'Pay rent',homeCalendarFooter:'Due 9:00 AM',homeCalendarOverdue:true,homeCalendarVideo:false,homeCalendarHasNext:true,homeCalendarNext:'Next: Design review 4:00 PM',homeCalendarNextSource:'Work'}));
  out.empty=html(c.homeAgendaCard({...base,homeCalendarTitle:'No upcoming events',homeCalendarFooter:'',homeCalendarHasEvent:false,homeCalendarHasMeta:false,homeCalendarVideo:false,homeCalendarLabel:'Open your calendar',homeCalendarDescription:''}));
  out.error=html(c.homeAgendaCard({...base,homeCalendarTitle:'Calendar unavailable',homeCalendarHasEvent:false,homeCalendarHasMeta:true,homeCalendarSource:'Open Calendar to retry',homeCalendarVideo:false}));
  assert.match(out.event,/^<button type="button" data-overview-part="card" class="home-calendar-card" data-overview-card="agenda"/);
  for(const attribute of ['data-alpha-home-calendar=""','data-alpha-home-calendar-event="true"','data-alpha-home-calendar-meta="true"','data-alpha-home-calendar-overdue="false"','data-alpha-home-calendar-next="false"','aria-label="Open calendar event: Design review"','aria-description="Work. Read 3:04 PM from calendars on this device"'])assert.ok(out.event.includes(attribute),attribute);
  assert.match(out.event,/class="home-calendar-time">Wed, Oct 7<\/span><span data-overview-part="origin" class="home-calendar-origin" data-alpha-home-calendar-origin="">Work</);
  assert.match(out.event,/class="serif home-calendar-title">Design review</);
  assert.match(out.event,/class="home-calendar-footer">4:00 PM – 5:00 PM</);
  assert.match(out.event,/<svg width="16" height="16" viewBox="0 0 24 24"><path d="M1 1"><\/path><\/svg>/);
  assert.match(out.event,/style="flex-shrink:0;scroll-snap-align:start;border-radius:30px;background:var\(--acc\);color:#ffffff;padding:22px;box-sizing:border-box"/);
  assert.ok(out.overdue.includes('data-alpha-home-calendar-overdue="true"')&&out.overdue.includes('data-alpha-home-calendar-next="true"'));
  assert.match(out.overdue,/class="home-calendar-meta home-calendar-next" data-alpha-home-calendar-next-line=""><span data-overview-part="nextText" class="home-calendar-next-text">Next: Design review 4:00 PM<\/span><span data-overview-part="nextSource" class="home-calendar-source" data-alpha-home-calendar-next-source="">Work</);
  assert.doesNotMatch(out.overdue,/<svg/,'no video icon without a meeting link');
  assert.ok(out.empty.includes('data-alpha-home-calendar-event="false"')&&out.empty.includes('data-alpha-home-calendar-meta="false"'));
  assert.doesNotMatch(out.empty,/class="home-calendar-meta|class="home-calendar-footer|aria-description/);
  assert.match(out.error,/class="home-calendar-source" data-alpha-home-calendar-source="">Open Calendar to retry</);
  assert.doesNotMatch(out.error,/class="home-calendar-footer/);
});

test('a calendar read from an earlier day is presented as stale on the agenda card', () => {
  h.setLocalePreferences?.({locale:'en-US'});
  const now=new Date(2026,9,7,15,30).getTime(),readAt=new Date(2026,9,6,21,5).getTime(),out={};
  out.stale=h.homeReadIsStale(readAt,now);out.fresh=h.homeReadIsStale(new Date(2026,9,7,9).getTime(),now);
  out.provenance=h.presentHomeCalendarSource({state:'stale',overdue:false,readAt,now,native:true,calendar:'Work'});
  out.card=html(c.homeAgendaCard({homeCalendarTime:'Wed, Oct 7',homeCalendarOrigin:'',homeCalendarTitle:'Standup',homeCalendarFooter:'4:00 PM',homeCalendarHasEvent:true,homeCalendarHasMeta:true,homeCalendarSource:out.provenance.read,homeCalendarStale:true,homeCalendarDescription:out.provenance.description,homeCalendarLabel:'Open calendar event: Standup'}));
  assert.equal(out.stale,true);assert.equal(out.fresh,false);
  assert.equal(out.provenance.read.startsWith('Not updated since '),true);
  assert.match(out.provenance.description,/today's changes may be missing\. Open Calendar to refresh\.$/);
  assert.ok(out.card.includes('data-alpha-home-calendar-stale="true"')&&out.card.includes('data-overview-state="stale"'));
  assert.match(out.card,/data-alpha-home-calendar-source="">Not updated since /);
});

test('brief card renders only a retained brief, with its failure state and installed selectors', () => {
  const out={};
  out.none=html(c.homeBriefCard({homeBriefHas:false,homeBriefTitle:'x'}));
  out.ran=html(c.homeBriefCard({homeBriefHas:true,homeBriefTitle:'Two meetings today.',homeBriefStatus:'Alpha · Ran 7:02 AM',homeBriefFailed:false,homeBriefLabel:'Open scheduled digests. Latest brief from Alpha, ran 7:02 AM: Two meetings today.',goBrief:()=>{}}));
  out.failed=html(c.homeBriefCard({homeBriefHas:true,homeBriefTitle:'Source expired',homeBriefStatus:'Alpha · Failed 7:00 AM',homeBriefFailed:true,homeBriefLabel:'Open scheduled digests.'}));
  assert.equal(out.none,null);
  assert.match(out.ran,/^<button type="button" data-overview-part="card" class="home-brief-card" data-overview-card="brief"/);
  for(const attribute of ['data-alpha-home-brief=""','data-alpha-home-brief-failed="false"','aria-haspopup="dialog"','aria-label="Open scheduled digests. Latest brief from Alpha, ran 7:02 AM: Two meetings today."'])assert.ok(out.ran.includes(attribute),attribute);
  assert.match(out.ran,/class="home-brief-head"><span data-overview-part="heading">Latest brief<\/span>/);
  assert.match(out.ran,/class="home-brief-title">Two meetings today\.<\/span><span data-overview-part="status" class="home-brief-status">Alpha · Ran 7:02 AM</);
  assert.ok(out.failed.includes('data-alpha-home-brief-failed="true"'));
});

test('the retained brief is fenced to the bound connection scope', () => {
  const out=run(`
const d=await import(${JSON.stringify(resolve(root,'apps/app/src/runtime/hosted-digests.ts'))});
const row=(runId,status,output,completedAt)=>d.parseDigestResult({cursor:Number(runId.slice(-1)),runId,workflowId:'loop',workflowVersionId:'v1',templateVersion:'hosted-digest-1',scheduledAt:completedAt,source:{},status,startedAt:completedAt,completedAt,output,error:null});
const out={},morning=row('run-1','finished','Morning brief','2026-10-07T07:01:00.000Z'),missed=row('run-2','missed','The scheduled time was missed.','2026-10-08T07:03:00.000Z');
let events=0;globalThis.window={dispatchEvent:event=>{if(event.type==='alpha:retained-digest')events++;}};
d.bindRetainedDigestScope('owner-a');
out.accepted=d.rememberRetainedDigests([morning,missed],'Alpha','owner-a');out.brief=d.latestRetainedDigest();
out.otherScope=d.rememberRetainedDigests([row('run-3','finished','Other account','2026-10-08T08:00:00.000Z')],'Alpha','owner-b');out.unscoped=d.rememberRetainedDigests([],'Alpha');
out.kept=d.latestRetainedDigest()?.summary;
d.bindRetainedDigestScope(null);out.cleared=d.latestRetainedDigest();out.events=events;
console.log(JSON.stringify(out));`);
  assert.equal(out.accepted,true);
  assert.deepEqual(out.brief,{summary:'Morning brief',ranAt:'2026-10-07T07:01:00.000Z',agent:'Alpha',status:'finished'},'a missed record never replaces the last brief');
  assert.equal(out.otherScope,false);assert.equal(out.unscoped,false);
  assert.equal(out.kept,'Morning brief');
  assert.equal(out.cleared,null);
  assert.equal(out.events,2,'Home is told once when the brief appears and once when it is cleared');
});
