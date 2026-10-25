package ai.elizaresearch.alphaphone;

import java.net.URI;
import org.json.JSONObject;

/** Same release-owned configuration as the renderer. Never trusts network-supplied origins. */
final class CloudDeployment {
 static JSONObject get(String environment) throws Exception {
  if (!"production".equals(environment) && !"staging".equals(environment)) throw new SecurityException("Invalid Cloud environment");
  JSONObject config = new JSONObject(BuildConfig.CLOUD_DEPLOYMENTS).getJSONObject(environment);
  URI api = new URI(config.getString("api"));
  if (!"https".equals(api.getScheme()) || api.getHost()==null || api.getRawUserInfo()!=null || api.getRawQuery()!=null || api.getRawFragment()!=null || !api.getRawPath().isEmpty()) throw new SecurityException("Invalid Cloud API");
  if (!config.getString("agents").matches("[a-z0-9]+(?:[.-][a-z0-9]+)*\\.[a-z]{2,}") || !config.getString("tenant").matches("[A-Za-z0-9_-]{1,100}")) throw new SecurityException("Invalid Cloud deployment");
  return config;
 }
 static String api(String environment) throws Exception { return get(environment).getString("api"); }
 static String agents(String environment) throws Exception { return get(environment).getString("agents"); }
 static String slot(String environment) throws Exception {
  JSONObject c=get(environment); String api=c.getString("api"),tenant=c.getString("tenant");
  boolean standard="production".equals(environment) ? api.equals("https://api.eliza.app")&&tenant.equals("elizacloud") : api.equals("https://api-staging.eliza.app")&&tenant.equals("elizacloud-staging");
  return "cloud:"+environment+(standard?"":":"+api+":"+tenant);
 }
 static boolean authorize(URI url) throws Exception {
  for(String environment:new String[]{"production","staging"})
   if(url.toString().startsWith(api(environment)+"/") && "/steward/auth/oauth/google/authorize".equals(url.getPath())) return true;
  return false;
 }
}
