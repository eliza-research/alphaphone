package ai.elizaresearch.alphaphone;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigInteger;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;
import java.util.Random;

/** Host-JVM check of the one-tap update admission. Not Android, PackageInstaller or network evidence. */
public final class AppUpdateTransferTest {
 private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 private static String sha256(byte[] bytes)throws Exception{return String.format("%064x",new BigInteger(1,MessageDigest.getInstance("SHA-256").digest(bytes)));}
 private static boolean admitted(InputStream in,byte[] expected,long size,String digest){
  ByteArrayOutputStream out=new ByteArrayOutputStream();
  try{AppUpdateTransfer.copyVerified(in,out,size,digest);check(Arrays.equals(out.toByteArray(),expected),"admitted bytes are copied unchanged");return true;}
  catch(IOException refused){return false;}
 }
 private static boolean admitted(byte[] body,long size,String digest){return admitted(new ByteArrayInputStream(body),body,size,digest);}
 public static void main(String[] args)throws Exception {
  byte[] apk=new byte[200_000];new Random(7).nextBytes(apk);String digest=sha256(apk);
  check(admitted(apk,apk.length,digest),"the declared size and digest are admitted");
  check(!admitted(apk,apk.length-1,digest),"a download longer than declared is refused");
  check(!admitted(apk,apk.length+1,digest),"a download shorter than declared is refused");
  byte[] changed=apk.clone();changed[1234]^=1;
  check(!admitted(changed,changed.length,digest),"changed bytes are refused");
  check(!admitted(apk,apk.length,digest.toUpperCase(Locale.ROOT)),"a digest is 64 lowercase hex characters");
  check(!admitted(apk,apk.length,digest.substring(1))&&!admitted(apk,apk.length,null),"a short or missing digest is refused");
  check(!admitted(new byte[0],0,sha256(new byte[0])),"an empty APK is refused");
  // Refused before any byte is read: an undeclared or oversized APK is never downloaded.
  InputStream unread=new InputStream(){@Override public int read(){throw new AssertionError("read before admission");}};
  check(!admitted(unread,new byte[0],AppUpdateTransfer.MAX_BYTES+1,digest)&&!admitted(unread,new byte[0],-1,digest),"sizes outside 1..MAX_BYTES are refused");
  check(AppUpdateTransfer.MAX_BYTES==1024L*1024*1024,"the bound is 1 GiB");
  System.out.println("PASS app update transfer");
 }
}
