# Explicit development Cloud speech

The Mac browser preview may use its already paired agent's Eliza Cloud gateway
for ASR and TTS. This is separate from a renderer Cloud account and from direct
Cartesia development voice. The agent retains its Cloud credentials server-side;
the browser receives only owner-bound transcript/audio results.

Both sides must explicitly opt in: Vite `VITE_ALPHA_DEV_CLOUD_VOICE=1` and the
Vite host bridge `ALPHA_DEV_CLOUD_VOICE=1`, in a development build with
`ELIZA_DEV_ALLOW_TEST_MOCKS=1` and the existing local-agent bridge enabled.
Native Android and production builds never select this route. An unavailable
Cloud service fails visibly; it does not switch to direct Cartesia or native
speech. Normal production on-device speech policy is unchanged.

The host forwards only POST `/api/asr/cloud` (bounded WAV) and POST
`/api/tts/cloud` (`text` only, retaining the gateway’s default billing model).
Actual synthesis is verified from the provider response; the billing model is
not used as evidence of the synthesis engine. It retains the existing same-origin,
private owner enrollment, selected owner, request cancellation and size checks.
The paired runtime proxy must verify the actual gateway provider and normalize
successful replies with `X-Eliza-Speech-Provider: cartesia` and
`X-Eliza-Speech-Route: cloud`. TTS must be `audio/mpeg`. Missing or different
proof fails closed. The browser cannot supply these response markers.

ASR returns a completed transcript to the existing conversation coordinator,
which submits it once through the selected agent. These batch endpoints do not
provide realtime partial transcripts. Playback uses the existing owned audio
handles and Stop retirement. Mute and Stop presentation are unchanged.

The tests use mocked runtime responses over loopback and in-memory capture/playback
ports. Passing them proves the adapter contracts, not actual Cartesia service,
latency, microphone capture, native Android support, or live Cloud acceptance.

## Cloud resident conversation

The browser Cloud resident (`scripts/dev-cloud.mjs`, `VITE_ALPHA_CLOUD_RESIDENT=1`) has one
voice conversation: the realtime session Direct uses. The page talks only to its local agent
through the canonical voice session client; the agent's speech runs through the Eliza Cloud
speech relay. `scripts/cloud-resident-host.mjs` sets `ELIZA_SELF_HOSTED_VOICE_ENABLED=1` and
`ELIZA_SELF_HOSTED_VOICE_CLOUD_RELAY_ENABLED=1` only while a Cloud account is bound and own keys
are not selected; own keys keep direct Cartesia and never inherit the relay. Before it opens the
microphone, the page requires the agent's health to report `speechRoute: 'cloud'`,
`speechProvider: 'cartesia'` and `providerAdmission: 'at-session-start'`.

Cloud admits and bills each relay session. Voice streams while it is open, including silence
while muted. A Cloud resident with no bound Cloud account shows the sign-in line instead.

The voice client replaces its session at an idle moment before each 60 second relay ticket ends.
When a turn is still busy at that moment, the agent ends the session at the ticket deadline with
the `expired` code, and the client opens the next session through the same reconnect. The
interrupted reply is not replayed. One reconnect is allowed, refilled after 30 seconds live, so
every ticket boundary renews without user action. Each new session is a new Cloud admission.

Any other ending stops voice. A relay refusal (sign-in, billing, limits or an unavailable
service) stops the client before it could open another paid session and shows one calm line.
A refused or missing microphone keeps its browser recovery copy, voice open in another tab says
so, and a lost connection that cannot be renewed says voice stopped. Raw session text is never
shown. The Cloud resident has no recorded-clip conversation loop and no spoken progress cue.
Read-aloud and dictation keep the batch Cloud speech routes above.

Tests cover this with in-memory ports only. Relay latency, billing, the busy hold over the relay
and the exact refusal codes Cloud sends need a live run against Cloud.
