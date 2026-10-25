# Alpha Phone production readiness review and completion plan

Alpha Phone is not yet ready to ship as a fully working web, standalone Android and AOSP product. Much of the implementation already exists on main, and the remaining work combines specific bugs, incomplete production web capability, deployment, native speech admission, and release/device qualification. The fastest path is to integrate the reviewed pending fixes, settle the web runtime contract, complete continuous real-service journeys, and qualify one frozen release candidate. A wholesale renderer rewrite would delay that path; incremental extraction is worthwhile where it removes known failure modes.

Review date: October 23, 2026, America/Los_Angeles. This is a report and proposed implementation plan; it changes no product behavior and closes no issues.

## Source and evidence boundaries

There are two materially different sources:

- **Current main reviewed:** Alpha `3f25885d1fe9fac624a10cb2307596f7cf34178a`, Eliza `f931082ebd87a0fecc3f11f8eacf58f598294d4a`. GitHub was fetched and this exact tree was reconstructed in `/tmp/alphaphone-review-main` for isolated inspection and verification.
- **User working tree:** branch `codex/upstream-platform-cleanup`, HEAD `9e3d179bbe0c3a3b40d09430c65c9d65cc4aff5b`, Eliza `91dc19196c307eb8559b9b58de8dbf63eb47f43f`, with 141 status entries at initial inspection. It contains substantial uncommitted authentication, AOSP and test changes. Those changes were preserved. Findings about main must not be applied blindly to this older branch.

The main-versus-local-HEAD diff spans 2,590 paths. First reconcile local work against main by behavior and provenance; do not merge this entire working tree or discard it as obsolete. Many apparently missing local features have already landed upstream or on main.

The [source inventory](evidence/production-review-2026-10-23/source-inventory.json) records hashes and sizes for 417 renderer files, 184 Android main files, 20 listener files, 10 backend files, 272 scripts, 9 workflow files and 914 test files. This review combines that repository-wide inventory, static searches, targeted implementation tracing, existing evidence, fresh tests and browser inspection. It is not a claim that every line or possible execution has been manually verified. The pinned Eliza monorepo was reviewed through the consumed contracts and implementations, not as an exhaustive independent audit of every upstream package.

Unless labeled otherwise, source paths below refer to **the main revision above**, not the older file currently at the same path in the user's checkout. Use this [immutable source tree](https://github.com/AlphaCompute/alphaphone/tree/3f25885d1fe9fac624a10cb2307596f7cf34178a) when implementing findings. The issue and PR inventories are retained alongside this report.

## What works in each mode

“Everything works everywhere” should mean consistent journeys and honest capability handling, with a clearly specified implementation for each host. It cannot mean that a normal web page has Android's telephony roles, system shade, secure camera, privileged listener or background execution guarantees.

| Capability | Production web today | Standalone Android | Alpha AOSP image | Required finish |
| --- | --- | --- | --- | --- |
| Home, navigation, Notes, Files, presentation | Implemented browser adapters; fresh production tests exercise them | Implemented native/local adapters | Same app plus system surfaces | Keyboard, large text, persistence and failure-state qualification on actual targets |
| Agent execution | Built web app explicitly says agent runs in Android; real local host is DEV-only | Bun/PGlite resident runtime | Resident runtime in packaged launcher | Decide and implement shipping web host; qualify exact packaged Android runtime |
| Cloud sign-in and Gmail | Visible connect action leads to Android-only message | In-app/native account route implemented | Same service account boundary | Web sign-in/runtime support, real owned account/grant/revoke/send acceptance |
| Cloud text inference and billing | Full product connection unavailable in flag-off web | Managed service admission implemented | Same | Merge admission corrections; live entitlement/credit/limit/expiry/outage tests |
| Speech | Development host/Cloud routes exist; not parity with shipped native engine | Native default; explicit Cloud QA exception | Local speech plus separate listener | Current-model package admission, installed microphone/playback, barge-in and latency |
| Maps imagery | Public basemap available; imagery alone does not provide routes | Same basemap plus native location/navigation | Same plus system lifecycle | Provision Cloud coverage; authenticated route and physical navigation acceptance |
| Embedded Browser | Sandboxed iframe; host cannot inspect arbitrary cross-origin content | Isolated native browser | Isolated native browser plus qualified image browser identity | Web external-browser fallback and truthful capability UI; real native website/autofill tests |
| Reminders/workflows | Foreground/tab limitations; local reminders do not imply powered-off scheduling | Resident scheduling, notifications and reconciliation | Same plus image lifecycle | Doze/reboot/clock-change, missed-occurrence and process-death tests |
| Phone, Contacts, SMS/MMS | Not product capabilities | Intentionally unavailable | Image-gated adapters/handoffs | Real carrier/role/SIM readback; MMS sending remains external-app handoff |
| Clock | Browser implementation is not Android alarm acceptance | Reviewed native Clock handoff | Image must include functional Clock | Actual create/ring/snooze/dismiss, reboot/DST/DND |
| Notification shade | Cannot provide Android shade | Uses OS behavior | Launcher gesture/system integration | Actual SystemUI/lock/gesture screenshots and tests |
| Always-on listening | Not equivalent in a suspended browser tab | Only permitted foreground/assistant behavior | Separate narrowly privileged listener | Consent, privacy switch, lock/AOD indicator, calls, battery, stop and reset tests |
| Secure camera | Browser camera requires foreground permission | System secure-camera path remains system-owned | Image integration required | Locked capture and return, without exposing private gallery |
| Wallet/passkeys | Outside current MVP | Outside current MVP | Outside current MVP | Keep unavailable; no simulated success paths |

