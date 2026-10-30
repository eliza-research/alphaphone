# Shared Files consumer candidate

This candidate depends on upstream `5f21b0de1ecd6e4bf193a7e382e97952c5a3b4e8`
and its cancellation/registration follow-up `6239c20fdbc03f3daebbcfc052752ac204e3bab7`,
plus declared capability/control follow-up `9937d4e43162e2bdfca5b963ebbad9ae5ea1b01e`,
all after Camera `8b3bf6e398067379b4380d49eb9aeb3e54557ddb`, and a rebuilt,
verified `.eliza/browser-consumer` artifact containing its public exports. The current
pin is unchanged; an older artifact intentionally cannot satisfy these imports.

`createAlphaFilesHost` binds the installed `AlphaFiles` plugin or the same browser
Files instance registered by `browser/register.ts`. It does not mount a second view
or create a second engine. Pass it as `BrowserConsumerHostOptions.files` during the
final common App cutover, with actual context/Ask/email/scan ports only when available.
The existing template Files view remains until that cutover; no fake handoff is supplied.

The browser factory uses `alpha.browser.files.v1`, and the extracted Recent index
keeps `alpha.files.recent.v1` and `alpha.files.open.v1`. The native wrapper retains
`alpha-files-tree`, `SelectedDocumentAccess`, `selected-documents`, `document-` and
`NoteSourceReferences`. Legacy DailyApps methods still delegate to that same registry.
No database or grant migration runs. The common bridge adds exact-request cancellation;
no broad storage permission is requested.

The shared native document UI and server `/api/files` source remain distinct. Device
open/share invokes Android's app chooser, not an email/send effect. Ask, attachment
and scan handoffs must keep their existing review and source identity before cutover.
Owning Android builds, the complete consumer artifact build and common App visual
qualification remain pending; isolated source/browser checks do not prove device SAF.

Source qualification uses the actual upstream modules with explicit diagnostic
aliases via `scripts/test-files-consumer-source.mjs` and
`scripts/test-files-consumer-types.mjs`. Neither replaces the production producer.
The ordinary Recent test now bundles the actual adapter/artifact instead of
stripping imports. Its normal run awaits the new, verified staged artifact.
