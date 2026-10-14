package ai.elizaresearch.alphaphone;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pure rules for the device photo/video library (issue 408, policy P-24). No Android
 * calls, so the scope, identity and bounds are reviewable in one place and mirrored by
 * apps/app/src/runtime/photo-library.ts (checked by test/photo-library.test.mjs).
 */
final class PhotoLibraryAccess {
 private PhotoLibraryAccess() {}

 static final String READ_MEDIA_IMAGES = "android.permission.READ_MEDIA_IMAGES";
 static final String READ_MEDIA_VIDEO = "android.permission.READ_MEDIA_VIDEO";
 static final String READ_MEDIA_VISUAL_USER_SELECTED = "android.permission.READ_MEDIA_VISUAL_USER_SELECTED";
 static final String READ_EXTERNAL_STORAGE = "android.permission.READ_EXTERNAL_STORAGE";

 /** Metadata rows per catalog page. Thumbnails are bounded separately. */
 static final int PAGE_DEFAULT = 48, PAGE_MAX = 100;
 /** A page carries thumbnails only up to this many rows, each at most THUMBNAIL_MAX px. */
 static final int THUMBNAIL_ROWS_MAX = 30, THUMBNAIL_DEFAULT = 240, THUMBNAIL_MAX = 320, PREVIEW_MAX = 1024;
 /** Identities revalidated per call, changed rows per change read, items per reviewed action. */
 static final int VALIDATE_MAX = 200, CHANGES_MAX = 200, ACTION_MAX = 20;
 static final int QUERY_MAX = 80;

 /** What Android actually granted. "selected" is Android 14+ partial access. */
 static String scope(int sdk, boolean images, boolean videos, boolean userSelected, boolean legacyRead) {
  if (sdk < 33) return legacyRead ? "full" : "denied";
  if (images || videos) return "full";
  if (sdk >= 34 && userSelected) return "selected";
  return "denied";
 }

 /** Permission strings to request for the device's API level, together in one dialog. */
 static String[] requestAliases(int sdk) {
  if (sdk < 33) return new String[] {"mediaLegacy"};
  if (sdk == 33) return new String[] {"media"};
  return new String[] {"media", "mediaSelected"};
 }

 private static final Pattern ID = Pattern.compile("^lib:([iv]):([1-9][0-9]{0,18}):([0-9]{1,19})$");

 /** Stable identity: kind, MediaStore row id, and the row's add generation (or add time
  * below Android 11), so a reused row id after delete never matches an older identity. */
 static String id(boolean video, long rowId, long added) {
  if (rowId <= 0 || added < 0) throw new IllegalArgumentException("Invalid media row");
  return "lib:" + (video ? "v" : "i") + ":" + rowId + ":" + added;
 }

 static final class Parsed {
  final boolean video; final long rowId; final long added;
  Parsed(boolean video, long rowId, long added) { this.video = video; this.rowId = rowId; this.added = added; }
 }

 static Parsed parse(String value) {
  Matcher match = value == null ? null : ID.matcher(value);
  if (match == null || !match.matches()) throw new IllegalArgumentException("Invalid library id");
  return new Parsed(match.group(1).equals("v"), Long.parseLong(match.group(2)), Long.parseLong(match.group(3)));
 }

 /** Mutation revision: changes on any byte, size or (Android 11+) MediaStore generation change. */
 static String revision(long dateModified, long size, long generationModified, int sdk) {
  return dateModified + ":" + size + (sdk >= 30 ? ":" + generationModified : "");
 }

 static int pageLimit(int requested) { return requested <= 0 ? PAGE_DEFAULT : Math.min(requested, PAGE_MAX); }
 static int thumbnailSize(int requested) { return requested <= 0 ? THUMBNAIL_DEFAULT : Math.min(Math.max(requested, 64), THUMBNAIL_MAX); }

 /** LIKE argument for a user query with SQL wildcards escaped by backslash. */
 static String like(String query) {
  String text = query == null ? "" : query.trim();
  if (text.length() > QUERY_MAX) throw new IllegalArgumentException("Search text is too long");
  StringBuilder out = new StringBuilder("%");
  for (char c : text.toCharArray()) {
   if (Character.isISOControl(c)) throw new IllegalArgumentException("Invalid search text");
   if (c == '%' || c == '_' || c == '\\') out.append('\\');
   out.append(c);
  }
  return out.append('%').toString();
 }

 static boolean destructive(String operation) {
  return "trash".equals(operation) || "delete".equals(operation);
 }

 /** Restore is not offered: trashed rows are never paged, so nothing can select one. */
 static boolean supportedChange(String operation) {
  return "favorite".equals(operation) || "unfavorite".equals(operation) || "trash".equals(operation) || "delete".equals(operation);
 }
}
