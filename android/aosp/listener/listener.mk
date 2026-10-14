# Alpha Phone always-on listener (docs/adr/0001-privileged-listener.md).
# Included from the staged product.mk by `npm run aosp:stage -- ... --listener-apk FILE`.
alphaphone_listener_dir := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))

# Privileged, persistent, network-less listener APK plus its privapp allowlist and sysconfig.
PRODUCT_PACKAGES += AlphaSense

# Hardware invocation (press and hold power -> assistant), microphone privacy toggle and no
# indicator-exempt audio-intelligence role holders.
PRODUCT_PACKAGE_OVERLAYS += $(alphaphone_listener_dir)/overlay

# HOTWORD-source capture is attributed to the RECORD_AUDIO app-op, so the system microphone
# privacy indicator shows for the listener like any other recording.
PRODUCT_PRODUCT_PROPERTIES += ro.hotword.detection_service_required=true
