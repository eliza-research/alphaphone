package ai.elizaresearch.alphaphone;

/** Native mirror of apps/app/src/runtime/app-record-route-policy.ts: the canonical Notes and Calendar
 * routes the renderer may reach. Domain validation and mutation authority stay in the Eliza services. */
final class AppRecordRoutes {
 private static final String CALENDAR="/api/lifeops/calendar";
 private static final java.util.List<String> READ_KEYS=java.util.Arrays.asList("mode","side","grantId","calendarId","includeHiddenCalendars","timeMin","timeMax","timeZone","forceSync");
 private static final java.util.List<String> PATCH_KEYS=java.util.Arrays.asList("mode","side","grantId","calendarId");
 private static final java.util.List<String> DELETE_KEYS=java.util.Arrays.asList("mode","side","grantId","calendarId","recurrenceScope","notifyAttendees","expectedProviderVersion","idempotencyKey","cancellationMode");
 static boolean owns(String path){return path!=null&&(path.equals("/api/notes/state")||path.equals("/api/views/notes/interact")||path.equals(CALENDAR)||path.startsWith(CALENDAR+"/")||path.startsWith(CALENDAR+"?"));}
 static boolean allowed(String path,String method,String body){
  if(path==null||path.length()>2048||!path.startsWith("/")||path.startsWith("//")||path.matches(".*[\\\\#\\s].*")||path.matches(".*%(?![0-9A-Fa-f]{2}).*"))return false;
  if(("GET".equals(method)||"DELETE".equals(method))&&body!=null)return false;
  String[] parts=path.split("\\?",-1);if(parts.length>2)return false;
  String raw=parts[0];if(raw.contains("//")||raw.matches(".*/\\.{1,2}(/.*)?$"))return false;
  java.util.List<String> keys=new java.util.ArrayList<>();
  if(parts.length==2&&!parts[1].isEmpty())for(String pair:parts[1].split("&",-1)){String key=decode(pair.split("=",2)[0]);if(key==null||keys.contains(key))return false;keys.add(key);}
  if(raw.equals("/api/notes/state"))return "GET".equals(method)&&keys.isEmpty();
  if(raw.equals("/api/views/notes/interact"))return "POST".equals(method)&&keys.isEmpty();
  if(raw.equals(CALENDAR+"/feed")||raw.equals(CALENDAR+"/calendars")||raw.equals(CALENDAR+"/next-context"))return "GET".equals(method)&&READ_KEYS.containsAll(keys);
  if(raw.equals(CALENDAR+"/events"))return "POST".equals(method)&&keys.isEmpty();
  if(!raw.startsWith(CALENDAR+"/events/"))return false;
  String id=decode(raw.substring((CALENDAR+"/events/").length()));
  if(id==null||!id.matches("^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,511}$"))return false;
  if("PATCH".equals(method))return PATCH_KEYS.containsAll(keys);
  return "DELETE".equals(method)&&DELETE_KEYS.containsAll(keys);
 }
 /** decodeURIComponent: '+' stays literal; invalid UTF-8 refuses. */
 private static String decode(String value){
  try{return java.net.URLDecoder.decode(value.replace("+","%2B"),"UTF-8");}catch(Exception invalid){return null;}
 }
}
