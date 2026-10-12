package ai.elizaresearch.alphaphone;

/** Test-only fixture gate. Cuttlefish also needs the runner's explicit image admission. */
final class DisposableFixtureAdmission {
 private DisposableFixtureAdmission() {}
 static boolean allows(String fingerprint, String model, String hardware, String device, String expected) {
  boolean cuttlefish = "cutf_cvm".equals(hardware) || "cutf_ivshmem".equals(hardware) || "cutf_vm".equals(hardware);
  if (cuttlefish) return allowsCuttlefish(fingerprint, hardware, device, expected);
  return fingerprint.contains("generic") || model.contains("sdk") || hardware.contains("ranchu");
 }
 static boolean allowsCuttlefish(String fingerprint, String hardware, String device, String expected) {
  boolean cuttlefish = "cutf_cvm".equals(hardware) || "cutf_ivshmem".equals(hardware) || "cutf_vm".equals(hardware);
  return cuttlefish && device != null && device.startsWith("vsoc_") && expected != null
   && !expected.isEmpty() && !expected.contains("\n") && !expected.contains("\r") && expected.equals(fingerprint);
 }
}
