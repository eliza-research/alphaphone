import {
	LinkedCalendarReconciler,
	type LinkedCalendarLocalPort,
} from "../../../../.eliza/client-features/packages/contracts/src/calendar-linked-sync";
import {
	CalendarLinkedStore,
	type CalendarSyncBinding,
	type CalendarLinkStorage,
} from "./calendar-linked-store";
import {
	googleCalendarSyncPort,
	type CalendarSyncClient,
} from "./calendar-linked-provider";
export type CalendarSyncContext = {
	reviewIdentity: string;
	binding: CalendarSyncBinding;
	client: CalendarSyncClient;
	local: LinkedCalendarLocalPort<string>;
	storage: CalendarLinkStorage;
	current: () => boolean;
	localDeletionUndone?: (eventId:string)=>boolean;
	events: () => Promise<Array<{ id: string; revision: string }>>;
};
export type CalendarSyncPreference = {
	read(scope: string): Promise<boolean>;
	write(scope: string, enabled: boolean): Promise<void>;
};
export type CalendarSyncReview = {
	reviewIdentity: string;
	scope: string;
	binding: CalendarSyncBinding;
	events: ReadonlyArray<{ id: string; revision: string }>;
};
export type CalendarSyncReport = {
	clean: number;
	pushed: number;
	pulled: number;
	conflicted: number;
	quarantined: number;
	paused: number;
	dirty: number;
};
/** One serialized sync pass. Each provider request checks the saved opt-in and exact current context. */
export class CalendarSyncController {
	private operation: AbortController | null = null;
	constructor(
		private prepare: (signal: AbortSignal) => Promise<CalendarSyncContext>,
		private preference: CalendarSyncPreference,
	) {}
	cancel() {
		this.operation?.abort();
	}
	private async context(signal: AbortSignal) {
		const context = await this.prepare(signal);
		const check = () => {
			signal.throwIfAborted();
			if (!context.current())
				throw new DOMException("Calendar sync context changed", "AbortError");
		};
		check();
		const store = await CalendarLinkedStore.open(
			context.binding,
			() => {
				check();
				return true;
			},
			context.storage,
		);
		check();
		return { context, check, store };
	}
	async review(): Promise<CalendarSyncReview> {
		return this.work(async (signal) => {
			const { context, check, store } = await this.context(signal);
			await googleCalendarSyncPort(
				context.client,
				context.binding,
				context.current,
				signal,
			);
			check();
			const events = await context.events();
			if (events.length > 2000)
				throw Error(
					"Calendar sync supports up to 2,000 linked local events. Nothing changed.",
				);
			for (const event of events) {
				const snapshot = await context.local.get(event.id);
				check();
				if (!snapshot || snapshot.revision !== event.revision)
					throw Error("Your local calendar changed. Review sync again.");
			}
			return {
				reviewIdentity: context.reviewIdentity,
				scope: store.scope,
				binding: { ...context.binding },
				events: events.map((event) => ({ ...event })),
			};
		});
	}
	async enabled(): Promise<boolean> {
		return this.work(async (signal) => {
			const { store } = await this.context(signal);
			return this.preference.read(store.scope);
		});
	}
	async enable(review: CalendarSyncReview) {
		return this.work(async (signal) => {
			const { context, check, store } = await this.context(signal);
			if (
				context.reviewIdentity !== review.reviewIdentity ||
				store.scope !== review.scope ||
				JSON.stringify(context.binding) !== JSON.stringify(review.binding)
			)
				throw Error(
					"The selected account or calendar changed. Review sync again.",
				);
			const events = await context.events();
			check();
			if (JSON.stringify(events) !== JSON.stringify(review.events))
				throw Error("The event list changed. Review sync again.");
			for (const event of events) {
				const snapshot = await context.local.get(event.id);
				check();
				if (!snapshot || snapshot.revision !== event.revision)
					throw Error("An event changed. Review sync again.");
			}
			await googleCalendarSyncPort(
				context.client,
				context.binding,
				context.current,
				signal,
			);
			check();
			await this.preference.write(store.scope, true);
			check();
		});
	}
	async pause() {
		this.cancel();
		const controller = new AbortController(),
			{ store } = await this.context(controller.signal);
		await this.preference.write(store.scope, false);
	}
	async sync(): Promise<CalendarSyncReport> {
		return this.work(async (signal) => {
			const { context, check, store } = await this.context(signal);
			const opted = async () => {
				check();
				if (!(await this.preference.read(store.scope)))
					throw new DOMException("Calendar sync is paused", "AbortError");
				check();
			};
			await opted();
			const client: CalendarSyncClient = {
				googleCalendarSync: async (input, requestSignal) => {
					await opted();
					const result = await context.client.googleCalendarSync(
						input,
						requestSignal,
					);
					await opted();
					return result;
				},
			};
			const provider = await googleCalendarSyncPort(
					client,
					context.binding,
					context.current,
					signal,
				),
				engine = new LinkedCalendarReconciler(store, context.local, provider);
			const events = await context.events();
			await opted();
			if (events.length > 2000)
				throw Error(
					"Calendar sync link limit reached. No new events were linked.",
				);
			// Preflight every new local event before the first write; unsupported metadata is never flattened.
			for (const event of events) {
				const snapshot = await context.local.get(event.id);
				await opted();
				if (!snapshot || snapshot.revision !== event.revision)
					throw Error(
						"A local event changed before sync. Retry to review its current state.",
					);
			}
			for (const event of events) {
				await opted();
				await store.link(event.id, event.revision);
			}
			const report: CalendarSyncReport = {
				clean: 0,
				pushed: 0,
				pulled: 0,
				conflicted: 0,
				quarantined: 0,
				paused: 0,
				dirty: 0,
			};
			for (let row of await store.list()) {
				await opted();
				if (row.state === "quarantined") {
					if (await engine.recoverDispatch(row)) {
						report.clean++;
						continue;
					}
					report.quarantined++;
					continue;
				}
				if (
					!events.some((event) => event.id === row.localEventId) &&
					row.providerEventId &&
					row.state !== "paused" &&
					row.state !== "conflicted"
				)
					row = await store.save(row, {
						state: "dirty",
						pendingOperation: "delete",
					});
				let outcome = await engine.reconcile(row);
				if(outcome==='quarantined'&&context.localDeletionUndone?.(row.localEventId)){
					await opted();const latest=(await store.list()).find(item=>item.id===row.id);
					if(latest?.state==='quarantined'&&latest.lastErrorCode==='LINKED_CALENDAR_LOCAL_DELETE_CAS_REJECTED'){
						await store.save(latest,{state:'paused',pendingOperation:null,lastErrorCode:'LINKED_CALENDAR_LOCAL_DELETE_UNDONE',lastErrorMessage:'Deletion undone. The local event is kept and its Google link is paused.'});outcome='paused';
					}
				}
				report[outcome]++;
				await opted();
			}
			return report;
		});
	}
	private async work<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
		if (this.operation) throw Error("Calendar sync is already running.");
		const controller = (this.operation = new AbortController());
		try {
			return await task(controller.signal);
		} finally {
			if (this.operation === controller) this.operation = null;
		}
	}
}
