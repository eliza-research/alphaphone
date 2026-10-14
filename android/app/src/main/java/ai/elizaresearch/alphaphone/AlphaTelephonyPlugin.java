package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.app.role.RoleManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.provider.Telephony;
import android.telecom.TelecomManager;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.telephony.TelephonyManager;
import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import org.json.JSONObject;

/**
 * Contacts, Telecom and SMS on the Alpha AOSP image only (issues #420 and #421). MainActivity
 * registers this plugin only when {@link AlphaImageCapability} verifies the image, so a standalone APK
 * or a sideloaded launcher APK has no such plugin; each method checks the capability again.
 *
 * Reads: the device's own Telecom/SMS roles, default handlers and active subscriptions (SIM slot and
 * carrier; phone-state access required) and contacts through the shared bounded AlphaContactsCatalog
 * (contacts access required, read-only). Effects are handoffs: the user's dialer opens with the
 * number and the user's SMS app opens with the reviewed recipients and text. Alpha never places a
 * call or sends a message itself here, and never reports one as placed or sent. Emergency numbers go
 * to the system dialer like any other number. Roles are requested only through Android's own dialog
 * and only when Alpha declares the components the role needs.
 */
@CapacitorPlugin(name = "AlphaTelephony", permissions = {
 @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS }),
 @Permission(alias = "phoneState", strings = { Manifest.permission.READ_PHONE_STATE })
})
public class AlphaTelephonyPlugin extends Plugin {
 static final Pattern NUMBER = Pattern.compile("^\\+?[0-9]{2,20}$");
 static final int MAX_RECIPIENTS = 10, MAX_BODY = 5000, MAX_SUBSCRIPTIONS = 8, MAX_TEXT = 256, MAX_LIST = 32;
 private final ExecutorService reader = Executors.newSingleThreadExecutor();

 private volatile boolean closed, foreground = true;
 private final NativeReadEpoch generation = new NativeReadEpoch();
 private final java.util.Set<android.os.CancellationSignal> reads = java.util.concurrent.ConcurrentHashMap.newKeySet();
 private final android.content.BroadcastReceiver screenOff = new android.content.BroadcastReceiver() {
  @Override public void onReceive(android.content.Context context, Intent intent) { invalidateReads(); }
 };
 @Override public void load() {
  androidx.core.content.ContextCompat.registerReceiver(getContext(), screenOff, new android.content.IntentFilter(Intent.ACTION_SCREEN_OFF), androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED);
 }
 private boolean unlockedForeground() {
  android.app.KeyguardManager lock = getContext().getSystemService(android.app.KeyguardManager.class);
  android.os.UserManager users = getContext().getSystemService(android.os.UserManager.class);
  return !closed && foreground && lock != null && !lock.isDeviceLocked() && users != null && users.isUserUnlocked()
   && (android.os.Build.VERSION.SDK_INT < 31 || users.isUserForeground()) && getActivity() != null && !getActivity().isFinishing() && !getActivity().isDestroyed();
 }
 private void invalidateReads() { generation.incrementAndGet(); for (android.os.CancellationSignal read : reads) read.cancel(); }
 @Override protected void handleOnPause() { foreground = false; invalidateReads(); super.handleOnPause(); }
 @Override protected void handleOnResume() { foreground = true; invalidateReads(); super.handleOnResume(); }
 private boolean refused(PluginCall call) {
  if (call == null) return true;
  if (AlphaImageCapability.verified(getContext()) && unlockedForeground()) return false;
  call.reject(AlphaImageCapability.UNAVAILABLE, "unavailable");
  return true;
 }
 static String clip(CharSequence value) {
  String text = value == null ? "" : value.toString();
  return text.length() > MAX_TEXT ? text.substring(0, MAX_TEXT) : text;
 }

 // Capacitor's inherited permission request launches through the activity; answer a late call instead of throwing.
 @Override @PluginMethod public void requestPermissions(PluginCall call) { if (refused(call)) return; LateLaunch.ask(call, () -> super.requestPermissions(call)); }
 @Override @PluginMethod public void checkPermissions(PluginCall call) { if (refused(call)) return; super.checkPermissions(call); }

