import { canonicalSyncRecurrence } from "../browser/calendar-sync-fields.ts";
import type {
	LinkedCalendarEventRecord,
	LinkedCalendarProviderPort,
	LinkedCalendarProviderSnapshot,
	LinkedCalendarSemanticEvent,
} from "../../../../.eliza/client-features/packages/contracts/src/calendar-linked-sync";
import type { CalendarSyncBinding } from "./calendar-linked-store";

export type {CalendarSyncSelection,CalendarSyncRequest} from '../../../../.eliza/client-features/plugins/plugin-calendar/src/service/managed-calendar-host.ts';
import type {CalendarSyncSelection,CalendarSyncRequest} from '../../../../.eliza/client-features/plugins/plugin-calendar/src/service/managed-calendar-host.ts';
const text = (value: unknown, max = 2048): value is string =>
	typeof value === "string" &&
	value.length > 0 &&
	value.length <= max &&
	!/[\u0000-\u001f\u007f]/.test(value);
const object = (value: unknown): Record<string, unknown> => {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw Error(
			"Calendar sync returned an invalid response. Nothing was applied.",
		);
	return value as Record<string, unknown>;
};
export function calendarSyncHttp(input: CalendarSyncRequest) {
	const selection = { ...input.selection };
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			selection.grantId,
		) ||
		!text(selection.calendarId, 1024) ||
		(input.kind !== "capabilities" &&
			!text((selection as CalendarSyncSelection).accountId))
	)
		throw Error("Review the selected Google account and calendar.");
	const path = "/api/v1/eliza/google/calendar/sync-v1/";
	if (input.kind === "capabilities")
		return {
			path: path + "capabilities?" + new URLSearchParams(selection),
			method: "GET" as const,
		};
	if (input.kind === "get") {
		const reference = { ...input.reference };
		if (
			Object.keys(reference).length !== 1 ||
			!("eventId" in reference || "idempotencyKey" in reference) ||
			!Object.values(reference).every((value) => text(value))
		)
			throw Error("An exact Calendar event reference is required.");
		return {
			path:
				path + "event?" + new URLSearchParams({ ...selection, ...reference }),
			method: "GET" as const,
		};
	}
	if (input.kind === "create") {
		if (!text(input.idempotencyKey))
			throw Error("A stable Calendar operation key is required.");
		return {
			path: path + "event",
			method: "POST" as const,
			body: {
				...selection,
				idempotencyKey: input.idempotencyKey,
				event: structuredClone(input.event),
			},
		};
	}
	if (
		!text(input.eventId, 1024) ||
		!text(input.expectedEtag, 1024) ||
		input.expectedEtag === "*"
	)
		throw Error("An exact Google event revision is required.");
	if (input.kind === "update")
		return {
			path: path + "event",
			method: "PATCH" as const,
			body: {
				...selection,
				eventId: input.eventId,
				expectedEtag: input.expectedEtag,
				event: structuredClone(input.event),
			},
		};
	if (input.kind === "delete")
		return {
			path:
				path +
				"event?" +
				new URLSearchParams({
					...selection,
					eventId: input.eventId,
					expectedEtag: input.expectedEtag,
				}),
			method: "DELETE" as const,
		};
	throw Error("Unsupported Calendar operation.");
}
export interface CalendarSyncClient {
	googleCalendarSync(
		input: CalendarSyncRequest,
		signal: AbortSignal,
	): Promise<unknown>;
}
function eventSnapshot(value: unknown): LinkedCalendarProviderSnapshot {
	const snapshot = object(value),
		event = object(snapshot.event);
	if (
		!text(snapshot.eventId, 1024) ||
		!text(snapshot.etag, 1024) ||
		!text(event.title, 4000) ||
		typeof event.description !== "string" ||
		typeof event.location !== "string" ||
		typeof event.isAllDay !== "boolean" ||
		!text(event.startAt, 64) ||
		!text(event.endAt, 64) ||
		!Array.isArray(event.attendees) ||
		!Number.isFinite(Date.parse(event.startAt)) ||
		Date.parse(event.endAt) <= Date.parse(event.startAt) ||
		!Number.isFinite(Date.parse(event.endAt))
	)
		throw Error(
			"Google returned an incomplete Calendar event. Nothing was applied.",
		);
	if (event.isAllDay) {
		if (
			!/^\d{4}-\d{2}-\d{2}$/.test(event.startAt) ||
			!/^\d{4}-\d{2}-\d{2}$/.test(event.endAt) ||
			event.timeZone !== null ||
			new Date(event.startAt).toISOString().slice(0, 10) !== event.startAt ||
			new Date(event.endAt).toISOString().slice(0, 10) !== event.endAt
		)
			throw Error("Google returned invalid all-day dates.");
	} else {
		if (
			!text(event.timeZone, 128) ||
			!/(Z|[+-]\d{2}:\d{2})$/.test(event.startAt) ||
			!/(Z|[+-]\d{2}:\d{2})$/.test(event.endAt)
		)
			throw Error("Google returned an event without its timezone.");
		new Intl.DateTimeFormat("en-US", { timeZone: event.timeZone }).format();
	}
	const attendees = event.attendees.map((value) => {
		const a = object(value);
		if (!text(a.email, 320) || typeof a.optional !== "boolean")
			throw Error("Google returned invalid attendees.");
		return { email: a.email, optional: a.optional };
	});
	if (
		event.recurrence !== undefined &&
		(!Array.isArray(event.recurrence) ||
			!event.recurrence.every((line) => text(line)))
	)
		throw Error("Google returned invalid recurrence.");
	if (event.deleted !== undefined && event.deleted !== false)
		throw Error("Google returned an invalid event state.");
	return {
		eventId: snapshot.eventId,
		etag: snapshot.etag,
		event: {
			title: event.title,
			description: event.description,
			location: event.location,
			startAt: event.startAt,
			endAt: event.endAt,
			timeZone: event.timeZone as string | null,
			isAllDay: event.isAllDay,
			attendees,
			...(event.recurrence
				? {
						recurrence: canonicalSyncRecurrence(
							event.recurrence as string[],
							event.isAllDay,
						),
					}
				: {}),
		},
	};
}
/** Only the explicitly enabled controller supplies this exact binding and current-owner fence. */
export async function googleCalendarSyncPort(
	client: CalendarSyncClient,
	binding: CalendarSyncBinding,
	current: () => boolean,
	signal: AbortSignal,
): Promise<LinkedCalendarProviderPort<string>> {
	binding = { ...binding };
	const selection = {
		grantId: binding.connectionId,
		calendarId: binding.calendarId,
		accountId: binding.providerAccountId,
	};
	const check = (row?: LinkedCalendarEventRecord<string>) => {
		signal.throwIfAborted();
		if (
			!current() ||
			(row &&
				(row.agentId !== binding.agentId ||
					row.connectorAccountId !== binding.connectionId ||
					row.providerCalendarId !== binding.calendarId))
		)
			throw new DOMException("Calendar sync owner changed", "AbortError");
	};
	const call = async (input: CalendarSyncRequest) => {
		check();
		let raw: unknown;
		try {
			raw = await client.googleCalendarSync(input, signal);
		} catch (error) {
			check();
			const failure = error as {
				status?: number;
				data?: Record<string, unknown>;
			};
			const data = failure?.data;
			if (
				[400, 403, 409, 412, 413, 429].includes(failure?.status || 0) &&
				data &&
				typeof data.code === "string" &&
				data.code.startsWith("CALENDAR_SYNC_") &&
				(data.outcome === "not_accepted" ||
					data.outcome === "precondition_failed")
			)
				throw Object.assign(
					Error(
						typeof data.error === "string"
							? data.error
							: "Calendar change was refused.",
					),
					{ code: data.code, outcome: data.outcome },
				);
			throw error;
		}
		const result = object(raw);
		check();
		if (
			result.version !== 1 ||
			result.calendarId !== binding.calendarId ||
			result.providerExactlyOnce !== false
		)
			throw Error(
				"Calendar sync protocol is unavailable. Nothing was applied.",
			);
		return result;
	};
	const ready = async () => {
		const caps = await call({
			kind: "capabilities",
			selection: {
				grantId: selection.grantId,
				calendarId: selection.calendarId,
			},
		});
		if (
			caps.accountId !== binding.providerAccountId ||
			caps.read !== true ||
			caps.write !== true ||
			caps.idempotentCreate !== true ||
			caps.conditionalWrites !== true
		)
			throw Error("Review Google Calendar sync access in Settings.");
	};
	const result = (data: Record<string, unknown>) => eventSnapshot(data.event);
	await ready();
	return {
		async get(row) {
			check(row);
			const data = await call({
				kind: "get",
				selection,
				reference: row.providerEventId
					? { eventId: row.providerEventId }
					: { idempotencyKey: row.idempotencyKey },
			});
			return data.event === null ? null : result(data);
		},
		async create(row, event) {
			check(row);
			check(row);
			const data = await call({
				kind: "create",
				selection,
				idempotencyKey: row.idempotencyKey,
				event,
			});
			const snapshot = object(data.event);
			if (
				snapshot.visibility !== "private" ||
				snapshot.remindersDisabled !== true
			)
				throw Error(
					"Google create privacy could not be confirmed. Check the event before retrying.",
				);
			return result(data);
		},
		async update(row, event) {
			check(row);
			if (!row.providerEventId || !row.providerEtag)
				throw Error("Refresh this Google event before updating.");
			check(row);
			return result(
				await call({
					kind: "update",
					selection,
					eventId: row.providerEventId,
					expectedEtag: row.providerEtag,
					event,
				}),
			);
		},
		async delete(row) {
			check(row);
			if (!row.providerEventId || !row.providerEtag)
				throw Error("Refresh this Google event before deleting.");
			check(row);
			const data = await call({
				kind: "delete",
				selection,
				eventId: row.providerEventId,
				expectedEtag: row.providerEtag,
			});
			if (data.deleted !== true)
				throw Error("Google deletion could not be confirmed.");
		},
	};
}
