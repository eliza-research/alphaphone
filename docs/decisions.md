# Architecture and product decisions

October 1 architecture change: the user has selected an **Android-resident agent instead of Nitro/TEE hosting**. The [on-device agent plan](on-device-agent-plan.md) supersedes cloud-only and enclave-primary requirements below. Agent execution and model inference are separate: the implemented path uses hosted Cerebras text inference and local orchestration; fully offline language-model operation remains unqualified. Historical evidence is retained. October 12 policy below resolves powered-off scheduling: schedules run only while the phone is powered on.

## Accepted foundation decisions

1. Keep Alpha Phone and senior-care independent: separate repository, application ID, renderer, assets and release stream.
2. Use a pinned Eliza source submodule while upstream consumer exports stabilize. Avoid publishing every workspace package before testing the actual dependency closure.
3. Package the pinned Eliza runtime with the Capacitor shell and use native authenticated IPC for the resident agent. Browser development runs the real agent on a private local host. Cloud/remote adapters remain historical/development infrastructure only; October 12 policy prohibits every hosted-agent product connection. Connected chat reports the actual protocol outcome; offline and unavailable connections must not simulate a successful send. See [current status](mvp-current-status.md) for the remaining integration and device acceptance.
4. Use standalone and launcher product flavors with the same Alpha identity. Switching flavor replaces the installed Alpha app. Senior-care has a different identity and can coexist.
5. Make AOSP installation additive, nonprivileged and certificate/hash verified. Device provisioning chooses default HOME. Keep system recovery paths available.
6. Preserve the prototype's brand and layout direction while labeling data and agent capabilities honestly. Do not port mocked transfers, account linking or generated success messages.
7. October 2 confidentiality claim: hosted text inference stays on Qwen (`qwen-3.8-27b`) via Cerebras; `scripts/agent-model.mjs` holds the script default. Product, demo and sales wording follows the claims ladder in [the open-gap plan](market-research/15-open-gap-technical-plan.md). Today only rung L0 is earned: the agent runs on the phone; model requests carry prompts and selected context over TLS to Cerebras (US) running Qwen; no-retention is contractual, not technical. Never say sealed, attested, enclave-protected or "never leaves the device" until the named evidence exists. `test/browser/confidentiality-claims.spec.ts` enforces this for real and mock screens.
8. October 2 platform scope: Alpha forks AOSP for its own signed image. Banking apps, Play Integrity and GMS are not requirements. Always-on listening follows [the AOSP listening spec](market-research/12-aosp-always-on-listening.md) and needs a new ADR superseding item 5's nonprivileged rule for the listener package only.

## October 7 owner product decisions

Decided by the product owner on 2026-10-07 unless marked as an engineering disposition. Entries use stable `P-` identifiers, separate from the numbered foundation decisions above, so later foundation entries do not renumber them. These record product policy; they are not evidence that any feature is implemented or accepted. Each acceptance gate in [current status](mvp-current-status.md) still applies.

- **P-01** **Superseded by P-39 on October 12:** Voice send (product owner): voice does not auto-send, for now. The flow stays record → transcribe → review → the user sends. Consequence: the DoD's six-second hands-free round trip cannot be met with a manual send. Open follow-up A-10 must either measure end-of-speech to first audible response excluding the user's review/send time, or revisit the target. This entry does not choose between them.
- **P-02** Email scope (product owner): Gmail/Email is in MVP scope. Telegram and Discord stay deferred unless the owner states otherwise. This resolves the messaging part of A-07; other providers and exact read/write scopes remain open there.
- **P-03** Cross-app notification mirroring (delegated by the product owner to engineering judgment; engineering disposition): keep the implemented feature. It must stay strictly opt-in and off by default, outside onboarding, limited to user-selected apps, with previews hidden while the device is locked, and clearly disclosed. It is not an MVP acceptance gate. Re-evaluate it before any Play Store distribution because of notification-listener policy.
- **P-04** Browser sign-ins (product owner): browser tabs keep sign-ins in a persistent browser profile, with an explicit private-tab option that stays ephemeral. This supersedes the earlier per-tab ephemeral profile design. The persistent profile must remain separate from the privileged Capacitor host profile.
- **P-05** Password manager (product owner): an integrated password manager is in scope. It belongs in elizaOS upstream as a reusable component that Alpha consumes. Proton Pass remains an optional alternative provider. This supersedes "credential handling remains in the third-party provider" as the only path; provider-owned vault and unlock UI still applies when Proton Pass is chosen.
- **P-06** Note deletion (product owner): deleted notes go to Trash, and Trash empties automatically after 3 days. Implemented for text, checklist, link and voice notes, including approved agent deletions: a voice note's recording is trashed, restored and erased with its Trash entry, and the native 30-day audio sweep remains only a backstop. Undo, Restore, Delete forever and Empty Trash (both confirmed) are available. See [browser storage](browser-storage.md#notes-trash).
- **P-07** **Superseded by P-13/P-29 on October 12:** Voice route: Eliza Cloud is the current product default for chat voice, Notes transcription and read-aloud, bound to the signed-in account. Recording alone does not upload audio; transcription and playback name the selected service. The earlier local browser Whisper engine remains an optional implementation, not the default or an automatic fallback.
- **P-08** OCR languages (product owner): OCR covers English only for now.

