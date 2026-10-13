package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.provider.CalendarContract;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import ai.eliza.plugins.calendar.CalendarConfiguration;
import ai.eliza.plugins.calendar.CalendarPlugin;
import ai.eliza.plugins.calendar.write.CalendarDestinations;
import ai.eliza.plugins.calendar.write.CalendarEventOptions;
import ai.eliza.plugins.calendar.write.CalendarInsertHandoff;
import ai.eliza.plugins.calendar.write.CalendarOptionCreationStore;

/** Keep installed calendar/journal identity stable while sharing provider behavior. */
@CapacitorPlugin(name="AlphaCalendar", permissions={@Permission(alias="calendar",strings={Manifest.permission.READ_CALENDAR,Manifest.permission.WRITE_CALENDAR}),@Permission(alias="workflowCalendarRead",strings={Manifest.permission.READ_CALENDAR})})
public final class AlphaCalendarPlugin extends CalendarPlugin {
 static final CalendarConfiguration CONFIGURATION=new CalendarConfiguration(
  "Alpha Phone","alpha-phone-local","On this phone","alpha-calendar-creations-v1","alphaphone://calendar-creation/",0xff0000ff);
 /** Patch 0041: all-day, zoned and recurring direct saves use their own creation journal. */
 static final CalendarOptionCreationStore OPTION_CREATIONS=new CalendarOptionCreationStore(CONFIGURATION);
 public AlphaCalendarPlugin(){super(CONFIGURATION);}
 private boolean granted(){return getPermissionState("calendar")==PermissionState.GRANTED;}
 /** Capacitor's own permission request launches through the activity; see {@link LateLaunch}. */
 @Override @PluginMethod public void requestPermissions(PluginCall call){LateLaunch.ask(call,()->super.requestPermissions(call));}
 /** The shared calendar plugin asks for its permissions inside these two methods; see {@link LateLaunch}. */
 @Override @PluginMethod public void requestAccess(PluginCall call){LateLaunch.ask(call,()->super.requestAccess(call));}
 @Override @PluginMethod public void requestWorkflowReadAccess(PluginCall call){LateLaunch.ask(call,()->super.requestWorkflowReadAccess(call));}
 private static JSObject status(String value){JSObject out=new JSObject();out.put("status",value);return out;}
 private boolean foreground(){return getActivity()!=null&&!getActivity().isFinishing()&&!getActivity().isDestroyed()&&getActivity().hasWindowFocus();}
 /**
  * The Calendar view's range read. The shared plugin's list returns every instance and always
  * reports truncated:false; this product keeps its documented bound of
  * CalendarRangeReader.MAXIMUM_EVENTS per read and reports when the provider held more.
  * Statuses: ready, permission-required.
  */
 @Override @PluginMethod public void list(PluginCall c){
  if(!granted()){c.resolve(status("permission-required"));return;}
  Long begin=c.getLong("begin"),end=c.getLong("end");
  if(begin==null||end==null||begin<0||end<=begin||end-begin>CalendarRangeReader.MAXIMUM_RANGE){c.reject("A valid calendar range of at most 370 days is required");return;}
  try{
   android.content.ContentResolver resolver=getContext().getContentResolver();
   org.json.JSONObject read=CalendarRangeReader.read(resolver,begin,end);
   JSObject value=status("ready");value.put("calendars",new ai.eliza.plugins.calendar.read.CalendarReadAccess(resolver).calendars());
   value.put("events",read.getJSONArray("events"));value.put("truncated",read.getBoolean("truncated"));c.resolve(value);
  }catch(Exception unavailable){c.reject("Calendar provider could not be read");}
 }

