package ai.eliza.plugins.system;
public final class SystemFacts {
 public interface Fact {Object read()throws Exception;}
 public static void fact(java.util.Map<String,Object> out,String key,Fact source){try{Object value=source.read();if(value!=null)out.put(key,value);}catch(Exception unknown){/* Unknown stays absent. */}}
}
