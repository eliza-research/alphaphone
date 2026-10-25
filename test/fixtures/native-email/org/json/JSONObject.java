package org.json;

import java.util.HashMap;
import java.util.Map;

/** Test transport facade: map copies only; not an Android JSON/encryption implementation. */
public class JSONObject {
 public static final Object NULL = new Object();
 private static int next;
 private static final Map<String, Map<String,Object>> frames = new HashMap<>();
 private final Map<String,Object> values = new HashMap<>();
 public JSONObject() {}
 public JSONObject(String frame) {
  if (!frames.containsKey(frame)) throw new IllegalArgumentException("Unknown fixture frame");
  values.putAll(frames.get(frame));
 }
 public JSONObject put(String key,Object value) { values.put(key,value); return this; }
 public Object opt(String key) { return values.get(key); }
 public boolean has(String key) { return values.containsKey(key); }
 public String optString(String key,String fallback) { Object value=opt(key); return value instanceof String?(String)value:fallback; }
 public String optString(String key) { return optString(key,""); }
 public JSONObject optJSONObject(String key) { Object value=opt(key);return value instanceof JSONObject?(JSONObject)value:null; }
 public String getString(String key) { Object value=opt(key);if(!(value instanceof String))throw new IllegalArgumentException(key);return (String)value; }
 @Override public String toString() { String frame="fixture-frame-"+(++next);frames.put(frame,new HashMap<>(values));return frame; }
}
