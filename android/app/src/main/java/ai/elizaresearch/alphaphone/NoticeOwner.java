package ai.elizaresearch.alphaphone;
import org.json.JSONObject;
/** Common account identity; workflow and digest scopes have different extra inputs. */
final class NoticeOwner {
 static JSONObject identity(JSONObject value)throws Exception {
  if(value==null)return null;
  if(value.length()!=3)throw new IllegalArgumentException("Invalid notice owner");
  JSONObject result=new JSONObject();
  for(String key:new String[]{"origin","ownerId","agentId"}){Object raw=value.get(key);if(!(raw instanceof String))throw new IllegalArgumentException("Invalid notice owner");String text=(String)raw;if(text.isBlank()||text.length()>(key.equals("origin")?2048:128)||text.indexOf('\0')>=0)throw new IllegalArgumentException("Invalid notice owner");result.put(key,text);}
  return result;
 }
 static boolean matches(JSONObject owner,JSONObject route)throws Exception {
  if(owner==null)return false;owner=identity(owner);
  for(String key:new String[]{"origin","ownerId","agentId"})if(!owner.getString(key).equals(route.getString(key)))return false;
  return true;
 }
 static JSONObject fromRoute(JSONObject route)throws Exception {JSONObject result=new JSONObject();for(String key:new String[]{"origin","ownerId","agentId"})result.put(key,route.getString(key));return identity(result);}
}
