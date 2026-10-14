package ai.elizaresearch.alphaphone;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;
import ai.eliza.plugins.calendar.read.CalendarSourceIdentity;
import ai.eliza.plugins.calendar.read.SelectedCalendarReader;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.Collections;
import java.util.LinkedHashSet;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Free/busy provider read for the foreground availability review. The projection holds only
 * instance times, the all-day flag, availability and status: titles, descriptions, locations
 * and attendees are never queried, so they cannot be returned. Callers own permission,
 * foreground and owner-review checks.
 */
final class CalendarAvailabilityReader {
 static final int MAX_SOURCES=64,MAX_SELECTED=16,MAX_EVENTS=200;
 static final long DAY=86400000L,MAX_SPAN=7L*DAY;
 /** A chosen calendar is gone or its account, name, owner or access level changed since review. */
 static final class SourceChanged extends Exception {SourceChanged(){super("Selected calendar changed");}}
 /** CalendarProvider does not prove whether a remote calendar has finished syncing. */
 static final class FreshnessUnknown extends Exception {FreshnessUnknown(){super("Calendar sync freshness is unknown");}}
 /** More rows than one reviewed read may cover. Nothing is truncated silently. */
 static final class TooMany extends Exception {TooMany(){super("Availability read exceeds its bound");}}
 private static final DateTimeFormatter INSTANT=new DateTimeFormatterBuilder().appendInstant(3).toFormatter();
 private CalendarAvailabilityReader(){}

