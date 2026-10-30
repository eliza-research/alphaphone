"""Exercise the real APK verifier with small, authenticated runtime archives."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import zipfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


spec = importlib.util.spec_from_file_location(
    "runtime_verifier", Path(__file__).resolve().parents[2] / "scripts/verify-packaged-runtime.py"
)
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


def check_case(architectures, packaged, *, target="linux-musl", error=None, tamper=False, tamper_binary=False):
    with tempfile.TemporaryDirectory(prefix="alpha-runtime-abis-") as directory:
        root = Path(directory)
        verifier.ROOT = root
        staged = root / "android/app/src/main/assets/agent"
        staged.mkdir(parents=True)
        pin = "a" * 40
        for name, data in {
            "upstream.lock.json": json.dumps({"commit": pin}).encode(),
            "scripts/prepare-local-agent.mjs": b"preparer fixture",
            "scripts/local-agent-source.mjs": b"source guard fixture",
            "config/native-view-declarations.json": b"[]",
        }.items():
            file = root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(data)
        stamp = {"base": pin, "patches": []}
        for key, name in [("lockSha256", "upstream.lock.json"),
                          ("preparerSha256", "scripts/prepare-local-agent.mjs"),
                          ("guardSha256", "scripts/local-agent-source.mjs")]:
            stamp[key] = sha((root / name).read_bytes())
        source = json.dumps(stamp).encode()
        worker = {"version": 1, "sourceStampSha256": sha(source),
                  "files": {"worker.js": sha(b"worker")}}
        worker_bytes = json.dumps(worker).encode()
        files = {
            "alpha-source.json": source,
            "agent-bundle.js": b"bundle",
            "agent-bundle-dependencies.json": json.dumps({"version": 1,
                "bundleSha256": sha(b"bundle"), "packages": [{"name": "fixture"}]}).encode(),
            "native-view-declarations.json": b"[]",
            "workflow-worker/worker.js": b"worker",
            "workflow-worker/manifest.json": worker_bytes,
            "workflow-worker/files.sha256": (
                sha(b"worker") + "\tworker.js\n" + sha(worker_bytes) + "\tmanifest.json\n"
            ).encode(),
            "android-agent-runtime-provenance.json": json.dumps({
                "schema": "eliza.android_agent_runtime_provenance.v1",
                "bun": {"target": target, "architectures": architectures}, "files": []
            }).encode(),
        }
        for name, data in files.items():
            file = staged / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(data)
        apk = root / "app.apk"
        with zipfile.ZipFile(apk, "w") as archive:
            for name, data in files.items():
                if tamper and name == "android-agent-runtime-provenance.json":
                    data += b" "
                archive.writestr("assets/agent/" + name, data)
            for abi in packaged:
                data = ("bun-" + abi).encode()
                file = root / "android/app/src/main/jniLibs" / abi / "libeliza_bun.so"
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(data)
                archive.writestr("lib/" + abi + "/libeliza_bun.so", data + (b"changed" if tamper_binary else b""))
        try:
            result = verifier.verify(apk)
        except (ValueError, KeyError) as failure:
            assert error is not None and error in str(failure), str(failure)
        else:
            assert error is None, "Expected rejection: " + str(error)
            assert result["runtime"] == "PACKAGED"
            assert result["runtimeExecution"] is False


check_case(["arm64-v8a"], ["arm64-v8a"])
check_case(["arm64-v8a"], ["arm64-v8a"], target="android")
check_case(["arm64-v8a", "x86_64"], ["arm64-v8a", "x86_64"])
check_case(["arm64-v8a", "x86_64"], ["arm64-v8a"], error="lib/x86_64/libeliza_bun.so")
check_case(["arm64-v8a"], ["arm64-v8a", "x86_64"], error="Unexpected packaged ABI")
for invalid in [[], ["arm64-v8a", "arm64-v8a"], ["armv7"], None]:
    check_case(invalid, ["arm64-v8a"], error="Invalid runtime ABI admission")
check_case(["x86_64"], ["x86_64"], target="android", error="Invalid Android Bun ABI admission")
check_case(["arm64-v8a"], ["arm64-v8a"], tamper=True, error="Runtime provenance differs")
check_case(["arm64-v8a"], ["arm64-v8a"], tamper_binary=True, error="Packaged runtime mismatch")
print("12 authenticated runtime ABI archive cases passed")
