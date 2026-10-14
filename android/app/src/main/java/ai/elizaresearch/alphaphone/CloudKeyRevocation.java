package ai.elizaresearch.alphaphone;

import java.net.HttpURLConnection;
import java.net.URI;

/**
 * Best-effort server-side revocation of this phone's Eliza Cloud sign-in key during Reset Alpha
 * data. One DELETE of the presented key's own self-revocation route (ConnectionRoutes
 * cloudSelfRevocation), short timeouts, never retried, and every failure is ignored: the local
 * reset proceeds whatever Cloud answers, and the key also expires on its own. Plain Java so the
 * policy is compiled and run on the JVM without Android.
 */
final class CloudKeyRevocation {
 private CloudKeyRevocation(){}
 static final int TIMEOUT_MS=3000;
 /** Production always; staging only in test-mocks builds. */
 static String[] environments(boolean testMocks){return testMocks?new String[]{"production","staging"}:new String[]{"production"};}
 static String endpoint(String environment){
  if("production".equals(environment))return "https://api.eliza.app/api/v1/api-keys/current";
  if("staging".equals(environment))return "https://api-staging.eliza.app/api/v1/api-keys/current";
  throw new IllegalArgumentException();
 }
 /** The bearer value of a saved Cloud credential, or null. Only a printable ASCII token is used. */
 static String bearer(String token){
  if(token==null||token.length()<8||token.length()>16384)return null;
  for(int i=0;i<token.length();i++)if(token.charAt(i)<=0x20||token.charAt(i)>=0x7f)return null;
  return token;
 }
 /** One attempt. Returns true only for a 2xx answer; never throws. */
 static boolean revoke(String environment,String token,boolean testMocks){
  HttpURLConnection connection=null;
  try{
   String value=bearer(token);if(value==null)return false;
   URI url=URI.create(endpoint(environment));
   if(!ConnectionRoutes.cloudSelfRevocation(url.getScheme(),url.getHost(),url.getPort(),url.getRawPath(),url.getRawQuery(),"DELETE",false,testMocks))return false;
   connection=(HttpURLConnection)url.toURL().openConnection();
   connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);
   connection.setConnectTimeout(TIMEOUT_MS);connection.setReadTimeout(TIMEOUT_MS);
   connection.setRequestMethod("DELETE");
   connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("Authorization","Bearer "+value);
   int status=connection.getResponseCode();
   return status>=200&&status<300;
  }catch(Exception ignored){return false;}
  finally{if(connection!=null)connection.disconnect();}
 }
}
