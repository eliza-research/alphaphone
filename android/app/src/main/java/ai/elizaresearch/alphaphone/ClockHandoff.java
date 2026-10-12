package ai.elizaresearch.alphaphone;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.provider.AlarmClock;
import com.getcapacitor.JSObject;

/** Standard Clock intents only. A launched Activity is not an alarm mutation receipt. */
final class ClockHandoff {
 private ClockHandoff() {}
 /** Repeat days use java.util.Calendar values (SUNDAY=1 … SATURDAY=7), unique and ascending. */
 static java.util.ArrayList<Integer> days(Object raw) {
  if(raw==null||raw==org.json.JSONObject.NULL)return null;
  if(!(raw instanceof org.json.JSONArray))throw new IllegalArgumentException("Choose valid repeat days");
  org.json.JSONArray input=(org.json.JSONArray)raw;java.util.ArrayList<Integer> out=new java.util.ArrayList<>();
  if(input.length()<1||input.length()>7)throw new IllegalArgumentException("Choose valid repeat days");
  for(int i=0;i<input.length();i++){Object v=input.opt(i);if(!(v instanceof Number))throw new IllegalArgumentException("Choose valid repeat days");double n=((Number)v).doubleValue();if(n!=Math.rint(n)||n<1||n>7)throw new IllegalArgumentException("Choose valid repeat days");out.add((int)n);}
  return days(out);
 }
 static java.util.ArrayList<Integer> days(java.util.List<Integer> input) {
  if(input==null)return null;
  java.util.ArrayList<Integer> out=new java.util.ArrayList<>();
  for(Integer day:input){if(day==null||day<java.util.Calendar.SUNDAY||day>java.util.Calendar.SATURDAY||(!out.isEmpty()&&day<=out.get(out.size()-1)))throw new IllegalArgumentException("Choose valid repeat days");out.add(day);}
  if(out.isEmpty())throw new IllegalArgumentException("Choose valid repeat days");
  return out;
 }
 static Intent intent(String action, Integer hour, Integer minute, String label, Integer snoozeMinutes) {return intent(action,hour,minute,label,snoozeMinutes,null);}
 static Intent intent(String action, Integer hour, Integer minute, String label, Integer snoozeMinutes, java.util.List<Integer> repeatDays) {
  java.util.ArrayList<Integer> days=days(repeatDays);
  if(days!=null&&!"set".equals(action))throw new IllegalArgumentException("Repeat days apply only to a new alarm");
  if(action==null)throw new IllegalArgumentException("Choose a Clock action");
  Intent intent;
  switch(action) {
   case "set":
    if(hour==null||minute==null||hour<0||hour>23||minute<0||minute>59||snoozeMinutes!=null)throw new IllegalArgumentException("Choose a valid alarm time");
    if(label==null||label.length()>200||label.indexOf(0)>=0)throw new IllegalArgumentException("Use an alarm label up to 200 characters");
    intent=new Intent(AlarmClock.ACTION_SET_ALARM).putExtra(AlarmClock.EXTRA_HOUR,hour).putExtra(AlarmClock.EXTRA_MINUTES,minute).putExtra(AlarmClock.EXTRA_MESSAGE,label).putExtra(AlarmClock.EXTRA_SKIP_UI,false);
    if(days!=null)intent.putExtra(AlarmClock.EXTRA_DAYS,days);break;
   case "show":
   case "dismiss":
    if(hour!=null||minute!=null||label!=null||snoozeMinutes!=null)throw new IllegalArgumentException("Unexpected Clock options");
    // Do not use ALL, inferred labels or an untrusted deep link to select another alarm.
    intent=new Intent(action.equals("show")?AlarmClock.ACTION_SHOW_ALARMS:AlarmClock.ACTION_DISMISS_ALARM);break;
   case "snooze":
    if(hour!=null||minute!=null||label!=null||snoozeMinutes==null||snoozeMinutes<1||snoozeMinutes>60)throw new IllegalArgumentException("Choose 1 to 60 snooze minutes");
    intent=new Intent(AlarmClock.ACTION_SNOOZE_ALARM).putExtra(AlarmClock.EXTRA_ALARM_SNOOZE_DURATION,snoozeMinutes);break;
   default:throw new IllegalArgumentException("Unsupported Clock action");
  }
  return intent;
 }
 static JSObject result(String action,String status,String message) {
  JSObject out=new JSObject();out.put("action",action);out.put("status",status);out.put("message",message);return out;
 }
 static JSObject launch(Activity activity,String action,Integer hour,Integer minute,String label,Integer snoozeMinutes,boolean reviewed) {
  return launch(activity,action,hour,minute,label,snoozeMinutes,reviewed,null);
 }
 static JSObject launch(Activity activity,String action,Integer hour,Integer minute,String label,Integer snoozeMinutes,boolean reviewed,String timeZone) {
  return launch(activity,action,hour,minute,label,snoozeMinutes,reviewed,timeZone,null);
 }
 static JSObject launch(Activity activity,String action,Integer hour,Integer minute,String label,Integer snoozeMinutes,boolean reviewed,String timeZone,java.util.List<Integer> repeatDays) {
  if(!reviewed)return result(action,"failed","Review the Clock request before continuing");
  try {
   Intent target=intent(action,hour,minute,label,snoozeMinutes,repeatDays);
   if(activity==null||activity.isFinishing()||activity.isDestroyed()||!activity.hasWindowFocus())return result(action,"failed","Open Alpha Phone before continuing to Clock");
   KeyguardManager guard=(KeyguardManager)activity.getSystemService(Context.KEYGUARD_SERVICE);
   if(guard!=null&&guard.isKeyguardLocked())return result(action,"failed","Unlock the phone before continuing to Clock");
   if(target.resolveActivity(activity.getPackageManager())==null)return result(action,"unavailable","No installed Clock app handles this action");
   if(timeZone!=null){
    String requested=timeZone.matches("[+-][0-9]{2}:[0-9]{2}")?timeZone:android.icu.util.TimeZone.getCanonicalID(timeZone);
    String current=android.icu.util.TimeZone.getCanonicalID(java.util.TimeZone.getDefault().getID());
    if(!"set".equals(action)||!ClockTimeZones.same(requested,current))return result(action,"failed","Phone time zone changed. Review the Clock request again.");
   }
   activity.startActivity(target);
   return result(action,"opened","Clock request sent. Check the Clock app; Alpha cannot confirm an alarm was changed.");
  } catch(ActivityNotFoundException missing) {return result(action,"unavailable","The Clock app is no longer available");}
  catch(SecurityException denied) {return result(action,"denied","Android did not allow this Clock action");}
  catch(IllegalArgumentException invalid) {return result(action,"failed",invalid.getMessage());}
  catch(RuntimeException unknown) {return result(action,"unknown","Clock result is unknown. Check Clock before trying again.");}
 }
}
