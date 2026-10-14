package ai.elizaresearch.alphaphone;

/** Plain-JVM checks of the device library rules (issue 408). Not an Android or device test. */
public final class PhotoLibraryAccessTest {
 private static void check(boolean condition, String name) { if (!condition) throw new AssertionError(name); }
 private static boolean rejects(Runnable action) { try { action.run(); return false; } catch (IllegalArgumentException expected) { return true; } }
 public static void main(String[] args) {
  // Scope per SDK: legacy read below 13, READ_MEDIA_* from 13, user-selected only from 14.
  check("full".equals(PhotoLibraryAccess.scope(32, false, false, false, true)), "legacy full");
  check("denied".equals(PhotoLibraryAccess.scope(32, true, true, true, false)), "legacy ignores 13+ grants");
  check("full".equals(PhotoLibraryAccess.scope(33, true, false, false, false)), "images only is full");
  check("full".equals(PhotoLibraryAccess.scope(33, false, true, false, false)), "videos only is full");
  check("denied".equals(PhotoLibraryAccess.scope(33, false, false, true, true)), "13 has no selected grant and ignores legacy");
  check("selected".equals(PhotoLibraryAccess.scope(34, false, false, true, false)), "14 selected");
  check("full".equals(PhotoLibraryAccess.scope(34, true, true, true, false)), "14 full wins over selected");
  check("denied".equals(PhotoLibraryAccess.scope(35, false, false, false, true)), "15 denied");
  check(String.join(",", PhotoLibraryAccess.requestAliases(30)).equals("mediaLegacy"), "aliases 30");
  check(String.join(",", PhotoLibraryAccess.requestAliases(33)).equals("media"), "aliases 33");
  check(String.join(",", PhotoLibraryAccess.requestAliases(34)).equals("media,mediaSelected"), "aliases 34");

  // Identity round trip and rejection.
  String image = PhotoLibraryAccess.id(false, 42, 7), video = PhotoLibraryAccess.id(true, 9_000_000_000L, 0);
  check(image.equals("lib:i:42:7") && video.equals("lib:v:9000000000:0"), "id format");
  PhotoLibraryAccess.Parsed parsed = PhotoLibraryAccess.parse(video);
  check(parsed.video && parsed.rowId == 9_000_000_000L && parsed.added == 0, "parse round trip");
  check(!PhotoLibraryAccess.parse(image).video, "image kind");
  check(rejects(() -> PhotoLibraryAccess.id(false, 0, 1)), "row id 0");
  check(rejects(() -> PhotoLibraryAccess.id(false, 1, -1)), "negative generation");
  for (String bad : new String[] {null, "", "lib:x:1:1", "lib:i:0:1", "lib:i:01:1", "lib:i:1:", "lib:i:1:1:1", "content://media/external/images/media/1", "lib:i:1:1 ", "lib:i:12345678901234567890:1"})
   check(rejects(() -> PhotoLibraryAccess.parse(bad)), "rejects " + bad);

  // Revision changes with bytes (time), size or generation; generation only from Android 11.
  check(PhotoLibraryAccess.revision(10, 20, 30, 30).equals("10:20:30"), "revision 30");
  check(PhotoLibraryAccess.revision(10, 20, 30, 29).equals("10:20"), "revision 29");

  // LIKE escaping: %, _ and \ are literal; control characters and long text are refused.
  check(PhotoLibraryAccess.like(" beach ").equals("%beach%"), "trim");
  check(PhotoLibraryAccess.like("50%_off\\x").equals("%50\\%\\_off\\\\x%"), "escape wildcards");
  check(PhotoLibraryAccess.like(null).equals("%%"), "null query");
  check(rejects(() -> PhotoLibraryAccess.like("a\nb")), "control character");
  check(rejects(() -> PhotoLibraryAccess.like("x".repeat(81))), "too long");
  check(PhotoLibraryAccess.like("x".repeat(80)).length() == 82, "80 allowed");

  // Bounds.
  check(PhotoLibraryAccess.pageLimit(0) == 48 && PhotoLibraryAccess.pageLimit(-5) == 48, "page default");
  check(PhotoLibraryAccess.pageLimit(1000) == 100 && PhotoLibraryAccess.pageLimit(7) == 7, "page cap");
  check(PhotoLibraryAccess.thumbnailSize(0) == 240 && PhotoLibraryAccess.thumbnailSize(10) == 64 && PhotoLibraryAccess.thumbnailSize(4000) == 320, "thumbnail bounds");

  // Supported changes: no restore (trashed rows are never paged).
  for (String op : new String[] {"favorite", "unfavorite", "trash", "delete"}) check(PhotoLibraryAccess.supportedChange(op), op);
  for (String op : new String[] {"restore", "share", "", null, "DELETE"}) check(!PhotoLibraryAccess.supportedChange(op), "refuses " + op);
  check(PhotoLibraryAccess.destructive("trash") && PhotoLibraryAccess.destructive("delete") && !PhotoLibraryAccess.destructive("favorite"), "destructive");
  System.out.println("PASS photo library access");
 }
}