 /**
  * Creates one all-day, explicitly zoned or simply recurring event on the local or a writable
  * calendar, then reads every bound provider field back. Never edits an existing event and never
  * replays an unknown creation. Statuses: saved, unknown, pending-creation, read-only, permission-required.
  */
 @PluginMethod public synchronized void saveOptions(PluginCall c){
  if(!granted()){c.resolve(status("permission-required"));return;}
  try{
   CalendarEventOptions options=CalendarEventOptions.parse(new org.json.JSONObject(c.getObject("event",new JSObject()).toString()));
   String calendar=c.getString("calendarId","local");
   long calendarId=calendar.equals("local")?CalendarDestinations.local(getContext().getContentResolver(),CONFIGURATION):Long.parseLong(calendar);
   if(!CalendarDestinations.writable(getContext().getContentResolver(),calendarId)){c.resolve(status("read-only"));return;}
   boolean separate=Boolean.TRUE.equals(c.getBoolean("separateCreation"));
   // A timed-journal creation that is still unconfirmed blocks this one too, unless separate.
   if(!separate&&CalendarCreationStore.pendingCreations(getContext()).getJSONArray("creations").length()>0){c.resolve(status("pending-creation"));return;}
   ContentValues values=options.values(calendarId);
   c.resolve(OPTION_CREATIONS.create(getContext(),c.getString("creationId"),values,separate));
  }catch(IllegalArgumentException invalid){c.reject(invalid.getMessage()==null?"Invalid calendar event":invalid.getMessage());}
  catch(Exception uncertain){c.reject("Calendar write could not be confirmed. Check creation receipts before retrying.");}
 }
 /** Both journals: timed creations and option creations. Never retries. */
 @Override @PluginMethod public void pendingCreations(PluginCall c){
  if(!granted()){c.resolve(status("permission-required"));return;}
  try{
   JSObject timed=CalendarCreationStore.pendingCreations(getContext());JSArray all=new JSArray();
   org.json.JSONArray first=timed.getJSONArray("creations"),second=OPTION_CREATIONS.pendingCreations(getContext());
   for(int i=0;i<first.length();i++)all.put(first.get(i));for(int i=0;i<second.length();i++)all.put(second.get(i));
   JSObject out=status("ready");out.put("creations",all);c.resolve(out);
  }catch(Exception unavailable){c.reject("Calendar creation recovery unavailable. Nothing was retried.");}
 }
 @Override @PluginMethod public void acknowledgeCreation(PluginCall c){
  if(!granted()){c.resolve(status("permission-required"));return;}
  try{String id=c.getString("creationId");if(OPTION_CREATIONS.owns(getContext(),id))OPTION_CREATIONS.acknowledge(getContext(),id);else CalendarCreationStore.acknowledge(getContext(),id);c.resolve(status("acknowledged"));}
  catch(Exception unavailable){c.reject("Calendar creation receipt could not be acknowledged.");}
 }
 /** Provider readback of an event's all-day, zone and repeat fields for display and tests. */
 @PluginMethod public void readOptions(PluginCall c){
  if(!granted()){c.resolve(status("permission-required"));return;}
  try(Cursor row=getContext().getContentResolver().query(android.content.ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,Long.parseLong(c.getString("id",""))),new String[]{CalendarContract.Events.ALL_DAY,CalendarContract.Events.EVENT_TIMEZONE,CalendarContract.Events.RRULE,CalendarContract.Events.DURATION},null,null,null)){
   if(row==null||!row.moveToFirst()){c.resolve(status("missing"));return;}
   JSObject out=status("ready");out.put("allDay",row.getInt(0)==1);out.put("timeZone",row.getString(1));out.put("rrule",row.isNull(2)?"":row.getString(2));out.put("duration",row.isNull(3)?"":row.getString(3));c.resolve(out);
  }catch(Exception unavailable){c.reject("Calendar event could not be read");}
 }
 private boolean readGranted(){return androidx.core.content.ContextCompat.checkSelfPermission(getContext(),Manifest.permission.READ_CALENDAR)==android.content.pm.PackageManager.PERMISSION_GRANTED;}
 private boolean unlocked(){android.app.KeyguardManager keyguard=(android.app.KeyguardManager)getContext().getSystemService(android.content.Context.KEYGUARD_SERVICE);return keyguard!=null&&!keyguard.isDeviceLocked();}
 /**
  * Calendars the owner may choose for one foreground free/busy check. Read permission, the
  * unlocked foreground Activity and the requested time zone are all required; names and
  * accounts are for the on-phone picker. Statuses: ready, permission-required,
  * timezone-changed, unavailable.
  */
 @PluginMethod public void availabilitySources(PluginCall c){
  if(!readGranted()){c.resolve(status("permission-required"));return;}
  if(!foreground()||!unlocked()){c.resolve(status("unavailable"));return;}
  String zone=c.getString("timeZone");
  if(!CalendarAvailabilityReader.sameZone(zone,java.time.ZoneId.systemDefault())){c.resolve(status("timezone-changed"));return;}
  try{
   org.json.JSONArray calendars=CalendarAvailabilityReader.sources(getContext().getContentResolver());
   if(!readGranted()||!foreground()||!unlocked())throw new IllegalStateException();
   JSObject out=status("ready");out.put("timeZone",zone);out.put("calendars",calendars);c.resolve(out);
  }catch(Exception unavailable){c.resolve(status("unavailable"));}
 }
 /**
  * Free/busy rows of exactly the calendars the owner chose, bound to the source revisions
  * they reviewed. Returns intervals and availability only, never event content. Statuses:
  * ready, permission-required, timezone-changed, changed, too-many, unavailable, freshness-unknown.
  */
 @PluginMethod public void readAvailability(PluginCall c){
  if(!readGranted()){c.resolve(status("permission-required"));return;}
  if(!foreground()||!unlocked()){c.resolve(status("unavailable"));return;}
  java.time.ZoneId zone=java.time.ZoneId.systemDefault();
  if(!CalendarAvailabilityReader.sameZone(c.getString("timeZone"),zone)){c.resolve(status("timezone-changed"));return;}
  try{
   JSArray chosen=c.getArray("calendars");
   org.json.JSONArray events=CalendarAvailabilityReader.read(getContext().getContentResolver(),chosen==null?null:new org.json.JSONArray(chosen.toString()),c.getString("start"),c.getString("end"),zone);
   if(!readGranted()||!foreground()||!unlocked())throw new IllegalStateException();
   if(!java.time.ZoneId.systemDefault().equals(zone)){c.resolve(status("timezone-changed"));return;}
   JSObject out=status("ready");out.put("freshness","local");out.put("events",events);c.resolve(out);
  }catch(CalendarAvailabilityReader.SourceChanged changed){c.resolve(status("changed"));}
  catch(CalendarAvailabilityReader.FreshnessUnknown unknown){c.resolve(status("freshness-unknown"));}
  catch(CalendarAvailabilityReader.TooMany bound){c.resolve(status("too-many"));}
  catch(Exception unavailable){c.resolve(status("unavailable"));}
 }
 /**
  * One-tap ACTION_INSERT handoff to an installed Calendar editor, prefilled from the draft.
  * The editor owns the save: "opened" is not a save receipt. Alerts have no standard extra.
  */
 @PluginMethod public void insertHandoff(PluginCall c){
  try{
   if(!foreground()){c.resolve(status("unavailable"));return;}
   org.json.JSONObject draft=new org.json.JSONObject(c.getObject("event",new JSObject()).toString());
   Intent intent=CalendarInsertHandoff.intent(draft);
   android.content.pm.ResolveInfo editor=getContext().getPackageManager().resolveActivity(intent,0);
   if(editor==null||editor.activityInfo==null||getContext().getPackageName().equals(editor.activityInfo.packageName)){c.resolve(status("unavailable"));return;}
   getActivity().startActivity(intent);
   JSObject out=status("opened");out.put("alertsPrefilled",!CalendarInsertHandoff.alertsNeedEditor(draft));c.resolve(out);
  }catch(IllegalArgumentException invalid){c.resolve(status("invalid"));}
  catch(android.content.ActivityNotFoundException missing){c.resolve(status("unavailable"));}
  catch(Exception unknown){c.resolve(status("unknown"));}
 }
}
