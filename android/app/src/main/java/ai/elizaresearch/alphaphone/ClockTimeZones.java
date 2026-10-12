package ai.elizaresearch.alphaphone;

/** Compare canonical zones without mistaking fixed-offset spelling for a change. */
final class ClockTimeZones {
 private ClockTimeZones() {}
 static boolean same(String requested, String current) {
  if(requested==null||current==null)return false;
  try {
   return java.time.ZoneId.of(requested).normalized().equals(java.time.ZoneId.of(current).normalized());
  } catch(java.time.DateTimeException invalid) { return false; }
 }
}
