package ai.elizaresearch.alphaphone;

import org.json.JSONObject;

/** Narrow preparation route; the existing bridge still requires its current owner. */
final class PreparedViewNavigation {
 static boolean allowed(String path,String method,String body) {
  if(!"POST".equals(method)||path==null||!path.matches("^/api/views/[A-Za-z0-9_-]+/navigate$")||body==null||body.length()>4096)return false;
  try {
   JSONObject value=new JSONObject(body);
   if(value.length()!=5)return false;
   for(String key:new String[]{"clientId","delivery","prepareOnly","viewType","completedActionHandoffId"})if(!value.has(key))return false;
   return "completed-action".equals(value.opt("delivery"))&&Boolean.TRUE.equals(value.opt("prepareOnly"))&&"gui".equals(value.opt("viewType"))&&
    value.opt("clientId") instanceof String&&((String)value.opt("clientId")).matches("[A-Za-z0-9._-]{1,128}")&&
    value.opt("completedActionHandoffId") instanceof String&&((String)value.opt("completedActionHandoffId")).matches("[A-Za-z0-9._:-]{1,128}");
  }catch(Exception invalid){return false;}
 }
}
