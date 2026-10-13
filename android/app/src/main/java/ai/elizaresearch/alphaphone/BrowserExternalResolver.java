package ai.elizaresearch.alphaphone;

import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;

/** Public SDK browser admission: general HTTPS handlers, never host/path deep links. */
final class BrowserExternalResolver {
 static Intent probe(){return new Intent(Intent.ACTION_VIEW,Uri.parse("https://alpha-browser-handoff.invalid/")).addCategory(Intent.CATEGORY_DEFAULT).addCategory(Intent.CATEGORY_BROWSABLE);}
 static boolean genericHttps(IntentFilter filter){
  return filter!=null&&filter.hasAction(Intent.ACTION_VIEW)&&filter.hasCategory(Intent.CATEGORY_DEFAULT)
   &&filter.hasCategory(Intent.CATEGORY_BROWSABLE)&&filter.hasDataScheme("https")
   &&filter.countDataAuthorities()==0&&filter.countDataPaths()==0&&filter.countDataSchemeSpecificParts()==0&&filter.countDataTypes()==0;
 }
 private BrowserExternalResolver(){}
}
