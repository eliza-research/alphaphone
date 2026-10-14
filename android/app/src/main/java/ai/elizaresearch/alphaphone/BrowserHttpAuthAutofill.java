package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.passwords.PasswordFormPolicy;
import ai.eliza.plugins.securestore.nativeonly.PasswordAutofillPolicy;
import android.content.Context;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.ViewStructure;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;

/**
 * Origin-bound password-manager fill for the browser's native HTTP authentication prompt
 * (issue #404). The prompt is Alpha-owned native UI, so without an origin a provider would
 * see only Alpha's package and could save or fill a site password against the app identity.
 * Provider fill/save is currently disabled by BrowserHttpAuthOrigin. If a future engine
 * supplies authenticated origins, each field would report the exact HTTPS origin of the
 * challenge: web domain and scheme, the committed top-level origin extra and the per-field
 * origin extra required by the shared password policy. When no single secure origin can be
 * established the fields are excluded from Autofill instead of guessing.
 *
 * <p>Values are never read back by Alpha: the provider receives them through Android's
 * framework, and only after the user picks a credential in the provider's own UI.
 */
final class BrowserHttpAuthAutofill {
 private BrowserHttpAuthAutofill(){}

 /** The single verified HTTPS origin for this challenge, or null (see {@link BrowserHttpAuthOrigin}). */
 static String origin(String reportedHost,String pendingMain,String documentUrl,boolean committed,java.util.Collection<String> otherRequests){ return BrowserHttpAuthOrigin.forChallenge(reportedHost,pendingMain,documentUrl,committed,otherRequests); }

 /** A username or password field of the HTTP authentication prompt. */
 static EditText field(Context context,String origin,boolean password){
  EditText field=new OriginField(context,origin);
  field.setSingleLine(true);
  field.setHint(password?"Password":"Username");
  // No suggestions or personalised learning; only the password field is a password type, so the
  // shared policy sees exactly one username and one password.
  field.setInputType(InputType.TYPE_CLASS_TEXT|(password?InputType.TYPE_TEXT_VARIATION_PASSWORD:InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS));
  field.setImeOptions(EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);
  if(origin==null){field.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);return field;}
  field.setAutofillHints(password?View.AUTOFILL_HINT_PASSWORD:View.AUTOFILL_HINT_USERNAME);
  field.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_YES);
  return field;
 }

 private static final class OriginField extends androidx.appcompat.widget.AppCompatEditText {
  private final String origin;
  OriginField(Context context,String origin){super(context);this.origin=origin;}
  @Override public void onProvideAutofillStructure(ViewStructure structure,int flags){
   super.onProvideAutofillStructure(structure,flags);
   if(origin==null)return;
   // ViewStructure parses scheme and host from this value; the port travels in the extras.
   structure.setWebDomain(origin);
   Bundle extras=structure.getExtras();
   if(extras==null)return;
   extras.putString(PasswordFormPolicy.TOP_ORIGIN_EXTRA,origin);
   extras.putString(PasswordAutofillPolicy.FIELD_ORIGIN,origin);
  }
 }
}
