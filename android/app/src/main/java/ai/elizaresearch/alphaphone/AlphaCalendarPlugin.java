package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.actionjournal.deletion.DeferredDeletionCoordinator;
import ai.eliza.plugins.actionjournal.deletion.DeletionDispatchClaim;

import android.Manifest;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import ai.eliza.plugins.calendar.CalendarConfiguration;
import ai.eliza.plugins.calendar.CalendarPlugin;
import ai.eliza.plugins.calendar.write.CalendarOptionCreationStore;

/** Keep installed calendar/journal identity stable while sharing provider behavior. */
@CapacitorPlugin(name="AlphaCalendar", permissions={@Permission(alias="calendar",strings={Manifest.permission.READ_CALENDAR,Manifest.permission.WRITE_CALENDAR}),@Permission(alias="workflowCalendarRead",strings={Manifest.permission.READ_CALENDAR})})
public final class AlphaCalendarPlugin extends CalendarPlugin {
 static final CalendarConfiguration CONFIGURATION=new CalendarConfiguration(
  "Alpha Phone","alpha-phone-local","On this phone","alpha-calendar-creations-v1","alphaphone://calendar-creation/",0xff0000ff,2000);
 /** Compatibility alias for installed-state fixtures; the shared bridge owns both journals. */
 static final CalendarOptionCreationStore OPTION_CREATIONS=new CalendarOptionCreationStore(CONFIGURATION);
 public AlphaCalendarPlugin(){super(CONFIGURATION);}
 private final java.util.concurrent.ExecutorService deleteOwnerWorker=java.util.concurrent.Executors.newSingleThreadExecutor();
 private static final class DeleteOwner{org.json.JSONObject owner,identity,operation;}
 private final java.util.concurrent.ConcurrentHashMap<String,DeleteOwner> deleteOwners=new java.util.concurrent.ConcurrentHashMap<>();
 private volatile boolean deletionRetired;
 private CalendarSyncBridge calendarSync;
 private synchronized CalendarSyncBridge calendarSync(){if(calendarSync==null)calendarSync=new CalendarSyncBridge(this);return calendarSync;}
 void calendarSyncChanged(){notifyListeners("calendarSyncChanged",new JSObject());}
 @PluginMethod public void sync(PluginCall call){calendarSync().call(call);}
 private CalendarScopedDeletionReview scopedDeletion;
 private synchronized CalendarScopedDeletionReview scopedDeletion(){if(scopedDeletion==null)scopedDeletion=new CalendarScopedDeletionReview(this);return scopedDeletion;}
 @PluginMethod public void inspectDeletion(PluginCall call){scopedDeletion().inspect(call);}
 @PluginMethod public void removeScoped(PluginCall call){scopedDeletion().review(call,null);}
 @Override protected boolean deferReviewedDeletion(){return true;}
 @Override protected JSObject enqueueReviewedDeletion(org.json.JSONObject target,String operationId)throws Exception{
  DeferredDeletionCoordinator coordinator=NativeDeletionCoordinator.get(getContext());DeleteOwner captured=operationId==null?null:deleteOwners.remove(operationId);
  if(operationId!=null&&(captured==null||captured.owner==null))throw new SecurityException("Agent deletion review expired");
  org.json.JSONObject owner=captured==null?coordinator.manualOwner():captured.owner;
  // Owner precondition before the permanent claim: a refusal leaves nothing claimed (reported as a conflict, nothing changed).
  if(!coordinator.stageAdmissible(owner))throw new SecurityException("Deletion owner changed during review");
  String id=operationId==null?java.util.UUID.randomUUID().toString():operationId;
  if(captured!=null){DeletionDispatchClaim.check(AlphaActionJournal.get(getContext()),captured.identity,operationId,captured.operation,owner,true);target.put("journalBinding",DeletionDispatchClaim.binding(AlphaActionJournal.get(getContext()),captured.identity));}
  try{return JSObject.fromJSONObject(new org.json.JSONObject().put("status","queued").put("deletion",coordinator.stageCalendar(target,owner,id)));}
  catch(Exception failure){
   // A stage that persisted before failing (for example while scheduling expiry) is still pending: never report it as unchanged.
   org.json.JSONObject staged;try{staged=coordinator.receipt("calendar",id);}catch(Exception unreadable){return status("unknown");}
   if(staged!=null)return JSObject.fromJSONObject(new org.json.JSONObject().put("status","queued").put("deletion",staged));
   throw failure;
  }
 }
 @Override @PluginMethod public void executeAgent(PluginCall call){
  JSObject operation=call.getObject("operation");if(operation==null||!"calendar_delete".equals(operation.optString("type"))){super.executeAgent(call);return;}
  String id=call.getString("operationId","");if(!id.matches("[A-Za-z0-9_-]{1,128}")||deleteOwners.size()>=32){call.reject("Deletion review unavailable");return;}
  DeleteOwner ticket=new DeleteOwner();if(deleteOwners.putIfAbsent(id,ticket)!=null){call.resolve(status("busy"));return;}
  PluginCall owned=new PluginCall(null,call.getPluginId(),call.getCallbackId(),call.getMethodName(),call.getData()){
   @Override public void resolve(JSObject value){deleteOwners.remove(id,ticket);call.resolve(value);}
   @Override public void resolve(){deleteOwners.remove(id,ticket);call.resolve();}
   @Override public void reject(String message){deleteOwners.remove(id,ticket);call.reject(message);}
  };
  try{deleteOwnerWorker.execute(()->{try{
   ticket.owner=NativeDeletionCoordinator.get(getContext()).agentOwner();ticket.identity=call.getObject("journalIdentity");ticket.operation=new org.json.JSONObject(operation.toString());
   DeletionDispatchClaim.check(AlphaActionJournal.get(getContext()),ticket.identity,id,ticket.operation,ticket.owner,false);
   getActivity().runOnUiThread(()->{if(deletionRetired||deleteOwners.get(id)!=ticket||!foreground()){deleteOwners.remove(id,ticket);call.resolve(status("cancelled"));return;}if(operation.optJSONObject("target").optString("eventId").startsWith("delete2:"))scopedDeletion().review(owned,operation);else super.executeAgent(owned);});
  }catch(Exception unavailable){deleteOwners.remove(id,ticket);call.reject("Authenticated local agent is unavailable for deletion review.");}});}catch(java.util.concurrent.RejectedExecutionException retired){deleteOwners.remove(id,ticket);call.resolve(status("cancelled"));}
 }
 @Override @PluginMethod public void cancelAgent(PluginCall call){deleteOwners.remove(call.getString("operationId",""));super.cancelAgent(call);}
 @Override protected void handleOnPause(){if(scopedDeletion!=null)scopedDeletion.pause();if(calendarSync!=null)calendarSync.pause();super.handleOnPause();}
 @Override protected void handleOnDestroy(){if(scopedDeletion!=null)scopedDeletion.destroy();if(calendarSync!=null)calendarSync.destroy();deletionRetired=true;deleteOwners.clear();deleteOwnerWorker.shutdown();super.handleOnDestroy();}

