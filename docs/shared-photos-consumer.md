# Shared Photos consumer checkpoint

This candidate consumes the Photos implementation exported by the common Eliza
browser application. It does not change the production entry point or claim that
the complete Photos view has been adopted yet.

## Required source and artifact

The required upstream checkpoint is
`93a1c5130c49b9fcba7c008943243cf8a6235089` on
`codex/shared-photos-review-followup`. It includes the native library port at
`7064f1ceab5d8848738304f6d0f7ae0dae455e04`, the shared Photos UI/browser store at
`033a86eb34bd7b4df92a27b76eac40562360e051`, and the pending-listener repair,
`retainVideo` method, and public utility exports in the follow-up. A reviewed
integration descendant may replace this checkpoint only after those contracts
and the consumer checks are repeated.

`apps/app/src/product/photos-upstream.ts` imports only the supported
`.eliza/browser-consumer/index.js` artifact. That artifact must be produced from
the reviewed integrated source by the canonical app producer, with its clean
source receipt and emitted-file hashes verified during staging. It must export
`createBrowserPhotoLibrary`, `createBrowserPhotosHost`,
`createBrowserMediaCopyJournal`, `createMediaCopyJournal`, `applyPhotoFilter`,
`validateVideoEdit`, `drawEditedVideo`, `renderVideoEdit`, and the real
`PhotosHost`/`VideoEdit` declarations. Missing named exports fail the consumer
build. This candidate does not stage an artifact, alter the upstream pin, or add
Photos to the hand-maintained `CLIENT_FEATURE_PATHS` source copier.

## Installed data and ownership

One shared library instance serves the existing Camera adapter and the new
Photos host. It keeps `alpha.browser.photos.v1`, schema 2, the `photos` store,
chronological index, existing media IDs, and atomic `edit:<UUID>` copy receipts.
Completed browser recordings use that same store through `retainVideo`; camera
generation/session checks still run inside the save transaction. The compatibility
filter and video-edit modules re-export upstream functions instead of retaining
another implementation.

The existing `albumDocument` remains the owner of `alpha.browser.albums.v1` in
`alpha.browser.documents.v1`. The existing `BrowserDomainDocument` still preserves
legacy bytes and refuses a conflicting legacy writer. The shared copy journal
uses the same `alpha.photos.pending-copy.v1` key, existing browser document
envelope and compare-and-swap rules, or the installed native localStorage path.
There is no media migration, account migration, extra database or identity store.

`createAlphaPhotosHost()` supplies installed `AlphaPhotos` and
`AlphaPhotoLibrary` names, their actual permission methods, existing copy journal,
and only the same-origin `/_alpha_owned_video/<id>.mp4` playback path. It returns
unavailable if either native plugin is absent; it never supplies a simulated
grant. Optional Ask, email and device-agent handoffs must come from the existing
owners. Omitting them leaves those actions unavailable. No adapter sends mail,
uploads media, or creates an authenticated runtime context.

## Remaining integration

The integrated common application must create this host once and pass it to
`BrowserConsumerHostOptions.photos`. Its existing App runtime/authentication
observation supplies operation identity and retirement. A host may be disposed
only when that shared library's lifetime ends, because Camera uses the same
instance. Opening or closing the Photos view only retires the view/controller.

Until the common App is mounted with those real ports, Alpha's current Camera and
Photos UI adapters remain present. This checkpoint removes the duplicate browser
media engine, not all legacy view code. The common app cutover must also preserve
its current Ask/email reviews, device-agent registration and retained selection
behavior. Do not wrap `PhotosPageView` in fabricated providers to bypass these
dependencies.

## Evidence and pending gates

The bounded source check is:

```sh
ELIZA_PHOTOS_UPSTREAM_SOURCE=/path/to/reviewed/eliza \
ELIZA_PHOTOS_UPSTREAM_COMMIT=93a1c5130c49b9fcba7c008943243cf8a6235089 \
node scripts/test-photos-consumer-source.mjs
```

It requires a clean exact upstream head and records the actual bundled input
hashes. Chromium checks the single Camera/Photos engine, old pending-copy bytes
and stale compare-and-swap refusal, missing native plugin refusal, real Capacitor
proxy dispatch names, and strict playback origin/path checks. The native responses
are controlled fixtures; no device permissions or external services are used.
This check explicitly marks its source alias output **non-distributable**.

The recorded targeted TypeScript diagnostic uses actual upstream source types;
it is not the production declaration/artifact check. Full Alpha verification,
the clean producer and staged-artifact consumer build, integrated common App
view/owner tests, both Android distributions, real media grants, recording,
playback and device acceptance remain required. A successful browser source check
does not establish any of those gates.
