# Owner-scoped notice suspension

Explicit patch against `13c98575987a121decc45b161b0c8a4ee698554e`.
`native-manifest.json` binds the original and resulting Java bytes. The vendor
checkout remains unchanged; Gradle and host tests use authenticated staged source.

The generic ledger distinguishes a privacy suspension from a terminal decision.
Only a confirmed, still-visible, unexpired approval can become suspended.
The host must independently revalidate the pending operation before explicit
quiet resume. Resume binds the original identity and expiry and commits its
intent before the OS effect; uncertain dispatch is never replayed. Results
support terminal privacy withdrawal without deleting retained workflow history.

Alpha persists the complete origin/owner/agent identity fence (explicit null means signed out), cancels stale PendingIntents, rotates the
tap token before resume and suppresses sound/vibration using an explicit group
with summary-only alert behavior. It checks the current workflow revision,
run cancellation/completion, exact pending proposal binding and expiry without
creating an executable approval review. Network failure leaves notices suspended.

Host tests exercise the patched ledger, restart, stale tokens, decision/expiry,
result privacy and read-only revalidation. Android tests check the actual OS
PendingIntent cancellation, private preview and quiet group behavior; building
those tests is not evidence that their device assertions passed.