 /** Capacitor's own permission request launches through the activity; see {@link LateLaunch}. */
 @Override @PluginMethod public void requestPermissions(PluginCall call){LateLaunch.ask(call,()->super.requestPermissions(call));}
 /** The shared calendar plugin asks for its permissions inside these two methods; see {@link LateLaunch}. */
 @Override @PluginMethod public void requestAccess(PluginCall call){LateLaunch.ask(call,()->super.requestAccess(call));}
 @Override @PluginMethod public void requestWorkflowReadAccess(PluginCall call){LateLaunch.ask(call,()->super.requestWorkflowReadAccess(call));}
 private static JSObject status(String value){JSObject out=new JSObject();out.put("status",value);return out;}
 private boolean foreground(){return getActivity()!=null&&!getActivity().isFinishing()&&!getActivity().isDestroyed()&&getActivity().hasWindowFocus();}
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
  if(!CalendarZones.sameZone(zone,java.time.ZoneId.systemDefault())){c.resolve(status("timezone-changed"));return;}
  try{
   org.json.JSONArray calendars=ai.eliza.plugins.calendar.read.SelectedCalendarReader.availabilitySources(getContext().getContentResolver());
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
  if(!CalendarZones.sameZone(c.getString("timeZone"),zone)){c.resolve(status("timezone-changed"));return;}
  try{
   JSArray chosen=c.getArray("calendars");
   org.json.JSONArray selected=chosen==null?null:new org.json.JSONArray(chosen.toString());
   // A changed source is reported as changed before freshness is judged; an unknown-freshness
   // source refuses the whole read before any instance is queried.
   if(selected!=null)ai.eliza.plugins.calendar.read.SelectedCalendarReader.assertSourceIdentities(getContext().getContentResolver(),selected);
   CalendarSyncFreshness.requireLocal(getContext().getContentResolver(),selected);
   org.json.JSONArray events=ai.eliza.plugins.calendar.read.SelectedCalendarReader.readAvailability(getContext().getContentResolver(),selected,c.getString("start"),c.getString("end"),zone);
   if(!readGranted()||!foreground()||!unlocked())throw new IllegalStateException();
   if(!java.time.ZoneId.systemDefault().equals(zone)){c.resolve(status("timezone-changed"));return;}
   JSObject out=status("ready");out.put("freshness","local");out.put("events",events);c.resolve(out);
  }catch(ai.eliza.plugins.calendar.read.SelectedCalendarReader.SourceChanged changed){c.resolve(status("changed"));}
  catch(CalendarSyncFreshness.FreshnessUnknown unknown){c.resolve(status("freshness-unknown"));}
  catch(ai.eliza.plugins.calendar.read.SelectedCalendarReader.TooMany bound){c.resolve(status("too-many"));}
  catch(Exception unavailable){c.resolve(status("unavailable"));}
 }
}
