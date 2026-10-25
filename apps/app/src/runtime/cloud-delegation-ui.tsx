import { useEffect, useRef, useState } from "react";
import { registerPlugin } from '../platform-plugins';
import { type PluginListenerHandle } from '@capacitor/core';
import {
	secureConnectionStore,
	nativeCloudRequest,
	nativeAlphaAuthenticate,
	clearAlphaAuthenticationPurpose,
	alphaAuthHost,
} from "./native-connection";
import { readAlphaDelegationReturn } from './alpha-auth-return';
import { reviewAlphaDelegation, approveAlphaDelegation, type DelegationReview, type ReadKind } from './alpha-delegation';
import type { HostedDigestProtocol } from "./hosted-digests";
export const delegationNative = registerPlugin<{
	addListener(
		event: "cloudDelegationCallback",
		callback: () => void,
	): Promise<PluginListenerHandle>;
	readDelegationCallback(): Promise<{
		callback: { state: string; code?: string; error?: string } | null;
	}>;
	clearDelegationCallback(input: { state: string }): Promise<void>;
}>("AlphaConnection");
type Pending = {
	state: string;
	authUrl: string;
	expiresAt: string;
	phase: "waiting" | "finishing";
	code?: string;
	review?: DelegationReview;
	kinds?: ReadKind[];
	approved?: boolean;
};
export function CloudDelegationPanel({
	client,
	scope,
	signal,
	current,
	onConnected,
}: {
	client: HostedDigestProtocol;
	scope: string;
	signal: AbortSignal;
	current: () => boolean;
	onConnected: () => void;
}) {
	const [expanded, setExpanded] = useState(false);
    const [revocations,setRevocations]=useState<Array<{grantId:string;expiresAt:string}>>([]);
    async function refreshRevocations(){ const result=await client.delegation("revocations",{},signal); if(valid()&&Array.isArray(result.grants)){setRevocations(result.grants.filter((g: any)=>typeof g.grantId==="string"&&typeof g.expiresAt==="string"));if(result.grants.length)setExpanded(true);} }
	const [pending, setPending] = useState<Pending | null>(null),
		[busy, setBusy] = useState(false),
		[message, setMessage] = useState(
			"Allow this agent to read selected Google data when this agent is running. Access expires within seven days.",
		);
	const [email, setEmail] = useState(true),
		[calendar, setCalendar] = useState(false),
		[grantId, setGrantId] = useState("");
	const locked = useRef(false),
		slot = "cloud-delegation:v1:" + scope;
	const mounted = useRef(true), interactive = useRef<AbortController | null>(null);
	const valid = () => mounted.current && current() && !signal.aborted;
	async function clear(expected: Pending) {
		const result = await secureConnectionStore.compareExchange(
			slot,
			expected,
			null,
		);
		if (result.status !== "saved")
			throw Error("The connection changed. Reopen this screen.");
		await clearAlphaAuthenticationPurpose(`delegation:${scope}:${expected.state}`);
		if (valid()) setPending(null);
	}
	async function run(work: () => Promise<void>) {
		if (locked.current || !valid()) return;
		locked.current = true;
		setBusy(true);
		try {
			await work();
		} catch {
			if (valid())
				setMessage(
					"The connection is not confirmed. Check its status before starting another grant.",
				);
		} finally {
			locked.current = false;
			if (valid()) setBusy(false);
		}
	}
	async function recover(record: Pending, allowCompletion = true) {
		const status = await client.delegation(
			"status",
			{ state: record.state },
			signal,
		);
		if (!valid()) return;
		if (status.status === "complete" && typeof status.grantId === "string") {
			await clear(record);
			if (!valid()) return;
			setGrantId(status.grantId);
			setMessage(
				"Cloud read access is connected. Choose the Google account and source below.",
			);
			onConnected();
			return;
		}
		if (status.status === "failed") {
			await clear(record);
			if (!valid()) return;
			setMessage(
				"This authorization expired or was cancelled. Start a new review.",
			);
			return;
		}
		if (status.status === "waiting" && record.code && allowCompletion) {
			await client.delegation(
				"complete",
				{ state: record.state, code: record.code },
				signal,
			);
			if (valid()) await recover(record, false);
			return;
		}
		setMessage(
			status.status === "finishing"
				? "Cloud is finishing authorization. Check again shortly."
				: record.code
					? "Authorization completion is not confirmed. Check status again; it will not be retried automatically."
						: "Review the permissions below to continue in Alpha Phone.",
		);
	}
	async function callback() {
		await run(async () => {
			const response = await delegationNative.readDelegationCallback();
			if (!valid() || !response.callback) return;
			setExpanded(true);
			const record = await secureConnectionStore.read<Pending>(slot),
				value = response.callback;
			if (!record || record.state !== value.state) {
				setMessage(
					"This return link belongs to another account or an older connection. Select the account that started it.",
				);
				return;
			}
			if (value.error) {
				await client.delegation(
					"cancel",
					{ state: record.state, confirmed: true },
					signal,
				);
				await clear(record);
				await delegationNative.clearDelegationCallback({ state: record.state });
				setMessage("Authorization cancelled.");
				return;
			}
			if (!value.code || Date.parse(record.expiresAt) <= Date.now()) {
				setMessage(
					"Authorization expired. Check status, then start a new review.",
				);
				return;
			}
			const next: Pending = { ...record, phase: "finishing", code: value.code };
			const saved = await secureConnectionStore.compareExchange(
				slot,
				record,
				next,
			);
			if (saved.status !== "saved") throw Error("Authorization changed");
			setPending(next);
			await delegationNative.clearDelegationCallback({ state: record.state });
			await recover(next);
		});
	}
	useEffect(() => {
		let disposed = false;
		mounted.current = true;
        void refreshRevocations().catch(()=>{});
		void secureConnectionStore
			.read<Pending>(slot)
			.then(async (record) => {
				if (!disposed && valid()) {
					setPending(record);
					if (record) setExpanded(true);
					await callback();
					if (!disposed && valid()) await resumeApproval();
				}
			})
			.catch(() => {
				if (!disposed)
					setMessage("Secure authorization storage is unavailable.");
			});
		const listener = delegationNative
			.addListener("cloudDelegationCallback", () => void callback())
			.catch(() => null);
		return () => {
			disposed = true;
			mounted.current = false;
			interactive.current?.abort(new DOMException('Consent screen closed', 'AbortError'));
			void listener.then((l) => l?.remove());
		};
	}, [scope, client]);
	async function start() {
		await run(async () => {
			const kinds: ReadKind[] = [...(email ? ['email' as const] : []), ...(calendar ? ['calendar' as const] : [])];
			const result = await client.delegation(
				"start",
				{
					confirmed: true,
					kinds,
				},
				signal,
			);
			if (!valid()) return;
			const url = new URL(String(result.authUrl)),
				state = url.searchParams.get("state");
			if (
				url.protocol !== "https:" ||
				url.username ||
				url.password ||
				url.pathname !== "/app-auth/authorize" ||
				!state ||
				!/^[-\w]{43}$/.test(state) ||
				typeof result.expiresAt !== "string" ||
				!Number.isFinite(Date.parse(result.expiresAt))
			)
				throw Error("Invalid authorization");
			const record: Pending = {
				state,
				authUrl: url.href,
				expiresAt: result.expiresAt,
				phase: "waiting",
				kinds,
			};
			const saved = await secureConnectionStore.compareExchange(
				slot,
				null,
				record,
			);
			if (saved.status !== "saved")
				throw Error("Authorization already pending");
			if (!valid()) return;
			setPending(record);
			await review(record);
		});
	}
	async function review(record: Pending) {
		if (!record.kinds || Date.parse(record.expiresAt) <= Date.now()) throw Error('Start a new permission review');
		const verified = await reviewAlphaDelegation(record.authUrl, record.kinds, nativeCloudRequest, signal);
		if (!valid()) return;
		const next = {...record, review: verified, approved: false};
		const saved = await secureConnectionStore.compareExchange(slot, record, next);
		if (saved.status !== 'saved') throw Error('Authorization changed');
		if (valid()) { setPending(next); setMessage('Review access for this agent. Google may ask you to confirm your account in its secure account chooser.'); }
	}
	async function resumeApproval() {
		await run(async () => {
			const target = await readAlphaDelegationReturn(alphaAuthHost);
			if (!valid() || !target || target.scope !== scope) return;
			const record = await secureConnectionStore.read<Pending>(slot);
			if (!valid() || !record || record.state !== target.state || !record.approved) return;
			await approve(record, true);
		});
	}
	async function approve(record: Pending, resume = false) {
		if (!record.review || !record.kinds || record.code || Date.parse(record.expiresAt) <= Date.now()) throw Error('Start a new permission review');
		if (resume && !record.approved) return;
		const verified = await reviewAlphaDelegation(record.authUrl, record.kinds, nativeCloudRequest, signal);
		if (!valid()) return;
		if (JSON.stringify(verified) !== JSON.stringify(record.review)) { await review(record); return; }
		if (!resume) {
			const approved = {...record, approved: true};
			const result = await secureConnectionStore.compareExchange(slot, record, approved);
			if (result.status !== 'saved') throw Error('Authorization changed');
			record = approved;
			if (!valid()) return;
			setPending(record);
		}
		const controller = new AbortController();
		interactive.current = controller;
		const abort = () => controller.abort(signal.reason);
		signal.addEventListener('abort', abort, {once: true});
		if (signal.aborted) abort();
		let code: string;
		try { code = await approveAlphaDelegation(verified, nativeCloudRequest, async (environment, authSignal) => {
			const token = await nativeAlphaAuthenticate(environment, authSignal, `delegation:${scope}:${record.state}`);
			if (!valid() || Date.parse(record.expiresAt) <= Date.now()) throw Error('The selected agent changed or authorization expired');
			return token;
		}, controller.signal); }
		finally { signal.removeEventListener('abort', abort); interactive.current = null; }
		if (!valid()) return;
		const next: Pending = {...record, phase: 'finishing', code};
		const saved = await secureConnectionStore.compareExchange(slot, record, next);
		if (saved.status !== 'saved') throw Error('Authorization changed');
		if (!valid()) return;
		setPending(next);
		await recover(next);
	}
	return (
		<details
			className="alpha-cloud-delegation"
			open={expanded}
			onToggle={(e) => setExpanded(e.currentTarget.open)}
		>
			<summary>Connect Cloud for scheduled reads</summary>
			<p>{message}</p>
			{!pending && (
				<>
					<label style={{ flexDirection: "row", alignItems: "center" }}>
						<input
							style={{ width: 20, flexShrink: 0 }}
							type="checkbox"
							checked={email}
							disabled={busy}
							onChange={(e) => setEmail(e.target.checked)}
						/>{" "}
						Inbox subjects and snippets
					</label>
					<label style={{ flexDirection: "row", alignItems: "center" }}>
						<input
							style={{ width: 20, flexShrink: 0 }}
							type="checkbox"
							checked={calendar}
							disabled={busy}
							onChange={(e) => setCalendar(e.target.checked)}
						/>{" "}
						Calendar events
					</label>
					<p>No sending, calendar changes, or billing access is requested.</p>
					<button
						disabled={busy || (!email && !calendar)}
						onClick={() => void start()}
					>
						Review Cloud read access
					</button>
				</>
			)}
			{pending && (
				<>
					{pending.review && !pending.code && <section className="alpha-delegation-review" aria-label="Alpha Phone permission review">
						<p>ALPHA COMPUTE</p><h3>Allow scheduled reads?</h3>
						<p>Registered application: {pending.review.appName}</p>
						<p>This agent can read your account identity{pending.kinds?.includes('email') ? ', and read and search your Gmail messages' : ''}{pending.kinds?.includes('calendar') ? ', and read your Google calendars' : ''}. Access expires within seven days.</p>
						<p>No sending, calendar changes, or billing access.</p>
						<button disabled={busy} onClick={() => void run(() => approve(pending))}>Allow selected reads</button>
					</section>}
					<button
						disabled={busy}
						onClick={() => void run(() => recover(pending))}
					>
						Check authorization status
					</button>
					{!pending.code && !pending.review && pending.kinds && <button
						disabled={busy}
						onClick={() =>
							void run(() => review(pending))
						}
					>
						Review permissions
					</button>}
					<button
						disabled={busy || pending.phase === "finishing"}
						onClick={() =>
							void run(async () => {
								await client.delegation(
									"cancel",
									{ state: pending.state, confirmed: true },
									signal,
								);
								await clear(pending);
								setMessage("Authorization cancelled.");
							})
						}
					>
						Cancel authorization
					</button>
				</>
			)}
            {revocations.filter(g=>g.grantId!==grantId).map(g=><div key={g.grantId}><p>Reads are disabled. Cloud disconnect still needs confirmation.</p><button disabled={busy} onClick={()=>void run(async()=>{const result=await client.delegation("revoke",{grantId:g.grantId,confirmed:true},signal);if(!valid())return;await refreshRevocations();setMessage(result.remoteRevocation==="confirmed"?"Cloud read access revoked.":"Reads disabled. Retry revocation to finish disconnecting in Cloud.");})}>Retry Cloud disconnect</button></div>)}
			{grantId && (
				<button
					disabled={busy}
					onClick={() =>
						void run(async () => {
							const result = await client.delegation(
								"revoke",
								{ grantId, confirmed: true },
								signal,
							);
							setMessage(
								result.remoteRevocation === "confirmed"
									? "Cloud read access revoked."
									: "Reads disabled. Retry revocation to finish disconnecting in Cloud.",
							);
							if (result.remoteRevocation === "confirmed") setGrantId("");
                            await refreshRevocations();
							onConnected();
						})
					}
				>
					Revoke this Cloud read grant
				</button>
			)}
		</details>
	);
}
