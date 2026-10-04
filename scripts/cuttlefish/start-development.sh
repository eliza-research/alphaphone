#!/usr/bin/env bash
set -euo pipefail
: "${ANDROID_HOME:?Set ANDROID_HOME}"
: "${ALPHA_REPOSITORY:?Set ALPHA_REPOSITORY}"
: "${ALPHA_NODE:?Set ALPHA_NODE to the absolute Node.js executable}"
container=alphaphone-cuttlefish
adb="$ANDROID_HOME/platform-tools/adb"
# Container identity, image mounts and loopback-only published ports are prepared explicitly.
docker start "$container" >/dev/null
# stop_cvd may leave reaped-later zombies in the container; these are not guests.
if ! docker exec "$container" bash -c 'for p in /proc/[0-9]*/stat; do read -r pid comm state rest < "$p" || continue; if [[ $comm == "(run_cvd)" && $state != Z ]]; then exit 0; fi; done; exit 1'; then
 docker exec -e ANDROID_HOST_OUT=/artifacts -e ANDROID_PRODUCT_OUT=/images "$container" bash -c 'export PATH=/artifacts/bin:$PATH; cd /images; launch_cvd --daemon --system_image_dir=/images --vm_manager=crosvm --crosvm_binary=/artifacts/bin/crosvm --gpu_mode=guest_swiftshader --cpus=4 --memory_mb=6144 --display0=width=1080,height=2400,dpi=420 --enable_sandbox=false --start_webrtc=true --webrtc_sig_server_secure=false --report_anonymous_usage_stats=n'
fi
# Reconnect after guest reboot/adbd restart without navigating Android Settings.
while true; do
 timeout 15 "$adb" connect 127.0.0.1:6520 >/dev/null 2>&1 || true
 if ! boot_state=$(timeout 15 "$adb" -s 127.0.0.1:6520 shell getprop sys.boot_completed 2>/dev/null); then
  timeout 5 "$adb" disconnect 127.0.0.1:6520 >/dev/null 2>&1 || true
  sleep 10
  continue
 fi
 if [[ ${boot_state//$'\r'/} == 1 ]]; then
  timeout 15 "$adb" -s 127.0.0.1:6520 shell settings put global development_settings_enabled 1
  timeout 15 "$adb" -s 127.0.0.1:6520 shell settings put global adb_enabled 1
  if ! timeout 15 "$adb" -s 127.0.0.1:6520 shell dpm list-owners | grep -q ai.elizaresearch.alphaphone; then
   ANDROID_SERIAL=127.0.0.1:6520 "$ALPHA_NODE" "$ALPHA_REPOSITORY/scripts/provision-cuttlefish-kiosk.mjs"
  fi
 fi
 sleep 10
done