 @PluginMethod public void imageCapability(PluginCall call) {
  if (refused(call)) return;
  JSObject value = new JSObject();
  value.put("version", 1); value.put("image", true); value.put("feature", AlphaImageCapability.featureName(getContext().getPackageName()));
  call.resolve(value);
 }

 @PluginMethod public void status(PluginCall call) { if (!refused(call)) call.resolve(statusObject()); }

 private JSObject roleState(RoleManager roles, String role, boolean eligible) {
  JSObject value = new JSObject();
  boolean available = roles != null && roles.isRoleAvailable(role);
  value.put("available", available);
  value.put("held", available && roles.isRoleHeld(role));
  value.put("eligible", eligible);
  return value;
 }
 /** Whether Alpha declares what Android requires before it grants the role. A request that could
  * only be refused is never shown. */
 boolean eligibleFor(String role) {
  PackageManager packages = getContext().getPackageManager();
  String self = getContext().getPackageName();
  if (RoleManager.ROLE_DIALER.equals(role))
   return declares(packages.queryIntentActivities(new Intent(Intent.ACTION_DIAL).setPackage(self), 0))
     && declares(packages.queryIntentServices(new Intent("android.telecom.InCallService").setPackage(self), 0));
  if (RoleManager.ROLE_SMS.equals(role))
   return declares(packages.queryBroadcastReceivers(new Intent(Telephony.Sms.Intents.SMS_DELIVER_ACTION).setPackage(self), 0))
     && declares(packages.queryBroadcastReceivers(new Intent(Telephony.Sms.Intents.WAP_PUSH_DELIVER_ACTION).setPackage(self), 0));
  return false;
 }
 private static boolean declares(List<ResolveInfo> found) { return found != null && !found.isEmpty(); }

 JSObject statusObject() {
  JSObject value = new JSObject();
  TelephonyManager telephony = getContext().getSystemService(TelephonyManager.class);
  TelecomManager telecom = getContext().getSystemService(TelecomManager.class);
  RoleManager roles = getContext().getSystemService(RoleManager.class);
  value.put("version", 1);
  value.put("voiceCapable", telephony != null && telephony.isVoiceCapable());
  value.put("smsCapable", telephony != null && telephony.isSmsCapable());
  JSObject permissions = new JSObject();
  PermissionState contacts = getPermissionState("contacts"), phoneState = getPermissionState("phoneState");
  permissions.put("contacts", contacts.toString());
  permissions.put("phoneState", phoneState.toString());
  value.put("permissions", permissions);
  JSObject roleStates = new JSObject();
  roleStates.put("dialer", roleState(roles, RoleManager.ROLE_DIALER, eligibleFor(RoleManager.ROLE_DIALER)));
  roleStates.put("sms", roleState(roles, RoleManager.ROLE_SMS, eligibleFor(RoleManager.ROLE_SMS)));
  value.put("roles", roleStates);
  String dialer = null, sms = null;
  try { dialer = telecom == null ? null : telecom.getDefaultDialerPackage(); } catch (RuntimeException unreadable) { dialer = null; }
  try { sms = Telephony.Sms.getDefaultSmsPackage(getContext()); } catch (RuntimeException unreadable) { sms = null; }
  value.put("defaultDialer", dialer == null ? JSONObject.NULL : dialer);
  value.put("defaultSms", sms == null ? JSONObject.NULL : sms);
  value.put("subscriptions", phoneState == PermissionState.GRANTED ? subscriptions() : JSONObject.NULL);
  return value;
 }
 /** Active SIM subscriptions, or JSON null when Android refuses the read: never an empty list in its place. */
 private Object subscriptions() {
  SubscriptionManager manager = getContext().getSystemService(SubscriptionManager.class);
  if (manager == null) return JSONObject.NULL;
  List<SubscriptionInfo> active;
  try { active = manager.getActiveSubscriptionInfoList(); }
  catch (SecurityException denied) { return JSONObject.NULL; }
  JSArray rows = new JSArray();
  if (active == null) return rows;
  int sms = SubscriptionManager.getDefaultSmsSubscriptionId(), voice = SubscriptionManager.getDefaultVoiceSubscriptionId();
  for (SubscriptionInfo info : active) {
   if (rows.length() >= MAX_SUBSCRIPTIONS) break;
   if (info == null || info.getSubscriptionId() < 0 || info.getSimSlotIndex() < 0) continue;
   JSObject row = new JSObject();
   row.put("id", info.getSubscriptionId()); row.put("slot", info.getSimSlotIndex());
   row.put("displayName", clip(info.getDisplayName())); row.put("carrierName", clip(info.getCarrierName()));
   row.put("defaultSms", info.getSubscriptionId() == sms); row.put("defaultVoice", info.getSubscriptionId() == voice);
   rows.put(row);
  }
  return rows;
 }

