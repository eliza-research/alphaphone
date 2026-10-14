package ai.elizaresearch.alphaphone;

/**
 * How Alpha's assistant surface was opened. Only identity Android reports (the launching package,
 * shared deliberately by the caller) and a same-signer check are used; caller extras never are.
 * "listener" means the AOSP image's always-on listener heard the wake phrase; every other start
 * (press-and-hold power through the assistant role, the system assist gesture, a launcher or
 * another app) is "assist". Pure Java so the rule runs on the JVM in repository tests.
 */
final class AssistInvocation {
 private AssistInvocation(){}
 static final String LISTENER="listener",ASSIST="assist";
 static final String LISTENER_PACKAGE="ai.elizaresearch.alphaphone.sense";

 static String origin(String launchedFromPackage,boolean sameSigner){
  return LISTENER_PACKAGE.equals(launchedFromPackage)&&sameSigner?LISTENER:ASSIST;
 }
}
