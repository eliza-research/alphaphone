import {getZonedDateParts} from '../../../../.eliza/client-features/plugins/plugin-calendar/src/internal/time';
import {calendarEventKey,calendarSourceKey,type AgentCalendarState} from './agent-calendar';
/** Uses only the controller's current complete feed, never its future-only next-event query. */
export function homeCalendarSelection(state:AgentCalendarState|undefined, timeZone:string, hiddenSources:ReadonlySet<string>, now=new Date()) {
 const quiet={event:null,verified:false,emptyLabel:'Calendar'};
 if(!state?.ownerKey||state.status!=='ready'||state.mutating||state.feed?.state!=='complete')return quiet;
 const p=getZonedDateParts(now,timeZone),today=Date.UTC(p.year,p.month-1,p.day),monthEnd=Date.UTC(p.year,p.month,1),weekEnd=today+(7-((new Date(today).getUTCDay()+6)%7))*86400000;
 const day=(value:string,allDay=false)=>{const date=new Date(value);if(!Number.isFinite(date.getTime()))return NaN;const x=getZonedDateParts(date,allDay?'UTC':timeZone);return Date.UTC(x.year,x.month-1,x.day);};
 const visible=state.feed.events.filter(event=>event.status!=='cancelled'&&state.calendars.some(source=>source.includeInFeed===true&&['owner','writer','reader'].includes(source.accessRole)&&source.provider===event.provider&&source.side===event.side&&source.grantId===event.grantId&&source.calendarId===event.calendarId&&(!event.connectorAccountId||source.connectorAccountId===event.connectorAccountId)&&!hiddenSources.has(calendarSourceKey(source))));
 const candidates=visible.filter(event=>{const start=day(event.startAt,!!event.isAllDay),end=day(event.endAt,!!event.isAllDay);return start>=today&&start<Math.max(monthEnd,weekEnd)||start<today&&(event.isAllDay?end>today:end>=today);});
 candidates.sort((a,b)=>{const rank=(e:typeof a)=>{const x=day(e.startAt,!!e.isAllDay);return x<=today?0:x<weekEnd?1:2;};return rank(a)-rank(b)||Date.parse(a.startAt)-Date.parse(b.startAt)||calendarEventKey(a).localeCompare(calendarEventKey(b));});
 if(candidates.length)return {event:candidates[0],verified:true,emptyLabel:''};
 // An empty answer is valid only when the complete queried feed covers this local month.
 const begin=Date.parse(state.feed.timeMin),end=Date.parse(state.feed.timeMax);
 return Number.isFinite(begin)&&Number.isFinite(end)&&begin<=now.getTime()&&day(state.feed.timeMin)<=today&&day(state.feed.timeMax)>=Math.max(monthEnd,weekEnd)?{event:null,verified:true,emptyLabel:'No events this month'}:quiet;
}
