# CI cost and qualification policy

## Automatic checks

Pull requests run the affected lanes below. A full Git diff includes deleted files
and both sides of renames. Missing history, unknown paths and shared dependencies
select all lanes; they never silently skip checks. No GitHub file-list API or its
300-file path-filter limit is used. Reference-only changes start small selection
jobs but allocate no build/test runners. Reference files that node tests read
(`testReadReference` in `scripts/ci/affected.mjs`: dependency-audit dispositions and
snapshot, requirements and inventories, this policy's embedded ruleset, and the
Markdown that `test/docs-links.test.mjs` scans) select Repository verification only.

| Changed input | Repository verification | Chromium + production browser | Android build | Resident preparation |
| --- | --- | --- | --- | --- |
| AGENTS, design references, docs/market-research | No | No | No | No |
| README and docs that node tests read (all docs/*.json, docs Markdown checked by docs-links) | Yes | No | No | No |
| Host tests | Yes | No | No | No |
| Browser specs/configuration | Yes | Yes | No | No |
| Renderer, including assets | Yes | Yes | Yes | No |
| Android packaging/native sources | Yes | No | Yes | No |
| Shared source pin, dependencies, unknown paths | Yes | Yes | Yes | Yes |
| Individual workflow | Yes | Its automatic lane | Its automatic lane | Its automatic lane |

Existing browser-spec-only edits select exact changed spec paths. Up to three
development spec files use one shard; larger edits use four parallel shards. Production-only specs run just the production project; development-only
specs skip production and unrelated speech-profile qualification. Shared helpers,
deleted or renamed specs, application code, dependencies and unavailable diffs keep
the full inventory. File selectors are validated and escaped, then passed as process
arguments without a shell. This shortcut changes test scope only when no executable
application/shared input changed.

The production browser server audits the exact freshly built flag-off bundle before
serving it. CI no longer builds a second unused flag-off bundle in that job. The
separate test-mocks bundle still receives its own audit.

Repository verification runs once in parallel with Chromium's four shards and
Android, instead of four times per event. Browser shards remain parallel; a failing matrix cancels siblings to limit wasted minutes.
On October 8 the owner requested removal of all smoke tests and checks. The aggregate
smoke runners, their emulator CI jobs, the provider diagnostic job and smoke-only APK bundles
are removed. Two emulator jobs remain, `native` and `recovery-ui` in
`.github/workflows/resident-android.yml`; they run only on an explicit dispatch or when
the repository variable `ELIZA_RESIDENT_QUALIFICATION` is `push` or `nightly`, and no
passing run of either is recorded for the current source. Round 8 added
`.github/workflows/android-emulator.yml`, whose three emulator jobs have no trigger but
`workflow_dispatch` and run only the suite the dispatch names (see "Explicit, expensive
qualification"); none of them has been dispatched. Distribution APK builds, repository checks and browser regression tests remain.
`.github/workflows/dependency-audit.yml` runs the network advisory audit weekly and on
dispatch (one short hosted job, read-only, no secrets; docs/dependency-audit.md). It is not a
required check, and a change to it selects Repository verification only.
Main pushes run affected repository verification, including the production bundle
audit, and the affected Android foundation build of both variants, so a merge that
breaks packaging is visible on the exact main commit. They do not repeat PR browser
shards. Each main push runs in its own concurrency group, so a later push neither
cancels it nor drops it while queued; PR runs still cancel superseded runs. Resident
push and nightly runs use their own groups too and never cancel a dispatched run. The repository ruleset requires PRs.

Round 10 added no job, step or network access to any run. Gradle dependency verification
(`android/gradle/verification-metadata.xml`) is enforced by the Gradle build the Android
foundation job already runs; its offline check and the SBOM tests are part of `npm test`;
and the build writes `artifacts/sbom/alphaphone.cdx.json` offline, uploaded with the
existing build evidence. Rewriting the metadata (`npm run android:deps:write-verification`)
is a local command and is never run by a workflow.

The production browser project runs `test/browser/production-surface.spec.ts` and every
`test/browser/<name>.production.spec.ts` against the flag-off build. A package that
adds a flag-off assertion adds such a file; no configuration change is needed.

## Required checks

Browser shard names depend on the selected shard count, and skipped matrix jobs
report unexpanded names, so the shards cannot be required directly. Each workflow
therefore ends in a stable aggregate job: **Browser MVP result** (needs the change
gate, Repository verification, every Chromium shard and the production surface)
and **Android foundation result** (needs the change gate and `build`). An aggregate
passes when every lane the change gate selected succeeded and unselected lanes were
skipped; a selected lane that failed, was cancelled or was skipped fails it
(`scripts/ci/required-result.mjs`). Reference-only changes therefore stay mergeable
with only the change gate and the two short aggregate jobs.

The ruleset below (`scripts/ci/required-checks-ruleset.json`, integration 15368 is
GitHub Actions) requires those two aggregates and Repository verification on the
default branch. It was written as additive to the AlphaCompute "Default branch
baseline" ruleset (PR required, no deletion or force push); that ruleset did not move
with the repository to eliza-research, where on October 28 `main` had only classic
protection against force push and deletion (docs/runbooks/679-main-required-checks.md). Up-to-date branches are not required:
that would force a rebase and full rerun of every open PR after each merge. A
semantic conflict between two green PRs is instead caught by the main-push
verification and Android build. Applying it changes repository settings and needs
the owner's explicit approval; it had not been applied when this was written.

```json
{
  "name": "Main required checks",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": {
      "include": ["~DEFAULT_BRANCH"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "Repository verification", "integration_id": 15368 },
          { "context": "Browser MVP result", "integration_id": 15368 },
          { "context": "Android foundation result", "integration_id": 15368 }
        ]
      }
    }
  ]
}
```

```sh
# Owner-approved only. Creates the ruleset; it does not modify the baseline ruleset.
gh api --method POST repos/eliza-research/alphaphone/rulesets --input scripts/ci/required-checks-ruleset.json
# Confirm:
node scripts/ci/read-required-checks.mjs --repo eliza-research/alphaphone
```

Android still checks both standalone and launcher, debug and release outputs and
flag-off production isolation. Renderer changes select Android because renderer
bytes are packaged into APKs. Gradle dependency/build caching reduces repeat setup;
speech sources/models retain hash verification and generated native speech is still
built fresh. No unverified generated runtime cache replaces qualification.

`node scripts/verify-upstream.mjs` also reports whether elizaOS `develop` reaches
the pin, from the recorded compare in `scripts/ci/upstream-reachability.json`; CI
never networks for it. The default warns; `--upstream-reachability=fail` or
`ELIZA_UPSTREAM_REACHABILITY=fail` makes an unreachable or stale record fail, and
`off` skips it. Refresh the record after a pin change with
`node scripts/verify-upstream.mjs --record-reachability` (uses `gh api`).

## Eliza develop pin sync

`.github/workflows/eliza-pin-sync.yml` keeps the shared SDK pin on elizaOS/eliza `develop`,
so the pin cannot drift onto a branch only Alpha uses. It is a source-only draft that becomes
active when this file reaches `main`. Every hour (minute 41), on a manual dispatch and on a
`repository_dispatch` of type `eliza-develop-updated`, it runs these jobs:

| Job | Grants | Runs |
| --- | --- | --- |
| Develop pin status and incident guard | `contents: read`, `pull-requests: read` | `node scripts/eliza-pin-sync.mjs status` (`gh api` reads) and, when develop has moved, `guard`, from `main`'s checkout |
| Repin (read-only) | `contents: read` | `npm ci`, `vendor/eliza` at the develop head, `apply`, the owning scripts and the pin-bound tests; uploads a bundle |
| Publish the pin PR | `contents`, `pull-requests` and `actions`: `write` | git and gh in shell only: checks the bundle, pushes the bot branch, opens or updates the PR, dispatches its checks |
| Close the superseded pin PR | `pull-requests: write` | gh only, when `main` already pins develop |
| Drift report | `contents: read`, `issues: write` | `node scripts/eliza-pin-sync.mjs drift-report` from `main`, only with `ELIZA_PIN_SYNC_DRIFT_ISSUE` set |

**Incident guard.** Before anything from develop is fetched into a checkout or run, the status
job decides whether the move is clear of the 2026-10-27 forged-commit incident (#658). It fails
closed: every outcome but a full clearance is a hold, which it reports in the run summary (and the
drift report) with its specific reason, and which stops the repin. A hold is not a failure: the
run stays green so a lasting hold sends no failure mail, and the next run checks again.

- `ancestry-unavailable`: `scripts/ci/upstream-incident-clearance.json` has no valid entry for the
  upstream repository, or its history cannot be read. An entry is the complete set of forged
  commits known for that repository, as full commit IDs (`[]` only when the record that
  established the set found none), plus that record. The file starts with no entries, so the
  sync holds today before it fetches anything; only a reviewed change to `main` adds one.
  Commit author or committer identity is never clearance.
- `reaches-forged`: develop reaches one of those commits, or a short ID the IOC file
  (`scripts/owner/incident-2026-10-27-iocs.json`) records for the repository.
- `receipt-mismatch`: git and the compare disagree on how many commits the move includes or drops.
- `nested-repository`: the move changes a gitlink inside elizaOS (the llama.cpp engine, as #777
  did). The guard does not clear another repository's ancestry, so a person repins that move;
  `node scripts/eliza-pin-sync.mjs apply` still moves the engine identity
  `scripts/combined-agent-source.mjs` admits.
- `payload-marker`, `payload-unavailable`: a path, `package.json` script or added line in the
  move matches the incident's payload markers (the patterns `scripts/owner/forged-branch-scan.mjs`
  uses), or the change could not be read.
- `multiple-prs`, `guard-error`: more than one open PR comes from the bot branch, or the guard
  itself failed.

The guard reads upstream git objects only, never into a checkout: a commit graph without trees
(`--filter=tree:0`) and the two pinned trees without blobs, plus the blobs of the changed files
it scans. It produces the PR's receipts.

**Repin.** When the guard clears the move, the read-only repin job rebuilds the change from the
current `main` with the steps of the manual pin commits (#777, #779):

- moves the literal pin fields (`upstream.lock.json`, the `vendor/eliza` gitlink,
  `scripts/ci/calendar-bridge.py`, the voice host record and the remaining-work inventory) and
  each patch manifest whose targets are unchanged at the new pin;
- writes `docs/evidence/sdk-<short>-build-input-admission-<date>.json` over the previous
  record's paths, then rolls the voice host comparison and the embedding host's open
  requalification forward;
- re-records `scripts/ci/upstream-reachability.json` with
  `node scripts/verify-upstream.mjs --record-reachability` (the job's read-only token reads the
  compare), re-audits with `node scripts/dependency-audit.mjs --resident --write` and
  regenerates the notices with `node scripts/generate-licenses.mjs`;
- moves the resident dispositions only when the fresh audit reproduces every finding, and names
  the new pin in `docs/requirements.json` and `docs/mvp-current-status.md`.

It runs `verify-upstream` in fail mode, the notices check and the pin-bound record tests on
`main` first and again at the new pin; only a check that passes on `main` and fails at the new
pin blocks the PR. Its report lists what **Needs a person**: commits on the current pin that the
move drops, a patch whose target changed upstream, a changed mobile UUID builder, a resident
audit with new findings, a native input change under an admitted host, or a failed check. It
commits only tracked records and the new evidence file, and uploads a git bundle of that one
commit, the report, a ready flag and a manifest of every changed path with the SHA-256 of its
new content. Because `verify-upstream` and those tests import `vendor/eliza` code at the develop
head, this job holds no write grant, restores and saves no cache, and its token can only read.

**Publish.** The publish job never checks out this repository and runs no npm, node or vendor
code. With git alone it fetches `main` and accepts the bundle only when it is one commit whose
parent is `main`'s current head (a `main` that moved during the repin publishes nothing; the
next run rebuilds), every changed path is on the record allowlist (`RECORD_PATHS` in the
workflow, `RECORD_RULES` in the script) and keeps to its rule, `vendor/eliza` moves to exactly the
develop head the status job read, at most one build-input evidence file is added, every path is
a regular file, and the manifest matches. Files with the `ids` rule (the lock, the patch
manifests, the inventory, `scripts/ci/calendar-bridge.py` and
`scripts/combined-agent-source.mjs`) may differ from `main` only in 40- or 64-character hex IDs;
the `data` records are generated content a person reviews in the PR. The workflows, the
clearance record, the IOC file and every other path are refused, and a refusal fails the run.
The job then commits the checked tree itself as `github-actions[bot]`, so the commit message and
identity on the bot branch are its own.

Its one push is a `--force-with-lease` to `bot/eliza-pin-sync`, which
`test/ci-emulator-evidence.test.mjs` pins; nothing pushes `main`. Before pushing it looks up the
one open PR from the bot branch: two are refused, and so is a PR with auto-merge on. It then
opens or updates **Pin Eliza develop <short>**, whose body starts with the status job's
receipts: the develop head read and when, the old and new pins and `main` as full commit IDs,
the compare, the guard's clearance, the included and dropped commit lists with the SHA-256 of
each (`git rev-list --reverse <a>..<b> | sha256sum`), and the drift numbers and thresholds. The
repin report follows as text, since the job that wrote it ran develop code. Only when that report
needs nobody does it dispatch Browser MVP and Android foundation on the bot branch (a
`GITHUB_TOKEN` push starts no `pull_request` run); both build and test with `contents: read`,
and their workflow files on the bot branch are `main`'s, because the allowlist refuses
`.github/`.

The sync never merges a PR: no step, variable or input can turn on auto-merge or merge, and a
person reviews and merges each pin PR. It updates no running app: it deploys nothing and
dispatches only those two checks. `test/eliza-pin-sync-workflow.test.mjs` pins the grants per
job, that the publish job runs no node or npm, the allowlist (by running the publish job's own
checks against throwaway repositories with only git and shell tools on `PATH`), and the absence
of any merge or deploy path.

**Drift report.** Every run writes drift (the pin on `main` more than
`ELIZA_PIN_SYNC_DRIFT_COMMITS` commits or `ELIZA_PIN_SYNC_DRIFT_DAYS` days behind develop) and
any hold to its run summary. With `ELIZA_PIN_SYNC_DRIFT_ISSUE` set, the drift job keeps one
comment on that issue: it is created only when drift or a hold first appears, and edited only
when the drift state or the hold changes, never on a lasting state, so the sync starts no
message loop. A run that did not reach the guard keeps the last reported hold.

A scheduled rebuild waits until the PR is `ELIZA_PIN_SYNC_REFRESH_HOURS` old (default 6), so
full CI runs on it at most about four times a day; a manual dispatch rebuilds at once. The
hourly check is about one runner-minute, and a hold without clearance fetches nothing; a cleared
guard adds a few seconds of git fetches, and a rebuild is roughly 10 to 20 minutes (npm ci without
a cache, the 1 GB vendor fetch and the scripts above).

| Repository variable | Default | Effect |
| --- | --- | --- |
| `ELIZA_PIN_SYNC` | unset | `off` pauses the schedule and repository dispatches; a manual dispatch still runs |
| `ELIZA_PIN_SYNC_DISPATCH_CHECKS` | unset (on) | `false` stops dispatching Browser MVP and Android foundation |
| `ELIZA_PIN_SYNC_REFRESH_HOURS` | 6 | Minimum PR age before a scheduled rebuild |
| `ELIZA_PIN_SYNC_DRIFT_COMMITS`, `ELIZA_PIN_SYNC_DRIFT_DAYS` | 50, 2 | Drift: the pin on `main` is more than this far behind `develop` |
| `ELIZA_PIN_SYNC_DRIFT_ISSUE` | unset | Issue number for the one drift report comment; unset keeps drift and holds in the run summary |

```sh
# Pause (a manual dispatch still works), resume, or stop the workflow entirely.
gh variable set ELIZA_PIN_SYNC --body off -R eliza-research/alphaphone
gh variable delete ELIZA_PIN_SYNC -R eliza-research/alphaphone
gh workflow disable eliza-pin-sync.yml -R eliza-research/alphaphone
# Rebuild the PR now, or repin and check in the runner without pushing.
gh workflow run eliza-pin-sync.yml -R eliza-research/alphaphone
gh workflow run eliza-pin-sync.yml -R eliza-research/alphaphone -f dry_run=true
```

Limits. GitHub cannot limit `contents: write` to one branch; the publish job's single push line,
its checks and the absence of node there are what keep `main` out of reach, since `main` has no
required reviews or checks. Develop code in the repin job could still use that job's read-only
token and could write workflow cache entries in `main`'s scope, which other workflows restore;
none of those holds a write grant, and no job of this workflow restores a cache. A pin move is
source metadata only: it admits no native bytes and transfers no APK or device qualification.

## Integration and end-to-end coverage

The host suite exercises complete adapters, HTTP protocols, real filesystem and
subprocess boundaries, native component interactions, and packaging commands.
Browser tests exercise the rendered application and its persistent stores. Root-view
empty-state, landmark and keyboard checks share one fresh page per view/theme,
removing 48 repeated loads and fixed waits. Configured Maps recovery supplies its
own worker-scoped fixture server; it no longer depends on an unset global build
variable. Retired local-agent Notes UI journeys and their PCM helper table are
removed; current Cloud-bound capture/save/playback E2E and explicit real-host
playback qualification remain. Unit
helper tables, source-text/regex assertions, extracted-method harnesses, and
upstream unit-suite forwarding are removed from the consumer suite. Shared
behavior is tested through its product integration; upstream owns its unit tests.
This includes retiring the secure-store helper harness that cloned and repeatedly
authenticated the entire upstream tree to test one input-reading helper. The real
Android build still stages and compiles those sources; Git/source-admission
integrations retain corruption and incomplete-checkout coverage.
The Whisper model/runtime transcription test remains, including silence and
cancellation. Type checking, production bundle auditing and APK inspection remain
build gates. The host verification job keeps JDK/JSON inputs for native component
integration, but no longer installs an Android SDK used only by removed harnesses.

Verification prepares the pinned client source and speech inputs once, then runs
the existing commands without repeating their individual preparation hooks. Standalone
commands keep their preparation hooks. Verification builds and audits the production
bundle once. Two older host tests
that rebuilt the same bundle, and a duplicate Cloud protocol invocation, were
removed. The restart runner keeps a successful integration for every campaign
configuration, but exercises shared rejection cases once instead of multiplying
them across six configurations. CI selection is tested through its actual CLI,
a temporary Git repository and Actions output files.

The automatic Android lane passes `--skip-instrumentation`: it still builds both
standalone and launcher, debug and release, and runs lint and APK inspection.
Manual builds and archives retain their instrumentation APKs. Native speech uses
up to four compiler jobs, bounded by the runner CPU count, within each ABI; its shared workspace is locked, so
ABIs stay sequential. Already-compressed APK uploads use compression level zero.
Browser reports, traces and screenshots upload only on failure; passing test
counts and timings remain in Actions logs.

These changes reduce repeated work; they do not establish emulator HOME-role,
resident execution, full AOSP boot, live-provider or device acceptance.

## Explicit, expensive qualification

Alpha Phone ships Android WebView. Chromium remains automatic for affected PRs.
Firefox and macOS WebKit are additional portability qualification and are now
opt-in, including the real macOS audio-recording coverage. Full resident builds
are opt-in; focused native campaigns are separate manual runs. The resident workflow
also has push-to-main and nightly triggers that stay inert unless the repository
variable `ELIZA_RESIDENT_QUALIFICATION` is `push` or `nightly`; set it only for a
period that needs PACKAGED release qualification on every main commit or daily. Preparation remains automatic for changes
to shared/build inputs. The Bun seccomp reproduction is a diagnostic, not a routine
gate. The only qualification schedule is that opt-in resident trigger; the other schedules are
the weekly advisory audit and the hourly develop pin sync below, and there are no hidden
branch-specific automatic diagnostic runs.

```sh
# Use the reviewed branch/ref. Native resident dispatch retains its qualification campaigns.
gh workflow run browser.yml --ref main -f cross_browser=true
gh workflow run android.yml --ref main
gh workflow run resident-android.yml --ref main -f runtime_profile=native
# Build genuine Cloud-profile QA APKs without native/test-mocks campaigns.
gh workflow run resident-android.yml --ref <reviewed-ref> -f runtime_profile=cloud
gh workflow run resident-prepare.yml --ref main
gh workflow run bun-spawn-seccomp.yml --ref main
```

The resident workflow's manual `runtime_profile` choice defaults to `native`.
Push and nightly runs always use `native`. Choosing `cloud` reuses the exact source,
preparation, workflow-worker and runtime provenance checks, then stages the Cloud
profile and uses the same archive builder for all four flag-off APKs. The separate
test-mocks archive, private peer helper and native/recovery emulator campaigns are
skipped for Cloud. No provider credentials or live provider calls are used.

Cloud archives upload as `resident-cloud-archive-<sha>-<run>` with three-day
retention. They include standalone and launcher debug APKs, release build outputs,
source snapshots and packaged-runtime verification. They are build evidence;
unsigned releases and missing device/native-speech qualification do not become
release acceptance. Inspect the terminal result and retain needed artifacts before
expiry. A later dispatch on the same ref still cancels an earlier dispatch, including
one using the other profile.

### Emulator evidence (`android-emulator.yml`)

Dispatch only: no push, pull request, schedule or reusable-workflow trigger, and no
other workflow starts it. `test/ci-emulator-evidence.test.mjs` fails if that changes, if
an action in it is not pinned to an exact commit, or if an emulator job stops uploading
its results. The same test requires every action in every workflow file to name an exact
commit with its release: round 8 replaced the four major-tag references the older
workflows still had (`android-actions/setup-android`, `gradle/actions/setup-gradle`,
`reactivecircus/android-emulator-runner`, `oven-sh/setup-bun`) with the commits those tags
resolved to on 2026-10-10, so no workflow's behaviour changed. A change to the file itself selects no automatic lane. One `build` job
repeats the Android foundation build's APK steps with the instrumentation APKs (and a
second Gradle build for the test-mocks pair when the reading suite is selected); for the
speech suite it also builds the x86_64 fused libelizainference voice host, admits it into
that workspace only as an unreviewed hosted CI build, and stages the pinned voice bundle
into the developer APK ([fused speech](fused-speech.md)); each selected
suite then boots one API 35 x86_64 emulator. No run exists yet, so no duration is known:
the `build` job is limited to 150 minutes and the emulator jobs to 90, 90 and 60. A later dispatch of the same suite on the same ref cancels the earlier one.

```sh
# Default instrumentation classes on both distributions (flag-off developer APKs).
gh workflow run android-emulator.yml --ref <branch> -f suite=instrumentation
# Reading and page-question classes on the pinned Chromium 157 WebView; also builds the test-mocks pair.
gh workflow run android-emulator.yml --ref <branch> -f suite=browser-reading
# The fused-speech classes on x86_64 against the voice bundle and engine built in that run.
gh workflow run android-emulator.yml --ref <branch> -f suite=fused-speech
# All three after one build.
gh workflow run android-emulator.yml --ref <branch> -f suite=all
```

| Suite | Job | Runs | Artifact (3 days) | Fails when |
| --- | --- | --- | --- | --- |
| `instrumentation` | `instrumentation` | `npm run test:android:instrumentation` with its default classes, standalone then launcher | `android-emulator-instrumentation-<sha>-<run>-<attempt>`: `test-results/android-instrumentation/ci-default/` (`results.json`, raw output per class), `test-results/emulator-suite/instrumentation.json` | any class is failed, skipped or missing |
| `browser-reading` | `browser-reading` | `scripts/prepare-ci-webview.mjs` (WebView 157.0.8083.0), then BrowserReadingNavigation and BrowserPageQuestion on the flag-off pair and BrowserReading, BrowserSensitiveReading and BrowserIsolatedReading on the test-mocks pair | `android-emulator-browser-reading-…`: `ci-reading/`, `ci-reading-test-mocks/`, the provider provisioning evidence | the provider cannot be installed, or any class is failed, skipped or missing |
| `fused-speech` | `fused-speech` | Refused in the build job until hosted Paradee staging exists (the voice outputs need a same-engine embedding host, which needs a reviewed receipt at this pin). When enabled: `scripts/ci/speech-candidate.mjs check` on the standalone APK, then LocalSpeech, LocalSpeechBridge, SpeechSentenceCancellation and VoiceNoteReadAloud on standalone with networking off | `fused-speech-x86_64-…`: `test-results/fused-speech-x86_64/` (the instrumentation record, the APK pair, `result.json`) | the APK carries no voice bundle or is not the recorded bytes, or any class is failed, skipped or missing; without the ASR slot pair transcription is not evidenced |

The suites are implemented in `scripts/ci/emulator-suite.mjs`, which refuses to run
outside a GitHub-hosted runner. Results are emulator-class evidence for developer-override
APKs built in that run (resident runtime not packaged, voice host an unreviewed hosted
build) on an x86_64 SDK image. They are not evidence for a distributable build, an arm64
device, the AOSP image or acceptance. The speech job covers one ABI: admission still needs
arm64-v8a hardware (class D) and a reviewer named by a person, and only that review edits
`android/voice-host/qualified-voice-host.json`. No job admits anything. Artifacts expire after three days; copy what a ledger cites.

Before distributing a new runtime/APK, explicitly run resident qualification on
the reviewed revision and inspect its terminal result. A green ordinary PR does
not claim resident execution, Firefox/WebKit, full AOSP, physical-device or real
integration acceptance. Later dispatches on the same ref cancel older runs;
use separate reviewed refs for intentionally concurrent qualification.

Temporary Actions evidence expires after three days. APK transfer bundles are
uploaded once, with the R8 `artifacts/mapping/*.txt` files of their release APKs
(the resident archive retains its mappings and `release-mappings.json` hashes), rather than included again in the generic build-evidence artifact.
Preserve release evidence separately before expiration. Existing uploaded artifacts
are not deleted or shortened by this change.

## Baseline measured October 7, 2026

The Actions API returned 2,685 runs from September 29 through October 6:
1,144 Android foundation, 1,111 Browser MVP, 312 resident Android, 59 preparation,
55 Bun diagnostics and four retired overlay diagnostics. Conclusions were 1,365
cancelled, 961 failed and 359 successful. This is an unusually high-volume week,
not a normalized monthly projection.

Removed automatic duplication includes 587 Android main pushes, 578 full browser
main pushes, 267 resident pushes and 53 diagnostic pushes in that history.
Browser main pushes now retain only repository verification when needed.

[Browser run 37504530726](https://github.com/AlphaCompute/alphaphone/actions/runs/37504530726)
used 186.8 Linux runner-minutes and 10.2 macOS runner-minutes (197.0 total). Its
first Chromium shard spent 9.2 minutes repeating `npm run verify` before 43 minutes
of browser tests. The other two shards also repeated verification. Moving this
check to one parallel job avoids two copies, plus the Android copy.
[Android run 37504530731](https://github.com/AlphaCompute/alphaphone/actions/runs/37504530731)
used 95.4 runner-minutes; [resident run 37504530771](https://github.com/AlphaCompute/alphaphone/actions/runs/37504530771)
used 84.8. Their emulator failures predate this CI-policy change.

For an affected renderer PR followed by a merge, applying this policy to those
latest durations removes the second full browser and Android runs, the resident
run, cross-browser portability checks and redundant verification. This suggests
roughly a 60–70% reduction in runner time for that scenario, before path skips,
Gradle cache savings and failure cancellation. It is an estimate, not observed
post-change billing; manual qualification frequency and future change mix matter.

The legacy run timing endpoint returned zero billable milliseconds despite real
job durations. No dollar or invoice claim is inferred from those zeros. Compare
the organization's billing export and Actions metrics after a week of this policy;
track Linux minutes, macOS minutes, cancelled minutes and artifact storage separately.
