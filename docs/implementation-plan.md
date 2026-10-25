# Alpha Phone — implementation plan

October 1 architecture change: the user has selected an **Android-resident agent instead of Nitro/TEE hosting**. The [on-device agent plan](on-device-agent-plan.md) supersedes cloud-only and enclave-primary requirements below. The current implementation runs orchestration locally with an explicitly configured hosted Cerebras model; this is not offline LLM operation. Historical evidence is retained. A powered-off phone cannot execute local schedules; optional remote execution has separate acceptance requirements.

September 30 scope update: the [MVP report](mvp-scope-and-gap-report.md) and [completion plan](mvp-completion-plan.md) govern current priority. Earlier cloud-only/local-model statements do not waive the supplied DoD's on-device STT/TTS requirement; offline LLM and external-versus-TEE inference remain explicitly reconciled there.

This plan starts from the setup foundation in this repository. See `verification.md` for actual results; planned acceptance criteria below are not passing results.

This foundation roadmap is retained for architecture context. The current
prototype migration, per-flow work and device evidence are tracked in
[flow-implementation-plan.md](flow-implementation-plan.md),
[prototype-implementation-gaps.md](prototype-implementation-gaps.md), and
[flow-verification.md](flow-verification.md). The target is a Pixel 10 or similar
phone; tablet geometry is not the current acceptance target.

## Dependency order

`foundation → E1/E2 → AP1 pairing → AP2 conversation → AP3 lifecycle/voice → AP4 daily overview → AP5 native capabilities → AP6 connectors/workflows → AP7 OS qualification → AP8 pilot`

OS hardware/source discovery starts alongside E1 and can block AP7 independently. Wallet work is explicitly outside the first vertical slice.

## Product work packages

| Package / owner role | Concrete implementation | Dependency | Tests and completion evidence |
| --- | --- | --- | --- |
| AP1 — Mobile/runtime | Replace unconnected composer via `apps/app/src/runtime/alpha-client.ts`; reuse E2 auth/pairing; add pairing/recovery screens and Android secure token adapter; implement approved endpoint routing rather than accepting arbitrary URLs | E1, E2; endpoint owner decision | Real account/agent pairing; wrong owner/origin, expired/reused callbacks rejected; restart retains correct agent; no tokens in logcat |
| AP2 — UI | Split current home into `home`, `assistant`, `apps`, `settings`; implement four conversation sizes, retained draft/scroll, focus return, keyboard insets, explicit loading/empty/error states using prototype assets/tokens | AP1; UI routes agreed | Portrait/landscape, large font, keyboard and Back/Home loops; separate alpha screenshots; no raw prototype state used as data |
| AP3 — Runtime/voice | Wire speech and streamed replies; explicit stop/cancel, background reconnect, deduped missed messages and visible offline mode; request microphone only at use | AP1–2, E5 | Kill/reopen, radio toggle, sleep/wake, stream cancel, late callbacks and echo tests; type-only path always works |
| AP4 — App data | Agenda/attention/brief cards with provider provenance, freshness and actionable routing; no data shown until connected; configure which proactive workflows are enabled | AP1, E4; provider choices | Empty/expired/revoked account and stale-cache states; opening card reaches correct source object; audit receipts |
| AP5 — Native/mobile | Keep real installed-app handoff; add phone/messages/contacts/camera/files/maps through existing native plugins, one capability at a time. Build role setup and denied-permission paths; avoid changing the secure lock screen from the WebView | AP2, native role decision | Real calls/SMS test environment, denied permissions, unavailable handlers, returning HOME. Emergency/system routes remain usable |
| AP6 — Integrations | Inbox/calendar and workflow list/run history through Google Workspace/personal-assistant/workflow APIs. Add per-account permissions, activity inspection, revoke and cancellation | AP1, E3–4 | Read/write authorization separation, recipient/account confirmation, idempotent result display and no automatic repeat after ambiguous writes |
| AP7 — OS/release | Choose exact phone SKU/Android release; add missing device locks or qualify existing grizzly inputs; stage signed Alpha launcher via E6; select HOME/default roles through provisioning; configure Chromium signer and OTA compatibility | E6; approved hardware, signing and managed endpoint | Linux clean image build, Cuttlefish boot, real phone flash/hardware matrix, signed update and rollback. No local-model payload or local-inference daemon |
| AP8 — Product/QA/support | Accessibility/latency/battery soak, privacy review, pilot instrumentation, support escalation and staged rollout/rollback runbook | AP1–7 | Target-user complete-task test; measured reliability and latency budgets; named support owner and rollback drill |
| AP9 — Future decision | Wallet, secure side-key payment, enclave/attestation claims | Separate provider/custody/security decisions | Hardware-backed evidence and transaction-specific approval before any real transfer; never reuse mock success text |