 /** Asks for contacts or phone-state access in Android's own dialog, only from an explicit request. */
 @PluginMethod public void requestAccess(PluginCall call) {
  if (refused(call)) return;
  String access = call.getString("access", "");
  if (!"contacts".equals(access) && !"phoneState".equals(access)) { call.reject("Choose contacts or phone-state access", "invalid"); return; }
  if (getPermissionState(access) == PermissionState.GRANTED) { call.resolve(statusObject()); return; }
  LateLaunch.ask(call, () -> requestPermissionForAlias(access, call, "accessResult"));
 }
 @PermissionCallback private void accessResult(PluginCall call) { invalidateReads(); if (!refused(call)) call.resolve(statusObject()); }

 /** Opens Android's role dialog for the dialer or SMS role. The user decides; the result is re-read. */
 @PluginMethod public void requestRole(PluginCall call) {
  if (refused(call)) return;
  String name = call.getString("role", "");
  String role = "dialer".equals(name) ? RoleManager.ROLE_DIALER : "sms".equals(name) ? RoleManager.ROLE_SMS : null;
  if (role == null) { call.reject("Choose the dialer or SMS role", "invalid"); return; }
  RoleManager roles = getContext().getSystemService(RoleManager.class);
  if (roles == null || !roles.isRoleAvailable(role)) { call.reject("This device does not offer that role", "unavailable"); return; }
  if (roles.isRoleHeld(role)) { call.resolve(statusObject()); return; }
  if (!eligibleFor(role)) { call.reject("Alpha Phone cannot hold this role in this build. Your current app keeps it.", "not-eligible"); return; }
  LateLaunch.ask(call, () -> startActivityForResult(call, roles.createRequestRoleIntent(role), "roleResult"));
 }
 @ActivityCallback private void roleResult(PluginCall call, ActivityResult result) { if (!refused(call)) call.resolve(statusObject()); }

 /** Bounded same-profile reads, cancelled on background and checked again before publication. */
 @PluginMethod public void searchContacts(PluginCall call) {
  if (refused(call)) return;
  if (getPermissionState("contacts") != PermissionState.GRANTED) { call.reject("Contacts access is not granted", "permission-required"); return; }
  String query = call.getString("query", ""); Integer limit = call.getInt("limit", 25);
  if (query == null || query.length() > 128 || limit == null || limit < 1 || limit > 100) { call.reject("Invalid contact search", "invalid"); return; }
  final long access = generation.get();
  final android.os.CancellationSignal cancel = new android.os.CancellationSignal(); reads.add(cancel);
  try {
   reader.execute(() -> {
    try {
     if (!contactAccess(access, cancel)) throw new SecurityException();
     JSObject bounded = new AlphaContactsCatalog(getContext()).list(query, limit, cancel);
     JSArray records = new JSArray(); org.json.JSONArray rows = bounded.getJSONArray("contacts");
     for (int i=0;i<rows.length();i++) { org.json.JSONObject row=rows.getJSONObject(i);JSObject item=new JSObject();
      item.put("id",row.getString("id"));item.put("lookupKey",row.getString("lookup").length()>512?"":row.getString("lookup"));item.put("displayName",clip(row.getString("name")));item.put("starred",row.getBoolean("starred"));
      JSArray phones=new JSArray(),emails=new JSArray();for(int j=0;j<row.getJSONArray("phones").length();j++)phones.put(clip(row.getJSONArray("phones").getString(j)));for(int j=0;j<row.getJSONArray("emails").length();j++)emails.put(clip(row.getJSONArray("emails").getString(j)));item.put("phoneNumbers",phones);item.put("emailAddresses",emails);records.put(item);
     }
     JSObject value = new JSObject();value.put("contacts",records);
     getActivity().runOnUiThread(() -> {
      if (!contactAccess(access, cancel)) call.reject("Contacts access changed. Refresh after unlocking.", "unavailable");
      else call.resolve(value);
     });
    } catch (Exception unreadable) { call.reject("Contacts could not be read. Check access and refresh.", "unavailable"); }
    finally { reads.remove(cancel); }
   });
  } catch (java.util.concurrent.RejectedExecutionException closed) { reads.remove(cancel); call.reject(LateLaunch.CLOSED); }
 }
 private boolean contactAccess(long access, android.os.CancellationSignal cancel) {
  return !cancel.isCanceled() && generation.current(access, "contacts", "contacts", unlockedForeground())
   && AlphaImageCapability.verified(getContext()) && getPermissionState("contacts") == PermissionState.GRANTED;
 }

