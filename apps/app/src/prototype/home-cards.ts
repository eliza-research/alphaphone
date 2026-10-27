/**
 * Home daily overview presentation. The domain (states, freshness, agenda selection and copy) is
 * the shared upstream module `packages/ui/src/overview/daily-overview.ts`; this file only binds
 * Alpha's locale and hour-cycle preferences (`locale-time.ts`) and keeps the names Alpha's adapters
 * use. Nothing here reads a provider or runs a digest.
 */
import {
  overviewAgendaEmptyTitle,
  overviewAgendaHeader,
  overviewAttendeeInitials,
  overviewBriefOutcome,
  overviewCalendarName,
  overviewCalendarState,
  overviewOverdueDueLabel,
  overviewReadIsStale,
  overviewWhenLabel,
  presentOverviewAgendaFeed,
  presentOverviewAgendaNext,
  presentOverviewAgendaSource,
  presentOverviewAttention,
  presentOverviewBrief,
  presentOverviewBriefCard,
  presentOverviewCalendar,
  presentOverviewInboxStatus,
  presentOverviewWorkflowFreshness,
  selectOverviewAgenda,
  type OverviewAgendaPresentation,
  type OverviewAttentionSummary,
  type OverviewBriefSummary,
  type OverviewCalendarState,
  type OverviewFormat,
} from '../../../../.eliza/client-features/packages/ui/src/overview/daily-overview.ts';
import {formatTime, formatShortDate} from './locale-time.ts';

/** Alpha's locale preferences, read at each call so a changed preference applies at once. */
const format: OverviewFormat = {time: date => formatTime(date), shortDate: date => formatShortDate(date)};

/** What needs attention, from the mail provider adapter (inboxAttention()). */
export type HomeAttentionSummary = OverviewAttentionSummary;
/** Latest retained scheduled brief (latestRetainedDigest()). */
export type HomeBriefSummary = OverviewBriefSummary;
export type HomeCardAction = 'inbox' | 'connections' | 'calendar' | 'workflows';
export type CalendarCardState = OverviewCalendarState;
export type HomeAgenda = OverviewAgendaPresentation;
export {overviewReadIsStale as homeReadIsStale, selectOverviewAgenda as selectHomeAgenda};

/** "3:04 PM" today, otherwise "Wed, Oct 8 3:04 PM". */
export const whenLabel = (at: number, now: number) => overviewWhenLabel(at, now, format);
export const presentHomeAttention = (summary: HomeAttentionSummary | null | undefined, now: number) => presentOverviewAttention(summary, now, format);
/** How a retained digest result ended: a missed, overlapping or unavailable record is not a run. */
export const briefOutcome = overviewBriefOutcome;
export const presentHomeBrief = (brief: HomeBriefSummary | null | undefined, now: number) => presentOverviewBrief(brief, now, format);
/** The newest retained result for the current connection; shown only when one exists. */
export const presentHomeBriefCard = (brief: HomeBriefSummary | null | undefined, now: number) => presentOverviewBriefCard(brief, now, format);
export const presentHomeCalendarSource = (input: Parameters<typeof presentOverviewAgendaSource>[0]) => presentOverviewAgendaSource(input, format);
export const presentHomeNext = (input: Parameters<typeof presentOverviewAgendaNext>[0]) => presentOverviewAgendaNext(input, format);
/** The agenda card when its source is the agent's calendar feed (states, freshness and staleness). */
export const presentHomeAgendaFeed = (input: Parameters<typeof presentOverviewAgendaFeed>[0]) => presentOverviewAgendaFeed(input, format);
export const homeCalendarName = overviewCalendarName;
export const homeAgendaHeader = overviewAgendaHeader;
/** "Due 9:00 AM" today, otherwise "Due Mon, Oct 5 9:00 AM". */
export const overdueDueLabel = (at: number, now: number) => overviewOverdueDueLabel(at, now, format);
export const presentHomeWorkflowFreshness = (input: Parameters<typeof presentOverviewWorkflowFreshness>[0]) => presentOverviewWorkflowFreshness(input, format);
export const presentHomeInboxStatus = (input: Parameters<typeof presentOverviewInboxStatus>[0]) => presentOverviewInboxStatus(input, format);
export const calendarCardState = overviewCalendarState;
export const homeCalendarEmptyTitle = overviewAgendaEmptyTitle;
export const presentHomeCalendar = (input: Parameters<typeof presentOverviewCalendar>[0]) => presentOverviewCalendar(input, format);
export const attendeeInitials = overviewAttendeeInitials;