## First production vertical slice

Use one real test owner and agent. Install the standalone APK, pair, send a typed request, receive a true remote result, open an installed app, press HOME on launcher flavor, background while a result arrives, kill/reopen, and recover exactly one result under the same owner. Repeat with wrong account, revoked credentials and no network. Deliver screen recording plus device/agent trace IDs with secrets removed. Only then connect overview cards and additional app views.

## Prototype-to-code coverage

Boot/lock → native launch theme and system lock handoff; home → current home expanded with real data; shade → system capability/notification integration; Phone/Messages/Contacts → native bridges first; Inbox/Calendar → account-scoped APIs; Browser → isolated browser surface; Camera/Photos/Files → Android permissions and content URIs; Maps → navigation provider/handoff; Notes → existing store; Wallet → deferred; Workflows → existing scheduler; Settings → real capability controls. Gesture and hardware-button paths need native verification independently of touch controls.

## Blocking product decisions

Assign a product owner and engineering owner to: hardware choice; managed Alpha routing/endpoint; required default roles; voice provider/privacy; MVP view priority; background notification policy; signed update authority; wallet deferral. Record a decision and evidence link before adding scope. Treat the upstream issue estimates as historical planning context only.

## Shared Eliza platform work

These changes belong in Eliza once and are consumed through reviewed source pins. Each product owns its adapter configuration and UI. Do not make senior-care consent rules the universal default for all agents.

| Work package | Existing code to inspect/reuse | Add or change | Dependencies and exit evidence |
| --- | --- | --- | --- |
| E1 — Consumer build contract | `packages/app/app.config.ts`, `capacitor.config.ts`, `scripts/mobile/context.ts`, `scripts/mobile/targets/android.ts` | Export a supported app-host composition/bootstrap entrypoint that accepts a renderer and identity; separate default views from transport/native initialization; make release callbacks, authorities, URL schemes, icons, storage namespace and build output agree on the selected identity | Two clean external consumer builds with no relative monorepo path leaks; both APK modes install together across brands; scan APK for canonical-identity leaks |
| E2 — Agent transport and ownership | `packages/ui/src/android-cloud/android-cloud-auth.ts`, `android-cloud-client.ts`, `packages/app/src/api/auth-pairing-routes.ts`, `packages/ui/src/state/agent-session-recovery.ts` | Extract narrow renderer-safe client interfaces for account sign-in, owner/agent pairing, streaming, reconnect and cancellation. Preserve server-derived ownership; bind credentials to account, agent and origin; expose explicit unavailable/expired/wrong-owner states | E1; real test account pairs on phone, restarts, restores missed messages once; stale response after account switch is discarded; malformed/wrong-origin callback cannot install credentials |
| E3 — Observation/action boundary | `plugins/plugin-browser`, `plugins/plugin-native-browser-surface`, `packages/ui/src/platform/browser-surface.ts`, `packages/os/browser` | Typed versioned observations, stable target identities, sensitive-region exclusions, overlay geometry/insets, stale-target rejection and declared capabilities; isolate third-party origin from Capacitor privileges. Add product policy hooks before every actuator path, including raw keyboard, JS evaluation, submit and accessibility actions | Browser/security capability spike; malicious page cannot approve its own action; layout shift invalidates old target; child WebView has no privileged app bridge |
| E4 — Task policy and durable results | `packages/core/src/services/approval.ts`, `plugins/plugin-workflow`, `plugins/plugin-personal-assistant/src/actions/lib/approval-execution.ts`, `packages/agent/src/services/message-interaction-session-store.ts` | Reuse existing stores and approval service, extend with exact proposal/context binding, cancellation epoch, duplicate event rejection, critical-state journal and unknown-outcome receipt. Disable broad/proactive packs per product where incompatible | E2–E3; process death before/during/after a write; no automatic effect replay; tenant/account/task isolation; receipt persistence failure differs from operation failure |
| E5 — Voice and secrets | `plugins/plugin-native-talkmode`, `packages/ui/src/voice`, `packages/agent/src/services/audio-redaction-service.ts`, `plugins/plugin-native-secure-store`, `packages/app/src/services/steward-credentials.ts` | Explicit mic lifecycle, permission-denied fallback, self-playback rejection, transcription confidence, configurable slow-speaker timeout, secret redaction before remote transport, credential-provider references instead of raw values | Chosen ASR/TTS + product mic policy; interruption/cancel tests with real audio; no passwords/OTP/token values in transcripts, screenshots, model input or logs; voice-off remains off across suspend |
| E6 — OS product and release contract | `packages/os/scripts/distro-android/stage-launcher-overlay.ts` (added by this setup), `build-aosp.ts`, `brand-config.ts`, `android/hardware-targets.json` | Consume verified launcher overlay in product-specific build orchestration, separate cloud-only from full local-agent payload validators, declare browser signer allowlist and default-role provisioning, add release descriptor linking app SHA/cert/version to OS image SHA | E1 plus selected hardware; Linux AOSP build, Cuttlefish boot, then real-device role/hardware/OTA/rollback evidence. Retain stock recovery access; do not remove other HOME apps implicitly |

