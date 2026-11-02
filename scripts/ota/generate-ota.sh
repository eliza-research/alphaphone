#!/usr/bin/env bash
# Build one A/B OTA package from an existing target-files zip (docs/runbooks/ota-updates.md).
#
#   bash scripts/ota/generate-ota.sh --releasetools OTATOOLS_BIN --package-key KEY \
#     --target-files TARGET_FILES.zip --out NEW_OTA.zip [--from SOURCE_TARGET_FILES.zip]
#
# KEY is a key path without extension, as ota_from_target_files -k takes it (KEY.x509.pem and
# KEY.pk8). Without --from it builds a full OTA; with --from, an incremental OTA from that source
# build (the GrapheneOS generate-delta.sh step). It never signs target-files: release signing and
# the first full release OTA are scripts/sign-aosp-release.mjs. Track 1 passes a test-keys build
# with the build's own test key; Track 2 passes retained release-signed target-files with the
# release key.
#
# It refuses a missing input, an existing output, a target that is not A/B, a source that is the
# target, and a key whose certificate is not in SYSTEM/etc/security/otacerts.zip of the target and
# the source (update_engine verifies payloads against the running build's otacerts.zip). It passes
# no wipe, downgrade or timestamp override option and accepts no other argument.
set -euo pipefail

usage='Usage: bash scripts/ota/generate-ota.sh --releasetools DIR --package-key KEY --target-files ZIP --out NEW_ZIP [--from ZIP]'
refuse() {
  echo "generate-ota: $*" >&2
  exit 2
}

releasetools='' key='' target='' out='' from=''
while [[ $# -gt 0 ]]; do
  [[ $# -ge 2 ]] || refuse "$usage"
  case $1 in
    --releasetools) releasetools=$2 ;;
    --package-key) key=$2 ;;
    --target-files) target=$2 ;;
    --out) out=$2 ;;
    --from) from=$2 ;;
    *) refuse "$usage" ;;
  esac
  shift 2
done

[[ -n $releasetools && -n $key && -n $target && -n $out ]] || refuse "$usage"
[[ -x $releasetools/ota_from_target_files ]] || refuse "no ota_from_target_files in $releasetools"
[[ -f $key.x509.pem && -f $key.pk8 ]] || refuse "$key.x509.pem and $key.pk8 are required"
[[ -f $target ]] || refuse "no target-files at $target"
[[ -z $from || -f $from ]] || refuse "no source target-files at $from"
[[ ! -e $out && -d $(dirname "$out") ]] || refuse "$out must be a new file in an existing directory"
if [[ -n $from && $(cd "$(dirname "$from")" && pwd)/$(basename "$from") == $(cd "$(dirname "$target")" && pwd)/$(basename "$target") ]]; then
  refuse "--from names the target itself"
fi

misc_info=$(unzip -p "$target" META/misc_info.txt) || refuse "$target has no META/misc_info.txt"
grep -qx 'ab_update=true' <<<"$misc_info" || refuse "$target is not an A/B target-files"
signer=$(openssl x509 -in "$key.x509.pem" -noout -pubkey | openssl pkey -pubin) || refuse "$key.x509.pem is not a certificate"
certs=$(mktemp -d)
trap 'rm -rf "$certs"' EXIT
for zip in "$target" ${from:+"$from"}; do
  rm -rf "${certs:?}"/*
  unzip -p "$zip" SYSTEM/etc/security/otacerts.zip >"$certs/otacerts.zip" 2>/dev/null &&
    unzip -q "$certs/otacerts.zip" -d "$certs/trusted" 2>/dev/null || refuse "$zip has no SYSTEM/etc/security/otacerts.zip"
  trusted=''
  for cert in "$certs"/trusted/*; do
    if [[ $(openssl x509 -in "$cert" -noout -pubkey 2>/dev/null | openssl pkey -pubin 2>/dev/null) == "$signer" ]]; then trusted=1; fi
  done
  [[ -n $trusted ]] || refuse "$key is not in the otacerts.zip of $zip"
done

"$releasetools/ota_from_target_files" -p "$(dirname "$releasetools")" -k "$key" ${from:+-i "$from"} "$target" "$out"
