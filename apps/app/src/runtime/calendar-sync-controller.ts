import { canonicalSyncRecurrence } from "../browser/calendar-sync-fields.ts";
import {
	type CalendarSyncContext,
	CalendarSyncController as SharedCalendarSyncController,
	type CalendarSyncPreference,
} from "../../../../.eliza/client-features/plugins/plugin-calendar/src/linked-sync/sync-controller.ts";
import { ALPHA_CALENDAR_SYNC_NAMESPACE } from "./calendar-linked-store";

export type {
	CalendarSyncContext,
	CalendarSyncPreference,
	CalendarSyncReport,
	CalendarSyncReview,
} from "../../../../.eliza/client-features/plugins/plugin-calendar/src/linked-sync/sync-controller.ts";

/** One serialized sync pass (@elizaos/plugin-calendar/linked-sync) with Alpha's installed checkpoint keys. */
export class CalendarSyncController extends SharedCalendarSyncController {
	constructor(
		prepare: (signal: AbortSignal) => Promise<CalendarSyncContext>,
		preference: CalendarSyncPreference,
	) {
		super(prepare, preference, {
			idempotencyNamespace: ALPHA_CALENDAR_SYNC_NAMESPACE,
			canonicalRecurrence: canonicalSyncRecurrence,
		});
	}
}