## October 10 owner product decision

Decided by the product owner on 2026-10-10. Same rules as the entries above: this records product policy, not evidence that anything is implemented, accepted or legally reviewed.

- **P-09** Dependency licences and the Denton typeface (product owner), in three statements made that day:
  1. Open-source licences. The owner's instruction is to ignore the licence checks, because the work is all MIT-licensed open source and it is fine to use free open-source technology; the licences must be there, and they must be properly flagged and handled. Policy that follows: an open-source dependency licence never stops a build and is never a release blocker. Every licence text and notice still ships, and anything copyleft, unknown or unverified is flagged, with what it obliges, in the notices, in the build output (`LICENCE FLAG <flag>: <package>@<version> (<licence>)`, warnings, exit 0) and in the machine-readable inventories (`third-party-notices.json`, the verify-apks `licenceFlags` list, the SBOM). Implemented in `scripts/licence-policy.mjs` and `scripts/generate-licenses.mjs`; see [dependency audit](dependency-audit.md#licence-flags-p-09).
  2. Denton check: "flag only". The separately named check for proprietary fonts, `unresolved-font-licence`, is reported in the build output and in release records and does not make a release `distributable: false`. The constant `UNRESOLVED_FONT_LICENCE_BLOCKS_DISTRIBUTION` in `scripts/licence-policy.mjs` is therefore `false`; setting it to `true` makes a font with no licence record a release blocker again.
  3. Denton licence. The owner states that Alpha Compute owns the Denton font and that the licence is simply not in this repository. This closes A-21 as licensed, with the licence held by the owner outside the repository. What is recorded is that statement and nothing more (`licenses/font-licenses.json`, evidence `held-outside-repository`): no licence document, name, number, date, scope or terms is in the repository or was seen in this work. The font remains proprietary and is not open-source software; its notice and SBOM entries say so and stay flagged `proprietary-licence-held-outside-repo`. One follow-up would complete the record: a reference to the licence document (a reference only, never the document itself, and no secrets) in the record's `reference` field, when the owner supplies one.

  What this entry does not claim. "Included and flagged" is not legal review. The obligations a flag names (corresponding source for GPL, AGPL and LGPL components, a replaceable library for LGPL, a source offer that extends to network use for AGPL) are stated, not shown to be met. The first statement covers open-source software: the resident runtime payload contains one package under non-commercial terms (`@metamask/sdk`, flagged `non-open-source-terms`; see the dependency audit), which none of the three statements addresses.

## October 12 owner decisions

The owner approved the following choices in chat on 2026-10-12. The matching GitHub
issues are now implementation TODOs, not unanswered decision requests. The policy
below controls over older PRD/plan wording and source defaults. Acceptance remains
open. In particular Wallet is removed from MVP, superseding the October 11 expansion.

