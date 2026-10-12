# Alpha Phone — working PRD

Version: 0.4, 2026-10-12. Product scope is approved through the owner's 32 answers.
[Decisions](decisions.md#october-12-owner-decisions) and the
[implementation plan](implementation-plan.md) supersede older scope/defaults.
This is a requirements document, not acceptance evidence. [Sources](sources.md)
retain prototype and upstream provenance.

## Outcome

A personal agent phone with an independent Alpha Compute UI, locally resident
orchestration, local speech and useful native tools. Eliza Cloud supplies managed
inference, subscription, Gmail and Maps services; it never hosts Alpha's agent.
Keep prototype styling and identity separate from real data/capability claims.

## Users and primary journeys

1. Unlock the actual OS, open Alpha/installed apps and retain task context.
2. Start the local agent; sign in only for managed services. No hosted-agent pairing.
3. Dictate into an editable draft, or enter an interruptible local-speech conversation.
4. Use Gmail in either distribution and Phone/Contacts/SMS only on the AOSP image.
5. Query the full permitted photo library and control Maps through agent tools.
6. Inspect and approve effects, recover from interruption and reset local Alpha data.

## Scope and requirements

| ID | Requirement | Priority / acceptance |
| --- | --- | --- |
| AP-01 | Distinct branded Home, library and assistant with independent identity | P0; real navigation, app discovery, one Android shade and launcher Home swipe |
| AP-02 | Standalone and launcher packaging; Alpha AOSP capability distinct from flavor | P0; four APKs, offline shell, stock settings/recovery and no AOSP-only tools in standalone |
| AP-03 | Owner-bound Eliza Cloud service sign-in and subscription entitlement | P0; local-only agent, no provisioning/pairing, expiry/revoke/isolation and no per-turn billing network hop |
| AP-04 | Resident orchestration, state, tool approvals and powered-on scheduling | P0; hosted text inference disclosed, no hosted agent, missed occurrences and no duplicate effects |
| AP-05 | Compact/full assistant, keyboard, navigation and responsive continuity | P0; drafts, focus, scroll and tasks survive layout and lifecycle changes |
| AP-06 | Always-local native STT/TTS; separate dictation and voice-assistant modes | P0; Clef semantic/long-gap endpoint, automatic conversation submission, barge-in; true last-input-to-first-audible latency; AOSP always-on listening and hardware invocation included |
| AP-07 | Daily overview, agenda, attention and resident briefs | P1; actual sources, freshness/empty/error states; phone-powered-on schedules only |
| AP-08 | Phone, SMS/MMS and Contacts only on Alpha AOSP | P0 AOSP; real native providers/roles, owned carrier endpoints, emergency system access; hidden and capability-gated elsewhere |
| AP-09 | Gmail, Calendar and reviewed cross-app mail attachments | P1; incremental Gmail scopes, real delivery, availability semantics, durable deletion Undo and source/account isolation |
| AP-10 | Browser, camera, full permitted Photos, Cloud Maps, Notes and Files | P1; normal third-party cookies allowed, ephemeral private tabs, eligible autofill, native secure camera, agent Maps controls, local speech, Notes three-day Trash; no app-data import/export |
| AP-11 | Resident workflows, approvals and run history | P1; bounded permissions, durable receipts, missed recovery, owner-return notices and no powered-off execution |
| AP-12 | Settings, subscriptions, permissions, local voice, system shade and reset | P0; truthful state, responsive controls, no backup/import/export, confirmed private-data reset |
| AP-13 | Wallet | Deferred: removed from MVP; views, native adapters and agent actions remain disabled in both distributions |
| AP-14 | Pixel 10a Android 17 image, signing, listening and update/recovery | Release gate; exact input/signer lock; Cuttlefish boot and physical hardware/OTA/user qualification separate; Shaw release owner |
| AP-15 | Accessibility and resilience across intentional responsive layouts | P0; large text, TalkBack, keyboard, rotation, process death, permission loss, offline and repeated HOME |

## Explicit limits and decisions

All 32 choices are resolved as policy; implementation TODOs remain open in the
[approved backlog](owner-approved-mvp-plan-2026-10-12.md). P-01 and P-07 are superseded:
manual send applies to dictation, conversation voice submits automatically, and no
Cloud speech route remains in the product contract. Local speech does not imply an
offline language model. Hosted inference receives disclosed selected context.
Full photo access is local permission scope, not bulk Cloud upload authorization.

Passkeys, Telegram, Discord and Wallet are outside MVP. No app-data migration,
backup or import/export workflow is planned. Ordinary Files and attachment operations
remain. Secure camera, Clock, shade and emergency facilities remain native/system
surfaces. Always-on listening is an AOSP MVP gate and never implicitly enabled.

## Current implemented versus accepted

The source still contains behavior that differs from this policy, including Cloud
speech selection, credit-oriented onboarding and deferred Phone/SMS/Contacts. The
approval itself changes no runtime or qualification record. Use
[current status](mvp-current-status.md), [requirements.json](requirements.json),
[verification](verification.md) and each TODO for implementation gaps and evidence.
APK builds, native emulator/HOME checks, full AOSP boot, real services, physical
hardware and user acceptance remain distinct. No existing failure is retired by
changing the prose.
