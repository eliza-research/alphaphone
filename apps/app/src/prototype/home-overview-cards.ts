import {createElement, type ReactElement} from 'react';
import {OverviewAgendaCard, OverviewBriefCard} from '../../../../.eliza/client-features/packages/ui/src/overview/OverviewCards.tsx';
type Bag = Record<string, any>;

const flag = (value: unknown) => (value === true ? 'true' : 'false');
const maskIcon = (name: string, color: string) => createElement('span', {style: {display: 'block', flexShrink: 0, width: 24, height: 24, background: color,
  mask: `url('/icons/lucide/${name}.svg') center/contain no-repeat`, WebkitMask: `url('/icons/lucide/${name}.svg') center/contain no-repeat`}});

/** The Home agenda card: the shared upstream card with Alpha's classes and installed selectors. */
export function homeAgendaCard(out: Bag): ReactElement {
  const next = out.homeCalendarHasNext ? {text: String(out.homeCalendarNext || ''), source: String(out.homeCalendarNextSource || '')} : null;
  return createElement(OverviewAgendaCard, {
    heading: String(out.homeCalendarTime ?? ''), origin: String(out.homeCalendarOrigin ?? ''), title: String(out.homeCalendarTitle ?? ''),
    footer: String(out.homeCalendarFooter ?? ''), hasItem: out.homeCalendarHasEvent === true,
    // The read line appears only when the data adapter put one in the meta row.
    source: out.homeCalendarHasMeta === false ? '' : String(out.homeCalendarSource ?? ''),
    next, overdue: out.homeCalendarOverdue === true, stale: out.homeCalendarStale === true,
    label: String(out.homeCalendarLabel ?? 'Open your calendar'), description: String(out.homeCalendarDescription ?? ''),
    onActivate: typeof out.goCalendar === 'function' ? out.goCalendar : undefined,
    icon: maskIcon('calendar', '#ffffff'),
    videoIcon: out.homeCalendarVideo ? createElement('svg', {width: 16, height: 16, viewBox: '0 0 24 24'}, createElement('path', {d: out.ic?.video || ''})) : undefined,
    classNames: {card: 'home-calendar-card', head: 'home-calendar-head', heading: 'home-calendar-time', origin: 'home-calendar-origin', title: 'serif home-calendar-title',
      meta: 'home-calendar-meta', footer: 'home-calendar-footer', source: 'home-calendar-source', next: 'home-calendar-meta home-calendar-next',
      nextText: 'home-calendar-next-text', nextSource: 'home-calendar-source'},
    dataAttributes: {'data-alpha-home-calendar': '', 'data-alpha-home-calendar-event': flag(out.homeCalendarHasEvent),
      'data-alpha-home-calendar-meta': flag(out.homeCalendarHasMeta),
      'data-alpha-home-calendar-overdue': flag(out.homeCalendarOverdue), 'data-alpha-home-calendar-next': flag(!!next?.text),
      'data-alpha-home-calendar-stale': flag(out.homeCalendarStale)},
    partAttributes: {origin: {'data-alpha-home-calendar-origin': ''}, source: {'data-alpha-home-calendar-source': ''},
      next: {'data-alpha-home-calendar-next-line': ''}, nextSource: {'data-alpha-home-calendar-next-source': ''}},
    style: {flexShrink: 0, scrollSnapAlign: 'start', borderRadius: 30, background: 'var(--acc)', color: '#ffffff', padding: 22, boxSizing: 'border-box'},
  });
}

/** The Home brief card, present only while a retained brief exists for this connection. */
export function homeBriefCard(out: Bag): ReactElement | null {
  if (out.homeBriefHas !== true) return null;
  return createElement(OverviewBriefCard, {
    title: String(out.homeBriefTitle ?? ''), status: String(out.homeBriefStatus ?? ''), failed: out.homeBriefFailed === true,
    label: String(out.homeBriefLabel ?? ''), onActivate: typeof out.goBrief === 'function' ? out.goBrief : undefined,
    icon: maskIcon('sparkles', 'var(--acct)'),
    classNames: {card: 'home-brief-card', head: 'home-brief-head', title: 'home-brief-title', status: 'home-brief-status'},
    dataAttributes: {'data-alpha-home-brief': '', 'data-alpha-home-brief-failed': flag(out.homeBriefFailed)},
  });
}

/**
 * Renders Home's agenda and brief cards with the shared upstream components from the values the
 * Home adapters computed. Install outermost among Home adapters (after the calendar, agent calendar
 * and digest bindings) so the cards show their final values. It reads and runs nothing.
 */
export function installHomeOverviewCards(Component: any) {
  const p = Component.prototype, render = p.renderVals;
  p.renderVals = function () {
    const out = render.call(this);
    return {...out, homeAgendaCard: homeAgendaCard(out), homeBriefCard: homeBriefCard(out)};
  };
}