- **P-10 — A-09 ([#394](https://github.com/AlphaCompute/alphaphone/issues/394)):** Schedules run only while the phone is powered on; the agent is local. Remove powered-off hosted-loop acceptance. Record missed occurrences once; do not automatically replay overdue effects. Offer an explicit Run now action where useful.

- **P-11 — A-10 ([#395](https://github.com/AlphaCompute/alphaphone/issues/395)):** Voice-assistant latency is the elapsed time from the last user speech audio sample to the first audible response sample. Include end-of-turn detection, final STT, inference, TTS and playback buffering. Do not subtract silence detection or report a sum of selected stages as the end-to-end result. Dictation reports stop-to-editable-text separately; manual user think time is not a voice-assistant benchmark.

- **P-12 — A-02 ([#396](https://github.com/AlphaCompute/alphaphone/issues/396)):** Eliza Cloud is the managed account, inference, subscription and Maps service endpoint. Agent orchestration, state, scheduling and approvals remain on the phone. No Cloud/hosted agent exists as a product connection, upgrade or fallback.

- **P-13 — A-04 ([#397](https://github.com/AlphaCompute/alphaphone/issues/397)):** All speech recognition and synthesis run locally on the device, always. Replace Cloud/paired-host speech policy. Use the Android native bridge to the reviewed Eliza llama.cpp/libelizainference build, extending shared upstream speech support where necessary. Research candidate models on Hugging Face and select by measured device speed and quality, not advertised desktop throughput.

- **P-14 — A-05 ([#398](https://github.com/AlphaCompute/alphaphone/issues/398)):** Use periodic background work and immediate reconciliation at resume/start. Doze delays are honest; a permanent connection solely for mail is not required. Stable event identities prevent duplicate user-visible alerts.

- **P-15 — A-01 ([#399](https://github.com/AlphaCompute/alphaphone/issues/399)):** Target Pixel 10a on Android 17. Ship standalone APK and Alpha AOSP image/launcher; Cuttlefish is the image integration test target. Other Pixels are not alternate promised hardware.

- **P-16 — A-06 ([#400](https://github.com/AlphaCompute/alphaphone/issues/400)):** Alpha Compute controls signing and update authority; Shaw is the accountable release/support/rollback owner. Use managed or hardware-backed release signing, distinct from developer keys.

- **P-17 — A-11 ([#401](https://github.com/AlphaCompute/alphaphone/issues/401)):** Android Clock owns alarms, conditional on a usable integration in the app and AOSP image. Alpha owns reminders. A dispatch receipt may state that Clock opened, not that an alarm was created.

- **P-18 — A-12 ([#402](https://github.com/AlphaCompute/alphaphone/issues/402)):** Passkeys are outside MVP acceptance. Integrated passwords remain in scope. A later release may use the system credential provider after actual browser/image qualification; Alpha is not a new passkey provider now.

- **P-19 — A-13 ([#403](https://github.com/AlphaCompute/alphaphone/issues/403)):** Third-party cookies are allowed in normal browsing. Persistent first-party sign-ins remain. Private tabs remain ephemeral and strict; browser storage stays separate from the privileged app WebView.

- **P-20 — A-14 ([#404](https://github.com/AlphaCompute/alphaphone/issues/404)):** Every eligible login surface in Alpha should support password-manager fill. The isolated Browser is currently the website-login surface; future Alpha-owned login forms must also be covered. This is not blanket trust of arbitrary external browsers and does not expose passwords to the agent.

- **P-21 — A-15 ([#405](https://github.com/AlphaCompute/alphaphone/issues/405)):** Include reading, read/unread, archive, drafts, reply/forward, reviewed send, opening/saving attachments and user-selected outbound attachments. Defer custom label management.

- **P-22 — A-16 ([#406](https://github.com/AlphaCompute/alphaphone/issues/406)):** Only the local resident agent is supported. No hosted agent, dedicated-agent purchase, remote pairing or Cloud-agent fallback is a product option, now or as an advanced setting.

- **P-23 — A-17 ([#407](https://github.com/AlphaCompute/alphaphone/issues/407)):** Use the system secure camera and its AOSP lock-screen gesture. Alpha does not implement its own secure camera; agent/library/account access stays behind unlock.

- **P-24 — A-18 ([#408](https://github.com/AlphaCompute/alphaphone/issues/408)):** Provide full device photo/video library access to the local agent where Android permits and the user grants it, rather than limiting the product to owned captures or picker selections. Handle partial/denied access honestly. Full local access does not imply automatic upload of the entire library.

- **P-25 — A-19 ([#409](https://github.com/AlphaCompute/alphaphone/issues/409)):** No app-data import/export, backup or device-transfer product workflow. Provide a confirmed Reset Alpha data option. Keep Android backup disabled. Ordinary Files opening/saving and Gmail attachments are separate daily-tool operations, not app-data migration.

- **P-26 — A-20 ([#410](https://github.com/AlphaCompute/alphaphone/issues/410)):** Use subscription billing with reasonable rate limits rather than a user-facing credit top-up/per-token meter. Billing checks must not add a billing-service round trip to each assistant turn. Local speech and local tools do not depend on an online billing check.

- **P-27 — A-22 ([#411](https://github.com/AlphaCompute/alphaphone/issues/411)):** Support portrait and landscape, adapting each surface by its purpose. Do not stretch every panel or change sensitive/native UI ownership. Preserve drafts, scroll, selection, task and capture state.

- **P-28 — A-23 ([#412](https://github.com/AlphaCompute/alphaphone/issues/412)):** Maps belongs in Eliza Cloud as a reusable managed service for agents, with full supported search, place, route and navigation control from Alpha’s local agent. The regional development gateway is a prototype adapter, not the production coverage promise. No hosted agent is introduced.

- **P-29 — A-24 ([#413](https://github.com/AlphaCompute/alphaphone/issues/413)):** On-device STT and TTS are mandatory for every production speech entrypoint, including signed-out and offline use. No Cloud speech fallback. A failed local engine must surface recovery and typing, not switch routes.

- **P-30 — A-25 ([#414](https://github.com/AlphaCompute/alphaphone/issues/414)):** Use a short durable Undo window and one review step for events and reminders. Initial engineering value: ten seconds. Delay provider deletion until expiry when possible; never call a recreated invitation a lossless restore. Suspend pending-deletion reminder delivery immediately.

- **P-31 — A-26 ([#415](https://github.com/AlphaCompute/alphaphone/issues/415)):** No Cloud-agent host is admitted. The resident agent uses the local native bridge. Cloud inference, subscription, Gmail and Maps are managed services, not agent hosts.

- **P-32 — A-32 ([#416](https://github.com/AlphaCompute/alphaphone/issues/416)):** Use Android’s shade as the single notification/quick-settings surface if it integrates correctly and matches the product design. Keep workflow history in Alpha; remove the competing imitation shade. Use normal notifications/tiles before custom SystemUI changes.

- **P-33 — A-33 ([#417](https://github.com/AlphaCompute/alphaphone/issues/417)):** A downward swipe on empty launcher Home opens Android’s shade. Preserve top-edge Android behavior and content/conversation scrolling. Standalone follows ordinary app behavior.

- **P-34 — A-34 ([#418](https://github.com/AlphaCompute/alphaphone/issues/418)):** Free, cancelled and declined entries are not busy. Offer owner-selected free/busy-only calendars without exposing details. Tentative/unanswered blocking entries count conservatively; unavailable/stale reads are unknown, never free.

- **P-35 — A-35 ([#419](https://github.com/AlphaCompute/alphaphone/issues/419)):** A reviewed Use in email suggestion may attach items selected in Files or Photos. Context selection is not itself permission to attach. Insert into a draft; final Send is separate.

- **P-36 — A-03 ([#420](https://github.com/AlphaCompute/alphaphone/issues/420)):** Phone, Contacts and SMS are included only in the AOSP fork. Hide and capability-gate them in standalone APKs and other non-AOSP product installs. The launcher flavor alone is not proof of an Alpha image. Wallet is outside MVP.

- **P-37 — A-07 ([#421](https://github.com/AlphaCompute/alphaphone/issues/421)):** Communication providers are Gmail and text messaging. Gmail is available in both product distributions; SMS/MMS is device/SIM based and only exposed on the Alpha AOSP image. Telegram, Discord and additional mail providers stay deferred. Device Calendar/Contacts sources remain separate native permissions.

- **P-38 — A-08 ([#422](https://github.com/AlphaCompute/alphaphone/issues/422)):** Wallet is removed from the MVP plan. No custody, payment, pass-wallet, NFC payment integration or wallet-provider activation is required for MVP. Preserve unrelated user data; do not activate prototype transfers.

- **P-39 — MVP-01 ([#423](https://github.com/AlphaCompute/alphaphone/issues/423)):** Transcribe records locally and on Stop inserts editable text; the user sends it. Voice assistant listens and submits automatically: after a short gap evaluate semantic turn completion with Clef; after a longer gap submit. Resumed speech cancels pending submit or the in-flight response/playback and continues the utterance/conversation. All STT/TTS remains local.

- **P-40 — MVP-52 ([#424](https://github.com/AlphaCompute/alphaphone/issues/424)):** Always-on listening and supported hardware-key invocation are required in the AOSP MVP, not a later milestone. Use a narrowly privileged isolated listener only; the ordinary Alpha app remains nonprivileged. Listening is off until consent, local, visibly indicated and immediately stoppable.

- **P-41 — OWNER-NOTICE ([#425](https://github.com/AlphaCompute/alphaphone/issues/425)):** Withdraw owner-specific approval notices on owner change. Repost quietly when the original owner returns only if the approval remains pending, valid and unexpired. Keep workflow state; revalidate the target and create a fresh tap binding. Apply the same privacy boundary to owner-specific result notices.

## Resolved decision index

| ID | Policy | Implementation | State |
| --- | --- | --- | --- |
| A-09 | P-10 | [#394](https://github.com/AlphaCompute/alphaphone/issues/394) | TODO |
| A-10 | P-11 | [#395](https://github.com/AlphaCompute/alphaphone/issues/395) | TODO |
| A-02 | P-12 | [#396](https://github.com/AlphaCompute/alphaphone/issues/396) | TODO |
| A-04 | P-13 | [#397](https://github.com/AlphaCompute/alphaphone/issues/397) | TODO |
| A-05 | P-14 | [#398](https://github.com/AlphaCompute/alphaphone/issues/398) | TODO |
| A-01 | P-15 | [#399](https://github.com/AlphaCompute/alphaphone/issues/399) | TODO |
| A-06 | P-16 | [#400](https://github.com/AlphaCompute/alphaphone/issues/400) | TODO |
| A-11 | P-17 | [#401](https://github.com/AlphaCompute/alphaphone/issues/401) | TODO |
| A-12 | P-18 | [#402](https://github.com/AlphaCompute/alphaphone/issues/402) | TODO |
| A-13 | P-19 | [#403](https://github.com/AlphaCompute/alphaphone/issues/403) | TODO |
| A-14 | P-20 | [#404](https://github.com/AlphaCompute/alphaphone/issues/404) | TODO |
| A-15 | P-21 | [#405](https://github.com/AlphaCompute/alphaphone/issues/405) | TODO |
| A-16 | P-22 | [#406](https://github.com/AlphaCompute/alphaphone/issues/406) | TODO |
| A-17 | P-23 | [#407](https://github.com/AlphaCompute/alphaphone/issues/407) | TODO |
| A-18 | P-24 | [#408](https://github.com/AlphaCompute/alphaphone/issues/408) | TODO |
| A-19 | P-25 | [#409](https://github.com/AlphaCompute/alphaphone/issues/409) | TODO |
| A-20 | P-26 | [#410](https://github.com/AlphaCompute/alphaphone/issues/410) | TODO |
| A-22 | P-27 | [#411](https://github.com/AlphaCompute/alphaphone/issues/411) | TODO |
| A-23 | P-28 | [#412](https://github.com/AlphaCompute/alphaphone/issues/412) | TODO |
| A-24 | P-29 | [#413](https://github.com/AlphaCompute/alphaphone/issues/413) | TODO |
| A-25 | P-30 | [#414](https://github.com/AlphaCompute/alphaphone/issues/414) | TODO |
| A-26 | P-31 | [#415](https://github.com/AlphaCompute/alphaphone/issues/415) | TODO |
| A-32 | P-32 | [#416](https://github.com/AlphaCompute/alphaphone/issues/416) | TODO |
| A-33 | P-33 | [#417](https://github.com/AlphaCompute/alphaphone/issues/417) | TODO |
| A-34 | P-34 | [#418](https://github.com/AlphaCompute/alphaphone/issues/418) | TODO |
| A-35 | P-35 | [#419](https://github.com/AlphaCompute/alphaphone/issues/419) | TODO |
| A-03 | P-36 | [#420](https://github.com/AlphaCompute/alphaphone/issues/420) | TODO |
| A-07 | P-37 | [#421](https://github.com/AlphaCompute/alphaphone/issues/421) | TODO |
| A-08 | P-38 | [#422](https://github.com/AlphaCompute/alphaphone/issues/422) | TODO |
| MVP-01 | P-39 | [#423](https://github.com/AlphaCompute/alphaphone/issues/423) | TODO |
| MVP-52 | P-40 | [#424](https://github.com/AlphaCompute/alphaphone/issues/424) | TODO |
| OWNER-NOTICE | P-41 | [#425](https://github.com/AlphaCompute/alphaphone/issues/425) | TODO |
| A-21 | P-09 | Closed: licensed; the owner holds the licence outside the repository (P-09); no licence document, name, number, scope or terms has been seen or recorded | Policy closed |

## Open decisions

The 32 reviewed product choices are resolved. Implementation details that still need
measurement (speech candidate, Clef feasibility, subscription price/quotas, Cloud Maps
provider coverage) are deliverables in their TODOs; they do not reopen the approved
local-only agent/speech, subscription, AOSP scope or Wallet exclusion policies.

## Pending owner decisions

No reviewed A-01–A-26/A-32–A-35/MVP-01/MVP-52/owner-notice item remains awaiting
owner policy. A-21 was already closed under P-09; A-27–A-31 were never decision IDs.
The [approved backlog](owner-approved-mvp-plan-2026-10-12.md) contains every checklist.
Earlier questions and evidence remain in Git history and the historical details of
each issue; no failed or unrun acceptance result becomes a pass through this decision.

## Closed owner decisions

A-21 remains licensed by owner statement under P-09, with the licence held outside
the repository. The 32 October 12 choices are policy-resolved above; their associated
implementation issues remain open TODOs. Existing P-02–P-06/P-08/P-09 continue where
not explicitly superseded (reset-only removes data import/export requirements;
normal-browser third-party cookies are now allowed).