A launcher APK on a stock phone is **not** the Alpha AOSP image. `AlphaImageCapabilities.java` checks release/test flags, launcher, system installation and provisioning. Do not replace this with `isLauncher` or a URL flag to manufacture parity.

For a shipping web product, prefer a supported local companion runtime initially if retaining local agent ownership is mandatory. The existing DEV host is useful groundwork, but needs production installation, lifecycle, authenticated loopback/origin admission, version negotiation, updates and storage support. A pure-browser runtime is a larger feasibility project for persistence, model/runtime compatibility and suspended-tab execution. A hosted-agent fallback would contradict the current product policy and should not be introduced implicitly. Meanwhile, label the existing web distribution as a limited local-app surface and remove misleading connection actions.

## Every open issue and pending PR

Six issues were open at capture. Their current acceptance requirements remain valid even where older issue text describes superseded work.

| Issue | Existing implementation or evidence | Remaining work and closure evidence |
| --- | --- | --- |
| [#381 Complete app MVP](https://github.com/AlphaCompute/alphaphone/issues/381) | Resident/service separation, native adapters, production fixture exclusion, rich unit/browser coverage, many policy changes already implemented | Integrate pending corrections; resolve shipping web scope; continuous signed-in text/voice/daily-tool journeys; current hardware acceptance. Reconcile all 53 inventory items and 32 policy tasks against artifacts, not checkbox state |
| [#377 AOSP MVP image](https://github.com/AlphaCompute/alphaphone/issues/377) | Image staging, listener/SystemUI integration sources, retained development image evidence | Build current release candidate with admitted native assets; Cuttlefish image boot; Pixel image integration; listener, telephony, camera, Clock, shade, radios and recovery. APK success does not close this |
| [#399 Pixel 10a Android 17](https://github.com/AlphaCompute/alphaphone/issues/399) | Issue records exact source-lock validation and development physical boot; main Cloud-profile four-APK build succeeded | Release source admission, current app/native/image identity, both ABI packages, actual Pixel functions and update compatibility. Installed October 19 version-6 image is not current-main qualification |
| [#400 Signing and recovery](https://github.com/AlphaCompute/alphaphone/issues/400) | Signing/OTA tooling, owner named, public descriptors and validation code exist | Managed key custody; public signer/channel identities; signed known-good recovery artifact; signed update, interruption, compatible rollback and stock-recovery drills. Merge #612 first |
| [#410 Subscription/rate limits](https://github.com/AlphaCompute/alphaphone/issues/410) | Entitlement parsing/verification, refresh, UI and service admission exist; issue records published Plus/Pro catalog | Merge #615 admission correction; authenticated expiry/revoke/exhaustion/outage; measured p50/p95 and cost rationale. Existing prices/quotas should be validated, not invented again. Avoid per-turn billing lookup |
| [#412 Shared Cloud Maps](https://github.com/AlphaCompute/alphaphone/issues/412) | Provider contracts, six Cloud routes, OSM/GraphHopper adapter, phone session adapter and navigation tools exist | Production datasets/provider credentials/coverage/freshness/operations; live authorized routes, alternatives, mode support and account/rate-limit behavior; physical navigation. Public map tiles or HTTP 401 do not establish routes |

Five open PRs should be handled before writing replacement implementations:

| PR | Recommended treatment |
| --- | --- |
| [#611 Reviewed Maps/mobile task fixes](https://github.com/AlphaCompute/alphaphone/pull/611) | Review and integrate upstream pin change first. Includes padded Maps-ID and native mobile-host bridge fixes. Recorded emulator checks include skipped authenticated scenarios; retain that distinction |
| [#614 Native speech and embedding components](https://github.com/AlphaCompute/alphaphone/pull/614) | Stacked on #611. Review artifact provenance and exact-input equivalence, then merge after prerequisites/checks. PR records both-ABI component evaluation and 12 packaged speech checks across both variants, while release voice qualification remains false |
| [#613 Canonical Paradee model reproduction](https://github.com/AlphaCompute/alphaphone/pull/613) | Retain reproducible model acquisition and evidence; reconcile overlap with #614 rather than duplicating model work |
| [#612 Recovery evidence validation](https://github.com/AlphaCompute/alphaphone/pull/612) | High-priority release-gate fix. Fresh reproduction below confirms main accepts incomplete evidence |
| [#615 Cloud access and permission recovery](https://github.com/AlphaCompute/alphaphone/pull/615) | Integrate current admission and pending-permission recovery fixes; then repeat real sign-in and upgrade journeys. Do not confuse a signed “no subscription” claim with explicit organization-credit availability |

PR conclusions and heads are snapshots in [open-prs.json](evidence/production-review-2026-10-23/open-prs.json). Check them again at merge time; this review did not merge, publish or close anything.

Issue hygiene is itself a release task: #378 is **closed**, but its body still says implementation/acceptance are open and contains unchecked final-qualification criteria. Many #394–425 implementation issues are closed while physical acceptance remains in the parent issues. Track “source implemented,” “component tested,” “installed accepted” and “release accepted” separately. Recover the final acceptance checklist under #381/#377 or reopen #378 with a clear remaining scope; do not infer product completion from its closed state.

## Confirmed defects and material gaps

Priority P1 means correct before the affected production promise; P2 means address during completion or explicitly bound the shipped behavior. Reproduced results are in [verification-summary.json](evidence/production-review-2026-10-23/verification-summary.json). The [counterexample runner](evidence/production-review-2026-10-23/reproduce-findings.mjs) reproduces F03–F05 without network or device effects.

### F01 P1 Production web cannot complete account and assistant journeys

**Evidence:** `runtime/browser-cloud-resident.ts:4` requires `import.meta.env.DEV`. `runtime/connection-ui.tsx:2606` renders the Android-only agent message. Browser inspection of the flag-off build confirmed Home → Inbox → Connect Eliza Cloud ends at “Eliza Cloud sign-in is available in the Alpha Phone Android app.” Workflows similarly says the agent runs on the phone. This is an intentional current restriction, but a direct gap against the requested full web mode.

**Fix:** define the shipping web runtime and account route. Until implemented, show capability-specific unavailable actions rather than inviting users into a dead-end connection dialog. Preserve working local Notes/Files. **Acceptance:** clean production build, real browser account return, account isolation, agent restart/history, stream cancellation, authorized Gmail and refresh/revoke. A DEV-only host or Android bridge stub does not pass this gate.

### F02 P1 Web Clear site data reports an operation it does not perform

**Evidence:** `browser/browser-surface.ts` implements `clearSiteData` by validating the current URL and returning `{site: hostname}`. `prototype/browser-adapter.ts:352–362` promises cookie/site-data deletion and sign-out, then displays success. `clearBrowsingData` closes frames and clears Alpha history but cannot clear an arbitrary remote site's browser-managed storage. The shared wording overstates that operation on web.

**Fix:** expose separate capabilities for Alpha history removal and provider/site-storage clearing. On web, disable the unsupported operation and direct the user to the actual browser's site controls. Do not weaken iframe isolation to gain storage access. **Acceptance:** production-web tests assert no cookie/sign-out claim or success receipt for a no-op; native tests independently verify real cookie/profile clearing.

### F03 P1 Release recovery gate accepts missing required evidence

**Evidence:** calling `channelDistributionProblems({recovery:{knownGoodRelease:{}},drills:{signedUpdate:'passed'}})` on main returned `[]`. The loop only checks supplied fields. This is a reproduced validator defect, not a claim that an actual incomplete release was distributed.

**Fix:** integrate #612, which requires all known-good identity fields, a SHA-256 and all four named drills. **Acceptance:** missing, blank, malformed, partially populated and extra-failed-drill cases fail; valid complete evidence passes. Other signing/image checks still apply.

### F04 P2 Maps can retain a false background navigation state

**Evidence:** `maps/background-navigation.ts:47–52` updates local instruction state and ignores `updateNavigation`'s `{active:false}` result as well as rejection. A controlled bridge returning inactive left `active()` true. `prototype/maps-adapter.ts:490–493` uses that flag to decide whether navigation continues while hidden. Native `AlphaMapsTransportPlugin.updateNavigation` explicitly returns false for an inactive session or update failure.

**Fix:** retire the owning session on inactive response, report foreground-only/stopped status, and reconcile failure through native session readback. Protect against a late response retiring a newer session. Only mark instruction text delivered after confirmation, so a transient failure can recover. **Acceptance:** inactive/rejected update, missed stop event, replacement, hidden transition and permission loss tests; physical screen-off guidance separately.

### F05 P2 Cloud Maps adapter leaks OSM identifier policy

**Evidence:** `maps/cloud-provider.ts` accepts only `/^[NWR][1-9][0-9]{0,18}$/` before requesting place details, while the shared `place()` contract accepts a bounded provider-specific string up to 512 characters. A controlled provider with a valid capabilities response and `opaque-place-123` reproduced a null detail result with only the capabilities request recorded. A future provider returning such a valid opaque ID would silently lose its detail request. Existing OSM behavior is not itself broken by this finding.

**Fix:** put provider-specific ID validation in the provider/backend or advertise its schema; the phone should transport bounded opaque IDs tied to the provider/session. Include padded-ID fixes from #611. **Acceptance:** OSM and second-provider fixtures, invalid/oversized/control-character IDs, owner changes and real detail readback.

### F06 P1 Release identity and native input admission are unfinished

**Evidence:** `android/release-signer.json` has `signerSha256: "unset"`; `android/aosp/pixel10a-ota-channel.json` has unset OTA/AVB/known-good identities and all four drills “not run.” A fresh strict main Android build stops at absent admitted voice outputs. No APK was produced by this local main attempt. Pending #614 reports further build/component progress, not a signed release.

**Fix:** integrate the qualified input work, make canonical native assets reproducibly retrievable, then establish controlled signing and image admission. **Acceptance:** four app artifacts, both test APKs, explicit profile and source/model/config hashes, signed release admission, image/OTA/recovery records. Do not relax the preflight to mark a build complete.

### F07 P2 Documentation can direct engineers back to retired work

**Evidence:** current `docs/mvp-current-status.md` still contains remaining items referring to pending decisions already made October 12, choosing a Maps provider despite approved Cloud ownership, and historical statements that no image had booted. `docs/architecture.md` describes active native patches while the reviewed `patches/eliza/native-manifest.json` has an empty patch list. The user's old checkout has even older remote-agent and Pixel 10/11 directions.

**Fix:** one generated current status table tied to source/profile/image; date and archive historical entries. Replace active instructions that conflict with current decisions, without deleting evidence. **Acceptance:** links resolve, issue status agrees with evidence classes, hardware is consistently Pixel 10a/Android 17, no proposed work is represented as shipped.

### F08 P2 Development dependency audit needs a current disposition

Fresh root `npm audit` found four affected packages: `undici` high; `uuid`, `xcode`, and `@capacitor/cli` moderate. `npm audit --omit=dev` found zero in the renderer production dependency graph. This does not audit the separately packaged resident runtime or Android/native dependencies, and does not establish exploitability of every advisory in this app.

**Fix:** update the owning dependency/lockfile compatibly or record a bounded, reviewed disposition based on the actually reachable build/test use. Keep the existing separate resident dependency audit and packaged SBOM. Do not run a blind force upgrade. **Acceptance:** reproducible install, source/browser/native checks, current audit snapshots and expiry for any exception.

### F09 P2 Test toolchain discovery is inconsistent

The first current-main `npm run verify` run failed three Java-backed cases because `JAVA_HOME` was unset: two tests fell back to nonexistent `/opt/android-studio/jbr/bin/javac`, and one asserted the environment must be set. The machine has JDK 21 at `/usr/lib/jvm/java-21-openjdk`. This is an environment/setup failure, not evidence that the recovery logic is wrong. Use one shared JDK discovery/preflight for tests and builds and document the Linux command before the first verification command. The full suite was rerun with explicit SDK/JDK variables; retain both outcomes.

## Simplification and consolidation

These are engineering improvements, not all reproduced bugs. Keep product policy local and move shared behavior only with external-consumer tests and a reviewed upstream commit or explicit authenticated patch.

| Area | Current evidence | Recommended change and boundary |
| --- | --- | --- |
| Renderer model/template | `prototype/model.js` 5,714 lines; `template.html` 4,424; JavaScript model represented as `ComponentType<any>` and `Record<string,any>` | Extract one view at a time into typed view models/components, starting Settings and connection UI. Preserve routes, drafts, scroll and event ordering. Avoid a simultaneous design/framework/state rewrite |
| Connection controller | `runtime/connection-ui.tsx` 2,692 lines combines state, service identity, admission, conversations, proposal recovery, history and UI | Separate service account controller, resident lifecycle, conversation transport, action reconciliation and presentation. Give each owned cancellation/epoch state; keep one public facade during migration |
| Adapter installation | `main.tsx` installs many wrappers that mutate shared component prototypes and view definitions | Explicit typed host hooks for mount/unmount, render projection, navigation and context. Add order/cleanup assertions, then remove monkey patches incrementally |
| Type coverage | Strict TS exists, but model/template and `any` escape hatches bypass much of it; backend/scripts are outside root tsconfig include | Define ShellState, ViewId, ViewDefinition, adapter lifecycle, native capabilities and discriminated results. Add a targeted TS config for backend/scripts; check JS incrementally rather than declaring a strictness flag that ignores the biggest model |
| Duplicate type | Identical exported `ResultInbox` in `runtime/digest-inbox.ts` and `runtime/hosted-background.ts` | One local contract export immediately; move generic durable-result inbox upstream only when shared consumers need it |
| Action/result types | `daily.ts`, `alpha-client.ts`, phone context, Java bridge and workflow protocols carry overlapping identity/status shapes | Reuse existing upstream device-action contracts. Separate genuine native handoff status from executed operation receipts; never collapse `opened`, `succeeded`, `unknown`, `cancelled` into one boolean |
| View/capability lists | AlphaView union, context allowlist, MVP sets, AOSP adapter list, native registration and agent profile each describe views | A typed product capability catalog generates presentation/types/test expectations. Native permission/image checks remain independent authority; generation is not a reason to trust renderer input |
| Dialog implementations | Inline React modals and numerous DOM-created dialogs repeat Back, Escape, focus, inert, visibility and abort management | One product review-shell primitive with content/footer slots, nesting rules and exactly-once resolution. Keep per-operation validation, consent and provider reread outside generic UI |
| Generic template engine | `dc-lite.js` includes product-specific substitutions for Files/Notes; `sc-for` keys rows by array index | Move display substitutions to view models. Add stable identity keys for reorderable/editable lists. Test focus, selection and draft ownership across insert/remove/reorder; index keys are a risk, not a demonstrated data-loss incident here |
| Styling | Extensive inline CSS, token overrides and small numerical dimensions | Extract repeated surface/button/input/status styles and spacing/type tokens. Generalize meaningful layout constraints, not every number. Preserve exact security/size/time bounds in owning contracts |
| Speech layers | `local-speech-playback.ts` and `prototype/local-speech-playback.ts` have different responsibilities despite same basename | Rename to owned playback transport and reply/read-aloud presentation. Consolidate cancellation/drain primitives upstream; retain Alpha route selection, permission policy and visible controls |
| Cloud transport | TypeScript policy, native routes, browser forwarding and account-bound request logic | Shared service contract/schema and parity fixtures for method/path/body/redirect constraints. Native remains a validation boundary. Keep environment and production product exclusions local |
| Deployment constants | `maps/basemap.ts` fixes OpenFreeMap imagery; exact service origins/path rules appear in platform transports | Centralize reviewed endpoint, attribution and capability configuration with native/browser parity tests. Keep explicit allowlists; do not generalize security policy into arbitrary caller-supplied URLs |
| Managed-service DTOs | Google/Gmail/subscription/Maps wire shapes and parsers live in consumer modules | Export narrow versioned browser-safe contracts upstream, with runtime validation and unknown-field/version behavior. Do not import a broad Cloud/UI barrel |
| Native adapters | Journal/reminders/calendar/secure-store/media already mostly shared, with Alpha wrappers | Continue existing extraction pattern. Candidate generic pieces: navigation lifecycle, installed-app catalog, selected-document/mail-attachment transport and bounded IPC. Keep package names, persisted filenames, manifest components and consent policy in wrappers |
| Legacy names | `hosted-*` modules now serve some local/resident digest paths | Rename concepts to schedules, results and source grants as behavior becomes clear. Delete only unreachable production hosted-agent branches; keep intentional test infrastructure gated. Names alone do not prove hosted execution |
| Backend | Only 10 composition files; policies and character are product-specific | Retain composition locally. Upstream generic schema/parser/transport functionality, not the entire backend directory or another product's identity |
| Build scripts | Repeated hash/path/regular-file and native staging checks | Consolidate pure validated manifest helpers after parity tests. Preserve separate source, APK, native-byte and image gates rather than one broad “verified” flag |
| Tests | Strong behavior suites coexist with many source-string guards | Retain structural guards for packaging exclusions. Prefer runtime/DOM/native tests for user behavior; migrate brittle formatting assertions when extracting code. Keep failure evidence and meaningful negative controls |
| Documentation | Numerous overlapping completion, scope, status and historical ledgers | Machine-readable current acceptance records generate one current report. Archive historical narratives by revision, link from current record rather than copying paragraphs |

Already-upstream work should **not** be reimplemented: Maps controller/contracts, Files/Notes feature projection, secure storage, Calendar/reminder contracts, notification delivery, voice turn/session primitives and native runtime code. `scripts/prepare-client-features.mjs` and the native staging manifests show the existing shared boundary. The empty current native patch list is a reason to preserve the pin workflow, not reintroduce local fork edits.

For new upstream extractions: first stabilize the local interface and tests, implement in an upstream branch, run owning and repository checks, publish the reviewed commit, update pin and manifest together, then prove the Alpha consumer using both APK variants. Preserve storage namespaces and migrations. Do not expose product restrictions as universal Eliza defaults.

## Design removal and copy reduction plan

Home is already largely visual, and production excludes developer controls. The largest remaining gains are Settings structure, unavailable actions, review layout and technical explanations. Do not replace everything with unlabeled symbols: unfamiliar operations need words, and color alone must never communicate approval, error or recording state.

| Surface | Remove or consolidate | Replacement | Retain visibly |
| --- | --- | --- | --- |
| First web visit | Android-only explanation modal repeated as the main entry | Open local Home directly; one compact capability notice with a useful setup/install action | Honest distinction between browser local apps and an available agent |
| Home cards | “Open to view” filler; duplicate Workflows affordances when no content exists; oversized empty agenda treatment | Compact empty state; show a next event or real status when available; consider collapsing empty cards | App labels and a discoverable All apps action |
| Accounts/Connections/Agent connection/Models | Four overlapping top-level destinations with related disconnected status | Account & AI containing identity, service access, runtime status and model detail; separate connected data sources underneath | Account identity, sign-out, genuine errors and whether AI is ready |
| Connections | “Other connectors — Not available in this version” | Remove unavailable catalog rows until supported | Gmail access and actual account state |
| Inbox empty state | Repeated “Connect Eliza Cloud” button and “Connect Eliza Cloud to use Gmail” text, especially when web cannot do it | One mail icon, short state and one actionable Connect Gmail button on supported hosts; truthful web alternative | Why content is unavailable, account identity on connected views |
| Workflows | Dense seven-filter strip before any items; blended runtime warning and “No automations yet” | One empty-state action; show filters only when useful; distinguish Reminders/Prompts/Workflows as real categories | Run state, next time, paused state and unknown outcomes |
| Scheduled digests | Several paragraphs explaining result checking, notification delay, source types and receipt mechanics | Source chips, schedule summary, last-result card; explanatory text in Details | Read scope, data destination, expiry and enabled state before consent |
| Ask before agent actions | Long On/Off paragraph at Settings root | “Review simple actions” plus one concise supporting line; detailed exceptions under information control | Sends/deletes/Calendar changes still require review; never imply a global approval bypass |
| Startup permissions | Repeated allowed/status explanations and “Your choices are saved” | Permission rows with icon, label and Allowed/Needs access state; one clear next action | Purpose before prompt, denied state, Settings/recheck recovery and incomplete save errors |
| Voice | Repeated technical route/provider explanations | One microphone, clear listening/speaking animation, Mute and Stop, optional transcript | Recording indicator and Cloud-upload disclosure in Cloud QA; accessible text state |
| Calendar availability | Prose describing range, source and privacy across several paragraphs | Date/time block, calendar chips and free/busy timeline; concise “Only these times are shared” | Actual selected sources, unknown/stale status, exact share scope and separate approval |
| Mail/action review | Long explanatory paragraphs surrounding operation data | Labeled account/recipient/body/file rows, attachment chips and a clear primary action | Recipients, attachment names/sizes, actual operation and ambiguous outcome warning |
| Maps | Permanent permission explanation and secondary technical controls in the central map panel | One short location state; Add location primary; manual coordinates in overflow; provider/coverage in details | Attribution and map-area disclosure; route failure distinct from tile success |
| Browser | Disabled find/read/autofill/clear actions that cannot work on web | Capability-based menu; “Open in browser” fallback | Actual origin, private state, trusted autofill boundary and navigation uncertainty |
| Settings privacy | Vague “Review” value | Concrete state such as “Permissions & local data”; one Reset Alpha entry | Reset scope, device confirmation and warning that remote/provider data is separate |
| Review headers | Repeating section name as eyebrow, title and introductory sentence | One descriptive title and concise content | Accessible heading/name and exact target identity |
| Technical diagnostics | Raw execution JSON and implementation terms in normal flows | Outcome summary; collapse debug fields under diagnostic details | Failed/unknown outcome and user recovery action |

These are proposed changes, not blanket deletion instructions. Several long paragraphs in the retained Browser template are reference fixture article content; they are not app chrome and must not be “simplified” as UI copy. Retain disclosure, source attribution, consent, unknown outcomes, error recovery, accessible names and meaningful app labels. Use icons plus labels for destructive or unfamiliar actions, not icon/color-only confirmation.

Use before/after screenshots for each affected surface at narrow portrait, short landscape, keyboard-open and 200% text. Verify TalkBack/keyboard reading order, minimum touch targets, focus return and reduced-motion behavior. Screenshots captured mid-transition should not be reported as stable visual defects.

## Performance and reliability work

The fresh flag-off build produced an entry JavaScript file of **3,892,601 bytes minified**, plus **159,656 bytes CSS**; the output directory occupies approximately **28 MiB** on disk. These are artifact sizes, not compressed network transfer or measured startup latency. PDF, video and Maps workers add their own loading costs.

1. Capture cold/warm startup, time to usable Home, first app open, route change, chat typing latency and memory on Pixel and a throttled browser. Record downloaded versus parsed bytes.
2. Lazy-load heavy Maps/media/OCR/PDF code at the feature boundary. Avoid static imports elsewhere defeating the split. Keep camera/photo/PDF feature error handling recoverable if a chunk fails.
3. Split the connection screen/controller by responsibility; avoid making UI extraction start duplicate lifecycle subscriptions or recreate sessions.
4. Profile model/template rendering and full render-value recomputation before memoization. Stable list identity and narrower state updates matter more than arbitrary memo wrappers.
5. Set measured budgets in CI for entry bytes and critical timings. Suggested initial improvement target: materially reduce entry bytes from this baseline while keeping Home and Notes usable during network failure. Choose numeric latency/memory budgets from device measurements, not file-size intuition.
6. Add bounded timeout/readback and visible recovery for long operations. Preserve cancellation generations and unknown-write semantics. Never retry a possibly executed send/delete simply because its response was lost.
7. Retain a coherent offline story: local tool use, local speech for native profile, cached state labeled with freshness, and explicit managed-service unavailability. Do not claim all inference or providers work offline.

## Execution plan

The order below separates prerequisites from independently executable work. Effort bands are planning estimates, not commitments: S is a focused change, M is several days of implementation/testing, L is a multi-stage integration or qualification campaign. Hardware/service availability determines calendar time.

| Work package | Priority / size | Concrete deliverable | Dependencies | Exit condition |
| --- | --- | --- | --- | --- |
| W01 Reconcile sources and evidence | P1 / M | Triage each local changed/untracked path against main and pending PRs; preserve unique work; one current evidence manifest | None | Reproducible candidate with no unexplained old scope or input mismatch |
| W02 Integrate current fixes | P1 / M | #612; #611 before #614; reconcile #613; #615 | PR review/checks and exact artifacts | Fresh combined-source verification and both variant builds; no claim transferred from an earlier head without equivalence |
| W03 Correct web capability promises | P1 / M | Fix F01/F02 UI; explicit production web runtime/auth specification | Product web contract | No dead-end advertised sign-in/agent path; supported local flows work; unsupported controls truthful |
| W04 Deliver production web runtime | P1 for full-web promise / L | Supported local companion or feasible browser runtime, authenticated service binding and durable history | W03; shared host contract | Real production browser assistant/Gmail journey, account switch, restart, offline and revoke |
| W05 Maps service and navigation | P1 / L | Provision production coverage; fix F04/F05; complete route/detail/modes and navigation | #410/#412 service owner, reviewed provider data | Live authorized route plus physical navigation/stop/coverage/outage acceptance |
| W06 Account, billing and Gmail | P1 / M–L | Current admission, sign-in/permissions, Gmail grants, attachments/send/readback | W02; owned service account/config | Real account with wrong/expired/revoked and ambiguous-write cases; no credential leakage |
| W07 Native speech and listener | P1 / L | Reproducible admitted assets; installed native audio/latency; listener image integration | W02; canonical model/ABI bytes, Pixel | Barge-in/stop, both ABI execution, physical audio/thermal/battery and indicator acceptance |
| W08 UI simplification | P2 / M | Settings consolidation, empty states, compact reviews, visual status and progressive details | Stable capability contract | Before/after visual and accessibility acceptance, no loss of consent/recovery |
| W09 Typed architecture extraction | P2 / L in increments | Split controller, typed Shell/View interfaces, common review lifecycle, shared DTOs | Characterization tests; W02 | Per-slice behavior parity; no new lifecycle/order/draft regression |
| W10 Payload and startup | P2 / M | Measured lazy-loading and render reductions | Baseline metrics; W09 where useful | Smaller entry/less startup work with cold/offline chunk failure tests |
| W11 Native daily-tool qualification | P1 / L | Notes/Calendar/Clock/Browser/Files/Photos/permissions/notifications/SMS campaigns | Current packaged candidate, disposable emulator and owned device | Continuous UI plus native/provider readback on both distributions and AOSP where applicable |
| W12 Controlled release | P1 / L | Signer/channel, signed APK/image/OTA, known-good recovery, pilot/support record | W01–W07/W11; release owner | Update/interruption/rollback/recovery and target-user acceptance on exact signed candidate |
| W13 Evidence and CI cleanup | P2 / M | Current ledger, retained manifests, focused tests, cross-browser coverage and dependency disposition | Can start immediately | Gates represent required executed behavior; no skipped/unrun gate promoted to pass |

Do W01/W02 first. Work on web capability fixes, Maps provisioning, signing preparation and UI reductions can then proceed independently. Keep high-risk native protocol changes separate from visual cleanup. Do not make every refactoring a release blocker: defer broad model replacement and registry packaging if the scoped fixes and qualification can establish a reliable release sooner.

## Work that can be completed with tools

| Method | Useful work now | Boundary |
| --- | --- | --- |
| Source editing and automated tests | F02/F04/F05, contract/type cleanup, dialog extraction, production menu guards, copy reduction, build/preflight scripts, release validation, docs/evidence | Fastest for deterministic behavior. Add tests for actual failure modes, not assertions that merely copy implementation text |
| Browser use | Real rendered Home/Settings/Inbox/Notes/Calendar/Maps/Workflows flows, keyboard and Back, disconnected/empty/error states, responsive inspection, screenshots | A DOM/native-bridge stub does not prove Android behavior. Synthetic provider success does not prove Gmail or Cloud |
| Local browser test suite | Production flag-off journey regression and mock exclusion; isolated fixtures for loss/revoke/late callbacks; Firefox/WebKit storage | Current Firefox/WebKit projects cover storage, not the entire product; expand critical cross-browser sign-in/media/cancellation paths if web ships |
| Emulator plus ADB/instrumentation | Install exact standalone/launcher pairs; HOME role, process death, runtime bridge, permission denial, SAF, local-model playback and notification taps | Use an owned disposable emulator; retain original HOME and restore state. SDK emulator is not Cuttlefish or physical hardware |
| Native computer use | Permission dialogs, native browser/autofill, Clock, photo picker, system shade, keyboard and TalkBack visual checks | Native computer APIs are disabled in this session; no connected ADB device was present. Automation scripts remain executable when an owned device is available |
| Cuttlefish builder | Build/boot the exact image, validate SELinux/VINTF/roles, listener/SystemUI integration and packaged identity | Requires actual AOSP tree/resources and output image. Staging an add-on or booting an SDK emulator is insufficient |
| Physical Pixel 10a | Microphone/speaker/barge-in, calls/SIM/MMS, camera/GPS, suspend, hardware keys, AOD, thermals and recovery | Must use owned accounts/endpoints and a controlled image/device campaign. Cannot be inferred from component fixtures |
| Service/release owner | Production Maps deployment, billing limits/cost data, OAuth consent/domain/signing configuration, managed signing and release channel | Prepare code/config/runbooks first. Account grants, real sends, purchases, device flashing and release publication are distinct operations, not implied by a review request |

Computer use is especially valuable at the boundaries that test doubles skip: operating-system permission screens, real account returns, browser rendering restrictions, TalkBack focus, default-app roles, Clock handoff, notifications, and recovery. It should complement typed tests and provider readback rather than replace them with screenshots alone.

## CI gates that need distinct interpretation

The current Android foundation workflow runs `android:build -- --allow-unpackaged-runtime --skip-instrumentation`. Its success is useful compilation/packaging evidence for a developer artifact; it is not release admission. The resident Cloud profile deliberately skips native/recovery qualification jobs. Firefox/WebKit storage jobs run only on explicit dispatch. Browser screenshots/traces and Cloud build archives have short retention, so copy the exact release manifests and required evidence into durable release storage before they expire.

Require a separate release-candidate result that enumerates signed standalone and launcher APKs, native default profile, current admitted voice/embedding/runtime bytes, owned emulator campaigns and the exact image/service/device gates. It must reject missing or skipped required results. Keep the fast foundation lane; do not relabel it as the release lane. Promote a frozen combined commit after PR integration, not a collection of individually green PRs.

## Required continuous acceptance journeys

Each campaign must identify Alpha SHA, Eliza SHA, native/model hashes, runtime profile, mock flag, APK SHA/certificate/version, device/image fingerprint, provider environment and test data ownership. Preserve raw failure evidence. Classify results as source, APK build, emulator, full image, real integration, physical device and user acceptance.

1. **First run and return:** install/start → account sign-in → permissions including denied/recheck → Ready → Home → typed request → real answer → background → kill/reopen → exact account/history/draft. Repeat expired, wrong account, offline and permission setup interrupted by restart.
2. **Voice conversation:** explicit start → real mic → hesitation/endpoint → actual answer/playback → barge-in before dispatch/during inference/during audio → Mute/Stop → navigate/rotate/background → no stale audio or duplicate turn. Separate Notes dictation. Measure last speech sample to first audible response over at least 50 simple queries; retain cold/warm p50/p95, failures and thermals.
3. **Notes/Files/Photos:** create/edit/reopen → selected document/photo → ask/attach only after review → draft restart → attachment removal → Trash/Undo/expiry → permission/revision change. Verify exact source bytes, not thumbnail bytes or fixture text.
4. **Calendar/reminders/Clock:** create reviewed item → provider readback → modify/recurrence → delete/Undo → process death around expiry → time-zone/DST → Doze/reboot/missed occurrence. Separately observe Clock creation, audible firing, snooze and dismissal.
5. **Gmail:** sign in → select account/grant → read/unread/archive → compose/reply/forward with owned test recipients and exact attachments → review/send → provider readback → response loss/reconnect → no duplicate send. Revoke/switch accounts during every pending stage.
6. **Browser/passwords:** public page → normal/private profiles → redirect/frame/popup → trusted provider fill → cancel/lock/wrong-origin → download/read-aloud → return → restart → clearing. Use controlled real sites, then target websites. Web iframe behavior is a separate test, with external handoff where embedding is refused.
7. **Maps:** Calendar address → place/search/details → select mode/route → explicit location → start → background/lock → reroute/stale GPS/coverage boundary → stop from notification → return. Verify rate limits, owner changes and provider outage. Map tile rendering is not route success.
8. **Workflow:** author → validate → save paused → exact source/trigger review → enable/run → approval → result/notice → restart/owner A→B→A → quiet reappearance only if still valid → cancellation/unknown outcome → no replay. Powered-off missed events must remain distinguishable from Doze delay.
9. **AOSP system:** admitted image → Contacts/Phone/SMS roles/SIM → owned call/text/MMS handoff → emergency fallback → shade/Home/assistant → secure camera → listener consent/indicator/privacy/stop → calls and lock coexistence. Standalone and sideloaded launcher must reject image-only actions.
10. **Release and reset:** previous signed version with data → update → migration → interrupted update → known-good recovery/compatible rollback → confirmed local reset → no worker/listener resurrection of data. Verify remote Gmail/subscription and shared media remain outside local-reset scope.

The six skipped node checks in this review cover four pinned AOSP/SystemUI source checks, the resident SDK Cloud-base check and the Cloud audio file-type classifier without its prepared dependency. Run them with their actual prerequisite trees/dependencies before claiming those contracts.

No production gate is satisfied by an unexecuted test, a successful fake provider, “opened” instead of provider completion, a skipped native scenario, or an unsigned artifact.

## Fresh verification and limitations

The machine-readable [verification summary](evidence/production-review-2026-10-23/verification-summary.json) is the terminal record for this review; logs are retained in the same directory. It distinguishes this checkout from the isolated current-main tree.

- User working tree: `npm run verify` passed 275 tests, typecheck and Vite build. Android build first needed explicit Linux SDK/JDK environment; after supplying it, Gradle failed at `:app:stageLocalAgentSources` because the prepared runtime Git source had no valid HEAD. Both APK variants remain unbuilt by that attempt.
- Current main: strict `npm run android:build` correctly refused missing admitted on-device voice outputs before Gradle. The SDK/JDK exist locally, but do not supply those source-bound native assets.
- Current main `npm run verify` passed with explicit JDK/SDK environment: **1,796 passed, zero failed, six skipped**; typecheck, the synthetic Notes flow, Vite build and production bundle audit passed (408 files, test mocks off). The initial unset-JDK run and its three environment failures remain recorded.
- Current main production browser was inspected through actual rendered controls. The full flag-off Chromium browser lane passed **305 tests in 7.6 minutes**, zero failures. Controlled native-bridge/provider fixtures in this lane do not establish real account, native device or image behavior.
- An initial working-tree browser sweep was invalidated by a dependency reinstall overlapping execution and stopped. Its worker parse errors are not classified as product bugs. The isolated main install completed before its test lanes started.
- No connected ADB device was available. No fresh emulator HOME-role, Cuttlefish image boot, physical-device, real-provider write, live microphone or signed-release acceptance was performed in this review.
- GitHub run [39918054977](https://github.com/AlphaCompute/alphaphone/actions/runs/39918054977) records a successful main Cloud-profile APK build. It is existing hosted evidence for that profile/source, not a fresh native-profile or device pass. Pending #614 contains newer component/build evidence for its own candidate.

Production release should remain blocked until the required journeys pass on one admitted signed candidate, with real service coverage and an explicit supported web contract. UI and architectural cleanup should make that candidate smaller and easier to reason about while preserving the existing ownership, consent, cancellation and durable-receipt safeguards.
