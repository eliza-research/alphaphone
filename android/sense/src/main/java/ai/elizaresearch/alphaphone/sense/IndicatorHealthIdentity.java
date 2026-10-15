package ai.elizaresearch.alphaphone.sense;

/** Image-pinned SystemUI identity, deliberately independent of Alpha's signing key. */
public final class IndicatorHealthIdentity {
 public static final String SYSTEM_UI="com.android.systemui";
 public static boolean accepts(int callingUid,int installedUid,boolean primaryUser,boolean enabled,
   boolean system,boolean privileged,boolean statusBarPermission,String[] packages,
   String expectedCertificate,String installedCertificate){
  return callingUid==installedUid&&callingUid>=10000&&callingUid<20000&&primaryUser&&enabled
   &&system&&privileged&&statusBarPermission&&packages!=null&&packages.length==1
   &&SYSTEM_UI.equals(packages[0])&&expectedCertificate!=null
   &&expectedCertificate.matches("[a-f0-9]{64}")&&expectedCertificate.equals(installedCertificate);
 }
 private IndicatorHealthIdentity(){}
}
