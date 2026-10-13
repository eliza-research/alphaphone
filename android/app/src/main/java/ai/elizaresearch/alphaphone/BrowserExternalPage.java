package ai.elizaresearch.alphaphone;

import java.net.URI;
/** Admission for an explicitly reviewed external-browser handoff. No cookies or page data. */
final class BrowserExternalPage {
 static boolean allowed(String page,String appPage){
  try{
   if(page==null||page.length()>4096||page.indexOf('\\')>=0||page.chars().anyMatch(c->c<=32||c==127))return false;
   URI url=new URI(page),host=new URI(appPage);
   if(!"https".equalsIgnoreCase(url.getScheme())||url.getHost()==null||url.getRawUserInfo()!=null)return false;
   return !(url.getHost().equalsIgnoreCase(host.getHost())&&port(url)==port(host)&&url.getScheme().equalsIgnoreCase(host.getScheme()));
  }catch(Exception invalid){return false;}
 }
 private static int port(URI url){return url.getPort()<0?("https".equalsIgnoreCase(url.getScheme())?443:80):url.getPort();}
 static boolean eligible(String ownPackage,String packageName,boolean enabled,boolean exported,boolean allWebLinks){
  return packageName!=null&&!packageName.equals(ownPackage)&&enabled&&exported&&allWebLinks;
 }
 private BrowserExternalPage(){}
}