 /** True when the requested zone has the same rules as the phone's zone (aliases are equal). */
 static boolean sameZone(String requested,ZoneId device){
  try{return requested!=null&&ZoneId.of(requested).getRules().equals(device.getRules());}catch(Exception invalid){return false;}
 }
 /**
  * Calendars the owner may choose from: any calendar this phone may read at free/busy level
  * or above. Display name and account are for the on-phone picker only.
  */
 static JSONArray sources(ContentResolver resolver)throws Exception {
  JSONArray result=new JSONArray();
  try(Cursor rows=resolver.query(CalendarContract.Calendars.CONTENT_URI,new String[]{CalendarContract.Calendars._ID,CalendarContract.Calendars.CALENDAR_DISPLAY_NAME},
    CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL+">="+CalendarContract.Calendars.CAL_ACCESS_FREEBUSY,null,CalendarContract.Calendars._ID+" ASC")){
   if(rows==null)throw new IllegalStateException("Calendar provider returned no cursor");
   while(rows.moveToNext()){
    if(result.length()>=MAX_SOURCES)throw new TooMany();
    JSONObject identity=CalendarSourceIdentity.read(resolver,rows.getLong(0));
    String name=rows.getString(1);
    result.put(new JSONObject().put("id",identity.getString("id")).put("name",name==null?"":name).put("account",identity.getString("account")).put("sourceRevision",identity.getString("sourceRevision")));
   }
  }
  return result;
 }
 private static long instant(String text){
  long at=Instant.parse(text).toEpochMilli();
  if(at<0||!INSTANT.format(Instant.ofEpochMilli(at)).equals(text))throw new IllegalArgumentException("Invalid availability instant");
  return at;
 }
 private static void assertSources(ContentResolver resolver,JSONArray selected)throws SourceChanged {
  try{SelectedCalendarReader.assertSourceIdentities(resolver,selected);}
  catch(Exception changed){throw new SourceChanged();}
 }
 private static String overlap(long begin,long end){return CalendarContract.Instances.BEGIN+"<"+end+" AND "+CalendarContract.Instances.END+">"+begin;}
 /**
  * Busy-relevant instances of exactly the selected calendars inside [start, finish). Selection
  * is enforced in the provider query. All-day instances are matched by the owner's civil dates
  * in {@code zone}; cancelled events and invitations the owner declined are not occurrences
  * that occupy time and are skipped. Each row is {start,end,allDay,availability}.
  */
 static JSONArray read(ContentResolver resolver,JSONArray selected,String start,String finish,ZoneId zone)throws Exception {
  if(selected==null||selected.length()<1||selected.length()>MAX_SELECTED||start==null||finish==null||zone==null)throw new IllegalArgumentException("Invalid availability read");
  long begin=instant(start),end=instant(finish);
  if(end<=begin||end-begin>MAX_SPAN)throw new IllegalArgumentException("Invalid availability window");
  LinkedHashSet<String> ids=new LinkedHashSet<>();
  for(int i=0;i<selected.length();i++){
   JSONObject source=selected.getJSONObject(i);
   if(source.length()!=2||!source.has("id")||!source.has("revision"))throw new IllegalArgumentException("Invalid calendar selection");
   String id=source.getString("id");
   if(!id.matches("[1-9][0-9]{0,18}")||!source.getString("revision").matches("[a-f0-9]{64}")||!ids.add(id))throw new IllegalArgumentException("Invalid calendar selection");
  }
  assertSources(resolver,selected);
  // A successful query of a synced cache cannot establish remote availability. Only
  // device-local calendars have no remote freshness dependency. Do not read partial
  // intervals from the remaining sources when any selected source is unknown.
  for(String id:ids){
   try(Cursor source=resolver.query(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI,Long.parseLong(id)),
     new String[]{CalendarContract.Calendars.ACCOUNT_TYPE},null,null,null)){
    if(source==null||!source.moveToFirst()||!CalendarContract.ACCOUNT_TYPE_LOCAL.equals(source.getString(0))||source.moveToNext())throw new FreshnessUnknown();
   }
  }
  long civilBegin=Instant.ofEpochMilli(begin).atZone(zone).toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();
  LocalDate lastDay=Instant.ofEpochMilli(end-1).atZone(zone).toLocalDate();
  long civilEnd=lastDay.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();
  Uri.Builder uri=CalendarContract.Instances.CONTENT_URI.buildUpon();
  ContentUris.appendId(uri,Math.min(begin,civilBegin));ContentUris.appendId(uri,Math.max(end,civilEnd));
  String[] arguments=ids.toArray(new String[0]);
  String selection=CalendarContract.Instances.CALENDAR_ID+" IN ("+String.join(",",Collections.nCopies(ids.size(),"?"))+") AND "+CalendarContract.Events.DELETED+"=0 AND (("
   +CalendarContract.Instances.ALL_DAY+"=0 AND "+overlap(begin,end)+") OR ("+CalendarContract.Instances.ALL_DAY+"=1 AND "+overlap(civilBegin,civilEnd)+"))";
  // No title, description, location or attendee column is ever requested.
  String[] projection={CalendarContract.Instances.CALENDAR_ID,CalendarContract.Instances.BEGIN,CalendarContract.Instances.END,CalendarContract.Instances.ALL_DAY,
   CalendarContract.Instances.AVAILABILITY,CalendarContract.Instances.STATUS,CalendarContract.Instances.SELF_ATTENDEE_STATUS};
  JSONArray events=new JSONArray();
  try(Cursor rows=resolver.query(uri.build(),projection,selection,arguments,CalendarContract.Instances.BEGIN+" ASC, "+CalendarContract.Instances.END+" ASC")){
   if(rows==null)throw new IllegalStateException("Calendar provider returned no cursor");
   while(rows.moveToNext()){
    if(!ids.contains(Long.toString(rows.getLong(0))))throw new IllegalStateException("Provider returned an unselected calendar");
    if(!rows.isNull(5)&&rows.getInt(5)==CalendarContract.Events.STATUS_CANCELED)continue;
    if(!rows.isNull(6)&&rows.getInt(6)==CalendarContract.Attendees.ATTENDEE_STATUS_DECLINED)continue;
    long a=rows.getLong(1),b=rows.getLong(2);
    if(b<a)throw new IllegalStateException("Invalid provider interval");
    if(events.length()>=MAX_EVENTS)throw new TooMany();
    int availability=rows.isNull(4)?CalendarContract.Events.AVAILABILITY_BUSY:rows.getInt(4);
    events.put(new JSONObject().put("start",INSTANT.format(Instant.ofEpochMilli(a))).put("end",INSTANT.format(Instant.ofEpochMilli(b))).put("allDay",rows.getInt(3)!=0)
     .put("availability",availability==CalendarContract.Events.AVAILABILITY_FREE?"free":availability==CalendarContract.Events.AVAILABILITY_TENTATIVE?"tentative":"busy"));
   }
  }
  // A source that changed while reading invalidates the rows just read.
  assertSources(resolver,selected);
  return events;
 }
}
