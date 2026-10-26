#!/usr/bin/env bash
# Register this Linux builder as the repository's self-hosted `alpha-device` runner (P-58).
# It runs the AOSP image build/sign, Cuttlefish and attached-Pixel jobs that GitHub-hosted
# runners cannot. Run it yourself, as the user that owns the AOSP tree and adb/kvm access:
#
#   bash scripts/setup-device-runner.sh [--dir ~/actions-runner-alpha] [--repo AlphaCompute/alphaphone]
#
# The registration token is requested with your gh login and passed straight to config.sh;
# it is never printed. The repository is public: only workflow_dispatch / push-to-main jobs may
# target this label (enforced by test/self-hosted-runner-guard.test.mjs), and fork pull
# requests need maintainer approval before any workflow runs.
set -euo pipefail

VERSION=2.338.0
SHA256=af4b794c1bc41d73d40535e3fe092a39f9679cd8d965954c2aca25a05ca41d32
DIR="$HOME/actions-runner-alpha"
REPO=AlphaCompute/alphaphone
LABELS=alpha-device,aosp,cuttlefish,pixel10a
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

command -v gh >/dev/null || { echo "gh is required" >&2; exit 1; }
[ -e /dev/kvm ] && [ -r /dev/kvm ] || echo "warning: /dev/kvm is not readable; Cuttlefish jobs will fail" >&2

mkdir -p "$DIR" "$HOME/alpha-device-lab"
cd "$DIR"
if [ ! -x ./config.sh ]; then
  archive="actions-runner-linux-x64-$VERSION.tar.gz"
  curl -fsSL -o "$archive" "https://github.com/actions/runner/releases/download/v$VERSION/$archive"
  echo "$SHA256  $archive" | sha256sum -c -
  tar xzf "$archive"
  rm "$archive"
fi

if [ -f .runner ]; then
  echo "Runner already configured in $DIR"
else
  token="$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)"
  ./config.sh --unattended --replace --url "https://github.com/$REPO" --token "$token" \
    --name "alpha-device-$(hostname -s)" --labels "$LABELS" --work _work
  unset token
fi

# User-level systemd service so the runner keeps the owner's adb, kvm and AOSP tree access.
unit="$HOME/.config/systemd/user/alpha-device-runner.service"
mkdir -p "$(dirname "$unit")"
cat > "$unit" <<UNIT
[Unit]
Description=GitHub Actions alpha-device runner ($REPO)
After=network-online.target

[Service]
WorkingDirectory=$DIR
ExecStart=$DIR/run.sh
Restart=always
RestartSec=10
Environment=ALPHA_AOSP_SOURCE=$HOME/Android/pixel10a-preparation/eliza-source
Environment=ALPHA_FACTORY_IMAGE=$HOME/Android/pixel10a-preparation/recovery/stallion-cp3a.261005.005-factory-d1d25502.zip
Environment=ANDROID_HOME=$HOME/Android/Sdk
Environment=ALPHA_DEVICE_LAB_ROOT=$HOME/alpha-device-lab

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now alpha-device-runner.service
loginctl enable-linger "$USER" 2>/dev/null || echo "note: enable lingering (loginctl enable-linger $USER) so the runner survives logout" >&2
systemctl --user --no-pager status alpha-device-runner.service | head -5
echo "Runner labels: self-hosted,$LABELS"
