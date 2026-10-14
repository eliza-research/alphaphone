package ai.elizaresearch.alphaphone;

/** Plain-JVM check of the assistant invocation origin rule. Not an Android or device test. */
public final class AssistInvocationTest {
 private static void check(boolean condition,String name){if(!condition)throw new AssertionError(name);}
 public static void main(String[] args){
  check(AssistInvocation.origin("ai.elizaresearch.alphaphone.sense",true).equals("listener"),"same-signer listener");
  check(AssistInvocation.origin("ai.elizaresearch.alphaphone.sense",false).equals("assist"),"a differently signed package with the listener's name is not the listener");
  for(String other:new String[]{null,"","com.android.systemui","ai.elizaresearch.alphaphone","ai.elizaresearch.alphaphone.sense.evil","AI.ELIZARESEARCH.ALPHAPHONE.SENSE"})
   check(AssistInvocation.origin(other,true).equals("assist"),"other caller "+other);
  System.out.println("PASS assist invocation");
 }
}