### Native launcher API consolidation

The setup's small `DeviceApps` bridge is duplicated intentionally so each APK can be built immediately. After E1, move installed-app enumeration, explicit app launch and package-change notifications into `plugins/plugin-native-system`, preserving the `ElizaSystem` registration contract. Return app identity, accessible label, icon and capability/error state; keep Android package visibility scoped to launchable activities and do not request `QUERY_ALL_PACKAGES`. Test removed/disabled apps, work profiles, duplicate activities, malicious labels and denied handlers. Replace both local bridges in the same source-pin upgrade; keep product layout and app ordering local. Build identity remains product configuration, not a shared hard-coded package name.

### Packaging decision and migration

Continue with submodules for implementation. Publishing every package is not a prerequisite and would export untested workspace assumptions. Before moving to registry packages: inventory the actual dependency closure; build it in topological order; rewrite workspace versions; include all Android/iOS source and runtime assets; verify exports with `npm pack`; install tarballs into these two clean consumer repos; build both flavors; then publish a coordinated prerelease with a compatibility matrix and rollback pin. Never publish credentials, proprietary device blobs or generated development signing material.

The retired app baseline remains an audit/migration source in Git history; see `eliza-app-baseline-provenance.json`. Do not activate its entire default UI to finish either product. Port the bootstrap and narrow reusable services into E1, retaining original source attribution and comparing against the recorded upstream baseline commit. Every port must have a consumer test; generic fixes go upstream instead of accumulating two copies.

### Shared contract shape

- `RuntimeSession`: owner identity from authentication, agent ID, opaque session ID, connection epoch and capability set. Store tokens only through the platform credential provider.
- `TaskSession`: owner/account/task identity, lifecycle state, active origin, selected object, observation version, pending proposal, checkpoint and external-operation status.
- `ActionProposal`: unique ID, exact operation and target, opaque value references, preconditions, observation version, explanation, expiry and required policy. No generic “yes to everything.”
- `OperationResult`: succeeded, denied, cancelled, retryable-failure, unsupported, or unknown; factual evidence reference; no synthetic success.
- `Observation`: validated origin/page, current targets/bounds/focus/sensitivity, capture timestamp/version and reliability. Redact before the model boundary.
- `Receipt`: operation/task identity, observed provider status, exact-decimal/minor-unit amount if applicable, source/evidence, timestamps and separate storage outcome.

Keep these contracts host-independent in the existing core/shared contracts layer. Native adapters provide capabilities; product policy reduces them. Do not add a second scheduler, identity provider or general-purpose credential vault.

### October 21 login ownership correction

PR #36966's product-specific Cloud pages are superseded by the app-owned login
migration. [The migration record](white-label-cloud-login.md) maps its behavior to
Alpha views and records the generic backend patch, configurable deployments,
verification and remaining CAPTCHA, magic-link, deployment and device gates.
