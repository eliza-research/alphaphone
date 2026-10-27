# Protected Power entry on shared Sense

The explicit `AlphaPowerVoiceActivity` requires the existing platform
`android.permission.STATUS_BAR_SERVICE` permission and has no intent filters.
Ordinary Assist, Quick Settings and lock-screen entry keep the existing surface.
No caller extra, URI, package-name string or legacy Agent hint authorizes capture.

This port uses the current shared `SenseListenerClient.recordProtectedPower()`
native API. Only a fresh `onNewIntent` on the same already-bound protected
activity can offer Power to its existing Sense owner/session. Shared Sense still
checks its bridge, renderer generation, owner binding, session, freshness,
unlocked state, visibility and typed voice-readiness gates. Account/reset/bridge
changes invalidate the offer. A rejected stale-Activity offer does not clear a
newer Activity's listener or Power receipt. The existing controller owns capture and cancellation.

**Cold Power activation is not complete.** A first or recreated Power activity
opens the surface without recording or queuing a Power offer. A normal warm Home
activity is a different component and does not supply the protected child's lease.
The person can tap Talk, or use a subsequent Power invocation after this same
protected surface has established its own binding. This limitation is a release
gate, not acceptance of full single-gesture cold activation.

The paired system image must include the reviewed native ingress hardening and
conditional SystemUI dispatcher. `SearchManagerService` must strip a spoofed
Power invocation from non-system callers; the protected child permission alone
does not authenticate an arbitrary invocation Bundle forwarded by SystemUI.

`python3 test/power-sense-entry.test.py` checks the actual activity methods with
modeled host/Sense dependencies, the manifest contract, and Android36 API compilation.
These checks do not prove the full APK, real permission enforcement or Binder behavior.
Before delivery, use an isolated separate-UID Android test to show an ordinary app
cannot launch the protected child or spoof Power through SearchManager. On the exact
paired image verify ordinary Assist/QS/lock no-capture, cold no-capture, same-child warm
one-shot capture, owner/session changes, visibility, cancellation and lock races.
No hardware/audio result is inferred from source tests.