 private JSObject handoff(String status, String target, String handler, String message) {
  JSObject value = new JSObject();
  value.put("status", status); value.put("target", target); value.put("handler", handler == null ? JSONObject.NULL : handler); value.put("message", message);
  return value;
 }
 private void open(PluginCall call, Intent intent, String target, String done) {
  if (refused(call)) return;
  ResolveInfo handler = getContext().getPackageManager().resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY);
  if (handler == null || handler.activityInfo == null) { call.resolve(handoff("unavailable", target, null, "No app on this phone handles this.")); return; }
  try {
   getActivity().startActivity(intent);
   String name = "android".equals(handler.activityInfo.packageName) ? null : handler.activityInfo.packageName;
   call.resolve(handoff("handed-off", target, name, done));
  } catch (ActivityNotFoundException missing) {
   call.resolve(handoff("unavailable", target, null, "No app on this phone handles this."));
  } catch (RuntimeException failure) {
   call.resolve(handoff("failed", target, null, "The app could not be opened. Nothing was sent or dialed."));
  }
 }

 /** Opens the user's dialer with this number. The call is placed, or not, there. */
 @PluginMethod public void dial(PluginCall call) {
  if (refused(call)) return;
  String number = call.getString("number", "");
  if (number == null || !NUMBER.matcher(number).matches()) { call.reject("Not a dialable phone number", "invalid"); return; }
  open(call, new Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null)), "dialer",
    "Your phone app is open with the number. Place the call there; Alpha does not know whether it connects.");
 }

 /** Opens the user's SMS app with the reviewed recipients and text. Sending happens there. A handoff
  * cannot choose the SIM: the SMS app asks or uses its default, so a SIM choice is refused here. */
 @PluginMethod public void composeSms(PluginCall call) {
  if (refused(call)) return;
  if (call.getData().has("subscriptionId")) { call.reject("Choose the SIM in your messaging app", "invalid"); return; }
  JSArray recipients = call.getArray("recipients");
  String body = call.getString("body", "");
  if (recipients == null || recipients.length() < 1 || recipients.length() > MAX_RECIPIENTS || body == null || body.trim().isEmpty() || body.length() > MAX_BODY) { call.reject("Invalid message", "invalid"); return; }
  StringBuilder to = new StringBuilder();
  for (int index = 0; index < recipients.length(); index++) {
   String number = recipients.optString(index, "");
   if (!NUMBER.matcher(number).matches()) { call.reject("Invalid recipient", "invalid"); return; }
   if (to.length() > 0) to.append(';');
   to.append(number);
  }
  Intent intent = new Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", to.toString(), null)).putExtra("sms_body", body);
  open(call, intent, "sms", "Your messaging app is open with the reviewed text. Send it there; Alpha has not sent anything.");
 }

 @Override protected void handleOnDestroy() { closed = true; invalidateReads(); getContext().unregisterReceiver(screenOff); reader.shutdown(); super.handleOnDestroy(); }
}
