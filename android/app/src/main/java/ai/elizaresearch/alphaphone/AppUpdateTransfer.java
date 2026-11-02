package ai.elizaresearch.alphaphone;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigInteger;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * The one-tap update APK as AlphaUpdatePlugin admits it: exactly the manifest's size, at most
 * MAX_BYTES, with the manifest's SHA-256. Capacitor-free, so the host JVM runs it
 * (test/fixtures/AppUpdateTransferTest.java).
 */
final class AppUpdateTransfer {
 /** UPDATE_MAX_BYTES in apps/app/src/runtime/app-update.ts is the same bound. */
 static final long MAX_BYTES=1L<<30;
 private AppUpdateTransfer(){}
 /** Copies the download, then throws unless it was exactly sizeBytes long and hashes to sha256 (64 lowercase hex). */
 static void copyVerified(InputStream in,OutputStream out,long sizeBytes,String sha256)throws IOException{
  if(sizeBytes<=0||sizeBytes>MAX_BYTES||sha256==null||!sha256.matches("[0-9a-f]{64}"))throw new IOException("Update not admitted");
  MessageDigest digest;
  try{digest=MessageDigest.getInstance("SHA-256");}catch(NoSuchAlgorithmException unavailable){throw new IOException(unavailable);}
  byte[] buffer=new byte[65536];long total=0;
  for(int count;(count=in.read(buffer))!=-1;){
   total+=count;if(total>sizeBytes)throw new IOException("Update larger than declared");
   digest.update(buffer,0,count);out.write(buffer,0,count);
  }
  if(total!=sizeBytes||!String.format("%064x",new BigInteger(1,digest.digest())).equals(sha256))throw new IOException("Update does not match its manifest");
 }
}
