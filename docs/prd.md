# Alpha Phone — working PRD

Version: 0.3, 2026-10-08 (requirement wording reconciled with the October 1 resident-agent decision and the October 7 owner decisions P-01 to P-08). Version 0.2 was dated 2026-10-01. Derived from the supplied interactive prototype, explicit two-repository request, and the reviewed upstream Alpha issues. Product sign-off is still needed for final scope and hardware. See `sources.md` for provenance. The current MVP scope in `mvp-scope-and-gap-report.md` supersedes the original foundation priorities below; `mvp-browser-review.md` indexes browser implementation and remaining acceptance.

October 11 scope amendment: the user included Phone, SMS, Contacts and Wallet in
the full-product implementation plan. [FP-01–FP-04](full-product-completion-audit.md#newly-authorized-implementation-packages)
define delivery and acceptance. Production enablement is still pending.

## Outcome

A personal agent phone with a distinct Alpha Compute interface: a compact daily overview, installed apps and built-in experiences, and an assistant reachable without losing context. Alpha Phone owns its UI and package identity. Eliza provides agent execution, transport, native capabilities and OS tooling.

The prototype uses white/black surfaces, electric blue `#0000FF`, Fraunces display text, Public Sans body text and compact line icons. Its 412 × 915dp device framing is a design reference, not a hardware support declaration. Preserve source prototype separately from real application code. Never ship mock balances, contacts, messages, attestations or connectivity labels as live state.

## Users and primary journeys

1. Wake/unlock through the actual OS; see current time and genuine actionable information, then open an installed app.
2. Invoke Alpha by touch/text or a permitted voice entrypoint; expand from compact input to overlay/full conversation without losing the current task.
3. Pair the device to the correct Alpha agent; recover after network loss, process death and missed background results without duplicate effects.
4. Connect selected accounts with official authorization and understandable per-capability controls; inspect activity and revoke access.
5. Use a native phone capability or approve a task; see whether it is pending, completed, denied or uncertain with attributable evidence.

## Scope and requirements

| ID | Requirement | Priority / acceptance |
| --- | --- | --- |
| AP-01 | Distinct branded home, app grid and assistant entry; independent package/storage identity | P0; branded shell and connection-aware composer are implemented; provider acceptance remains separately tracked |
| AP-02 | Standalone and HOME APKs from one source; offline shell; stock settings/recovery accessible | P0; inspect final APKs, install both modes, open apps, return HOME repeatedly |
| AP-03 | Existing Eliza sign-in/pairing with approved Alpha routing adapter, owner-scoped credentials | P0; real-device wrong-owner/origin, expired/reused token and callback tests |
| AP-04 | Android-resident agent execution with hosted Qwen inference on Cerebras, honest offline state and reconnect/history restoration | P0; orchestration, conversation state, approvals and receipts run on the phone; text inference uses `qwen-3.8-27b` on Cerebras and is disclosed per connection; Cloud and remote agents are optional connections; no duplicate messages or writes after reconnect; no inference-available claim without health evidence |
| AP-05 | Pill, input, overlay and full assistant modes; keyboard and navigation continuity | P0; draft/scroll state survives resize and Back/Home; no keyboard obstruction |
| AP-06 | Voice entry and cancellation with explicit mic state and typing fallback | P0; ongoing chat voice automatically sends spoken turns after the user starts it (P-01, updated October 12); explicit Stop, mic state and typing fallback remain required; the browser build gets speech recognition, local first, with any cloud route an explicit disclosed opt-in (P-07); device audio tests; latency method pending (A-10); hardware-side-key remapping gated by platform support |
| AP-07 | Daily overview with real agenda, attention items and briefs | P1; no placeholder results; loading/empty/stale/error states; authority and timestamps visible |
| AP-08 | Phone, messages and contacts | P1; included in the October 11 full-product plan (FP-01–FP-03). Implement real native adapters, roles, permissions, recipient review and readback; current entry/action paths remain disabled; emergency facilities remain system-owned. |
| AP-09 | Inbox and calendar | P1; Gmail/Email is in MVP scope and Telegram/Discord are deferred (P-02); reuse Google Workspace/personal-assistant contracts; per-account isolation, consent, write confirmation, exact-once results and revoke |
| AP-10 | Browser, camera, photos, maps, notes and files | P1; explicit Android permissions, cancellation and unsupported states; native handoff before custom replacements; browser sign-ins persist in a profile separate from the host, with ephemeral private tabs (P-04); integrated elizaOS password manager with Proton Pass optional (P-05); deleted notes go to a Trash that empties after 3 days (P-06); OCR covers English only (P-08) |
| AP-11 | Workflow library and run history | P1; inspect, start, pause and cancel with bounded permissions and real receipts; not hard-coded prototype playback |
| AP-12 | Settings: accounts, privacy, connection, voice, theme, text, notifications | P0 foundations / P1 integrations; actual capabilities and Android controls; no simulated switches |
| AP-13 | Wallet and security/attestation surfaces | P1; included in the October 11 full-product plan (FP-04). Provider, key custody, device security and transaction approval remain dependencies; qualify sandbox, receipts and recovery before production enablement; no “attestation passed” without verified evidence |
| AP-14 | Signed AOSP image and update/rollback path for one selected phone SKU | Release gate; exact source/blob/kernel/signer lock, hardware checklist, recovery test |
| AP-15 | Accessibility and resilience | P0; readable contrast, large font, TalkBack, touch/keyboard, offline, killed process, rotation and repeated HOME navigation |

The source prototype has 14 app views. Their existence does not authorize claiming every integration in the initial release. The first production vertical slice is shell → pair → agent message → background/resume recovery → native app handoff. Subsequent built-in experiences should be prioritized by real user tasks.

## Explicit limits and decisions

- The agent runs on the Android phone (October 1 decision; see the [on-device agent plan](on-device-agent-plan.md)). Text inference is hosted: Qwen (`qwen-3.8-27b`) on Cerebras, which receives prompts and selected context over TLS. Cloud and remote agents are optional connections. Fully offline language-model operation is not qualified. The prototype's on-device model, enclave and attestation statements are visual fixtures, and the confidentiality claims ladder in [decisions](decisions.md) governs product wording.
- The October 7 owner decisions P-01 to P-08 in [decisions](decisions.md#october-7-owner-product-decisions) apply to this PRD: ongoing chat voice with automatic sending after explicit start (October 12 update to P-01), Gmail/Email in scope, opt-in notification mirroring, persistent browser sign-ins with private tabs, an integrated password manager, a 3-day notes Trash, local browser speech recognition and English OCR. They are policy, not evidence of implementation.
- Pixel 10 versus Pixel 11 Pro is unresolved. No Pixel 10 source lock was found in the pinned OS tree. Pixel 11 Pro's source lock is not real-device qualification.
- Android status shade, lock screen, secure wallet gestures, default phone/SMS handling and system-wide assistant invocation are OS/role work, not CSS inside a launcher.
- No new identity provider; use upstream pairing. No real account credentials in the prototype. No payment processing or custody in this bootstrap.
- Required decisions are listed, with options and evidence, under [pending owner decisions](decisions.md#pending-owner-decisions), including powered-off scheduling (A-09) and the voice latency method (A-10). None of them is decided by this PRD.

## Current implemented versus accepted

Implemented source now includes the independent ten-view renderer; Cloud/remote/local-development connection adapters (production Android offers only the on-device agent with Eliza Cloud sign-in and refuses remote pairing); context-aware conversations and reviewed actions; native speech/recording routes; encrypted native Notes and browser-local Notes; Calendar/reminder/Clock adapters; isolated native browser controls; selected files/media and Maps; Gmail drafts and provider adapters; workflow authoring/approvals/durable results; hosted digest controls; and settings/permission readback. The browser review adds fitted desktop presentation, persistent theme, local text import/download, explicit manual recording, modal keyboard/Back handling and reproducible browser/adapter regression checks.

Implementation is not full acceptance. Current limits are summarized in [product status](mvp-current-status.md); detailed historical native/runtime evidence remains in the [archived acceptance ledger](https://github.com/AlphaCompute/alphaphone/blob/5b43638417d3adff649964c8188582ccc22b8390/docs/current-acceptance-ledger.md). Live Cloud/Gmail authorization, the powered-off scheduling decision (A-09), real password-manager and provider integration, speech functional acceptance and latency (A-10), maintained native browser qualification, signed image/device delivery and target-user acceptance remain open. Browser checks do not close those gates. No APK build, emulator run, hosted CI run, real-integration or device result is recorded at the current upstream pin; per-loop evidence is in the [core loop audit](core-loop-audit.md) and what only the owner can do is in [owner actions](mvp-owner-actions.md). The current software state of each requirement is in [PRD requirement status](mvp-current-status.md#prd-requirement-status) and `docs/requirements.json`.

This PRD's requirement is that on-device speech (Whisper recognition and Kokoro synthesis) remains required on Android and that the browser build prefers local recognition; hosted text inference does not waive local speech. Current source differs: P-07 as recorded in [decisions](decisions.md#october-7-owner-product-decisions) makes Eliza Cloud the default voice route, flag-off builds select it unconditionally, and on-device speech has failed its functional acceptance. Which of the two governs is not decided here (pending A-24 and inventory item MVP-01). Pixel 10 or a similar phone is the current engineering target; the supported SKU (A-01) and final device-image qualification remain separate. Telegram and Discord are deferred (P-02), and an offline language-model fallback remains outside the qualified scope.
