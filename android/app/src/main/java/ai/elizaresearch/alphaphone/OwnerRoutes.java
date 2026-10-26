package ai.elizaresearch.alphaphone;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Interpreter for config/owner-routes.json, the owner-bound routes the renderer may reach; the renderer reads the
 * same table through owner-route-policy.ts. Domain validation and mutation authority stay in the Eliza services. */
final class OwnerRoutes {
 interface Assets{java.io.InputStream open(String name) throws java.io.IOException;}
 private static final Pattern MALFORMED_ESCAPE=Pattern.compile("%(?![0-9A-Fa-f]{2})"),DOT_SEGMENT=Pattern.compile("/\\.{1,2}(/|$)");
 private static final class Route{List<String> methods,paths,query;}
 private static final class Group{List<String> prefixes;Pattern id;final List<Route> routes=new ArrayList<>();}
 private static OwnerRoutes shipped;
 private final Pattern unsafe;
 private final Map<String,Group> groups=new HashMap<>();

 OwnerRoutes(String table) throws JSONException {
  JSONObject json=new JSONObject(table),entries=json.getJSONObject("groups");
  unsafe=Pattern.compile(json.getString("unsafe"));
  for(java.util.Iterator<String> names=entries.keys();names.hasNext();){
   String name=names.next();JSONObject entry=entries.getJSONObject(name);Group group=new Group();
   group.prefixes=strings(entry.getJSONArray("prefixes"));
   if(entry.has("id"))group.id=Pattern.compile(entry.getString("id"));
   JSONArray routes=entry.getJSONArray("routes");
   for(int i=0;i<routes.length();i++){
    JSONObject row=routes.getJSONObject(i);Route route=new Route();
    route.methods=strings(row.getJSONArray("methods"));route.paths=strings(row.getJSONArray("paths"));route.query=row.has("query")?strings(row.getJSONArray("query")):null;
    for(String path:route.paths)if(path.contains("{id}")&&group.id==null)throw new JSONException("Owner route group "+name+" has an {id} route but no id pattern");
    group.routes.add(route);
   }
   groups.put(name,group);
  }
 }
 /** The table packaged from config/owner-routes.json, read once per process. Any failure to load it (missing or empty
  * asset, malformed JSON, invalid pattern or table) is an IllegalStateException, which callers refuse on; it is not cached. */
 static synchronized OwnerRoutes shipped(Assets assets){
  if(shipped==null)try(java.io.InputStream table=assets.open("owner-routes.json")){shipped=new OwnerRoutes(new java.util.Scanner(table,"UTF-8").useDelimiter("\\A").next());}
  catch(Exception unavailable){throw new IllegalStateException("Owner route table unavailable",unavailable);}
  return shipped;
 }
 /** The group, among those named or else all, whose longest prefix claims the path; null when none does. */
 String group(String path,String... among){
  String claimant=null;int longest=-1;
  for(String name:among.length>0?java.util.Arrays.asList(among):groups.keySet())for(String prefix:named(name).prefixes)
   if(path!=null&&prefix.length()>longest&&(path.equals(prefix)||path.startsWith(prefix+"/")||path.startsWith(prefix+"?"))){claimant=name;longest=prefix.length();}
  return claimant;
 }
 boolean allowed(String name,String path,String method){
  Group group=named(name);
  if(path==null||path.length()>2048||!path.startsWith("/")||path.startsWith("//")||unsafe.matcher(path).find()||MALFORMED_ESCAPE.matcher(path).find())return false;
  String[] parts=path.split("\\?",-1);if(parts.length>2)return false;
  String raw=parts[0];if(raw.contains("//")||DOT_SEGMENT.matcher(raw).find())return false;
  List<String> keys=new ArrayList<>();
  if(parts.length==2&&!parts[1].isEmpty())for(String pair:parts[1].split("&",-1)){String key=decode(pair.split("=",2)[0]);if(key==null||keys.contains(key))return false;keys.add(key);}
  for(Route route:group.routes)if(route.methods.contains(method)&&(route.query==null||route.query.containsAll(keys)))for(String pattern:route.paths){
   String id=segment(pattern,route.query!=null?raw:path);
   String value=id!=null&&route.query!=null?decode(id):id;
   if(id!=null&&(id.isEmpty()||value!=null&&group.id.matcher(value).matches()))return true;
  }
  return false;
 }
 /** The named group; an unknown name is a caller error, never a group that admits nothing or everything. */
 private Group named(String name){
  Group group=groups.get(name);
  if(group==null)throw new IllegalArgumentException("Unknown owner route group "+name);
  return group;
 }
 /** The {id} segment of path under pattern, "" when the pattern has none, null when the path does not fit it. */
 private static String segment(String pattern,String path){
  int at=pattern.indexOf("{id}");
  if(at<0)return pattern.equals(path)?"":null;
  String head=pattern.substring(0,at),tail=pattern.substring(at+4);
  if(path.length()<=head.length()+tail.length()||!path.startsWith(head)||!path.endsWith(tail))return null;
  String id=path.substring(head.length(),path.length()-tail.length());
  return id.indexOf('/')<0?id:null;
 }
 private static List<String> strings(JSONArray values) throws JSONException {
  List<String> list=new ArrayList<>();
  for(int i=0;i<values.length();i++)list.add(values.getString(i));
  return list;
 }
 /** decodeURIComponent: '+' stays literal; an undecodable value is null, which callers refuse. */
 private static String decode(String value){
  try{return java.net.URLDecoder.decode(value.replace("+","%2B"),"UTF-8");}catch(Exception invalid){return null;}
 }
}
