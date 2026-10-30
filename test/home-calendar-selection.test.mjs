import test from "node:test";
import assert from "node:assert/strict";
import {loadBrowserModule} from './fixtures/browser-source.mjs';
const [{homeCalendarSelection:select},{calendarSourceKey:sourceKey}] = await loadBrowserModule(['apps/app/src/runtime/agent-calendar-view.ts','apps/app/src/runtime/agent-calendar.ts']);
const source = {
	provider: "eliza",
	side: "owner",
	grantId: "g",
	connectorAccountId: null,
	calendarId: "primary",
	includeInFeed: true,
	selected: true,
	accessRole: "owner",
};
const now = new Date("2026-10-29T22:00:00Z");
const event = (id, date) => ({
	...source,
	id,
	title: id,
	status: "confirmed",
	startAt: date + "T16:00:00Z",
	endAt: date + "T17:00:00Z",
});
const model = (events) => ({
	ownerKey: "owner",
	status: "ready",
	mutating: false,
	calendars: [source],
	feed: {
		state: "complete",
		timeMin: "2026-10-01T00:00:00Z",
		timeMax: "2026-12-01T00:00:00Z",
		events,
	},
});
test("past today leads even though the next-event endpoint is empty", () => {
	const s = model([event("week", "2026-10-30"), event("today", "2026-10-29")]);
	s.next = { event: null };
	assert.equal(select(s, "UTC", new Set(), now).event.id, "today");
});
test("week then month fallback chooses chronological visible events", () => {
	assert.equal(
		select(
			model([event("month", "2026-10-31"), event("week", "2026-10-30")]),
			"UTC",
			new Set(),
			now,
		).event.id,
		"week",
	);
	const mid = new Date("2026-10-05T22:00:00Z");
	assert.equal(
		select(model([event("month", "2026-10-20")]), "UTC", new Set(), mid).event
			.id,
		"month",
	);
});
test("bootstrap, partial, mutation and failures stay neutral and never claim empty", () => {
	for (const status of [
		"disconnected",
		"loading",
		"partial",
		"error",
		"unavailable",
	]) {
		const s = { ...model([]), status };
		assert.deepEqual({...select(s, "UTC", new Set(), now)}, {
			event: null,
			verified: false,
			emptyLabel: "Calendar",
		});
	}
	assert.equal(
		select({ ...model([]), mutating: true }, "UTC", new Set(), now).verified,
		false,
	);
});
test("only a complete covering feed produces a verified empty result", () => {
	assert.equal(
		select(model([]), "UTC", new Set(), now).emptyLabel,
		"Nothing planned",
	);
	const s = model([]);
	s.feed.timeMax = "2026-10-30T00:00:00Z";
	assert.equal(select(s, "UTC", new Set(), now).verified, false);
});
test("hidden, missing and withdrawn sources cannot supply a Home event", () => {
	const s = model([event("today", "2026-10-29")]);
	assert.equal(select(s, "UTC", new Set([sourceKey(source)]), now).event, null);
	s.calendars = [];
	assert.equal(select(s, "UTC", new Set(), now).event, null);
	s.calendars = [{ ...source, includeInFeed: false }];
	assert.equal(select(s, "UTC", new Set(), now).event, null);
});
test("background arrival updates the same controller snapshot; retired owner clears it", () => {
	const s = { ...model([]), status: "loading" };
	assert.equal(select(s, "UTC", new Set(), now).verified, false);
	Object.assign(s, model([event("arrived", "2026-10-29")]));
	assert.equal(select(s, "UTC", new Set(), now).event.id, "arrived");
	s.ownerKey = null;
	assert.equal(select(s, "UTC", new Set(), now).event, null);
});
test("all-day dates use civil dates and a week may cross the month boundary", () => {
	const s = model([
		{
			...event("all day", "2026-10-29"),
			isAllDay: true,
			endAt: "2026-10-30T00:00:00Z",
		},
	]);
	assert.equal(
		select(s, "America/Los_Angeles", new Set(), now).event.id,
		"all day",
	);
	assert.equal(
		select(
			model([event("Sunday", "2026-11-01")]),
			"UTC",
			new Set(),
			new Date("2026-10-31T23:00:00Z"),
		).event.id,
		"Sunday",
	);
});

test("a complete afternoon-only feed cannot prove an empty month or empty today", () => {
	const s = model([]);
	for (const begin of ["2026-10-29T14:00:00Z", "2026-10-01T00:01:00Z"]) {
		s.feed.timeMin = begin;
		assert.equal(select(s, "UTC", new Set(), now).verified, false);
	}
});
test("an event ending exactly at today midnight ranks in the week, not today", () => {
	const e = {
		...event("yesterday", "2026-10-28"),
		endAt: "2026-10-29T00:00:00Z",
	};
	const next = event("tomorrow", "2026-10-30");
	assert.equal(select(model([e,next]), "UTC", new Set(), now).event.id, "tomorrow");
	e.endAt = "2026-10-29T00:01:00Z";
	assert.equal(select(model([e,next]), "UTC", new Set(), now).event.id, "yesterday");
});

test("shared Home policy covers past periods and requires a full query before any result", () => {
  assert.equal(select(model([event("past week", "2026-10-28")]), "UTC", new Set(), now).event.id, "past week");
  assert.equal(select(model([event("past month", "2026-10-05")]), "UTC", new Set(), now).event.id, "past month");
  const today=event("today", "2026-10-29"),upcoming={...today,id:"upcoming",startAt:"2026-10-29T23:00:00Z",endAt:"2026-10-30T00:00:00Z"};
  assert.equal(select(model([today,upcoming]), "UTC", new Set(), now).event.id,"upcoming");
  const narrow=model([today]);narrow.feed.timeMin="2026-10-29T00:00:00Z";
  assert.equal(select(narrow,"UTC",new Set(),now).verified,false);
  assert.equal(select(model([]),"UTC",new Set(),new Date("2026-10-02T12:00:00Z")).verified,false);
});
