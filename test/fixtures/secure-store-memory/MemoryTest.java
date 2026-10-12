import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
import java.io.File;
public final class MemoryTest {
 public static void main(String[] args)throws Exception{
  final int cap=32*1024*1024;
  JsonCredentialSlots store=new JsonCredentialSlots(new File(args[0]),"fixture",slot->cap);
  // Same nested serialized envelope shape that exhausted the Android 192 MiB heap.
  String prefix="{\"currentRaw\":\"{\\\"body\\\":\\\"",suffix="\\\"}\"}";
  String value=prefix+"F".repeat(cap-prefix.length()-suffix.length())+suffix;
  System.out.println("write");store.write("large",value);
  System.out.println("read");if(!value.equals(store.read("large")))throw new AssertionError("Read changed bytes");
  System.out.println("CAS");if(!store.compareExchange("large",value,"{}"))throw new AssertionError("CAS failed");value=null;
  if(!"{}".equals(store.read("large")))throw new AssertionError("CAS not persisted");
  for(String invalid:new String[]{"{broken","{} trailing","[1,2"}){
   try{store.write("large",invalid);throw new AssertionError("Invalid JSON accepted");}catch(org.json.JSONException|IllegalArgumentException expected){}
   if(!"{}".equals(store.read("large")))throw new AssertionError("Invalid JSON changed slot");
  }
  for(String invalid:new String[]{"{broken","{} trailing","[1,2"}){
   javax.crypto.Cipher cipher=javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
   cipher.init(javax.crypto.Cipher.ENCRYPT_MODE,new javax.crypto.spec.SecretKeySpec(new byte[32],"AES"));
   cipher.updateAAD(store.slotHash("large").getBytes(java.nio.charset.StandardCharsets.US_ASCII));
   try(java.io.FileOutputStream out=new java.io.FileOutputStream(store.slotFile(store.slotHash("large")).getBaseFile())){
    out.write(1);out.write(12);out.write(cipher.getIV());out.write(cipher.doFinal(invalid.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
   }
   try{store.read("large");throw new AssertionError("Authenticated invalid JSON accepted");}catch(org.json.JSONException|IllegalArgumentException expected){}
  }
  store.write("large","{}");
  if(store.compareExchange("large","wrong","null"))throw new AssertionError("Stale CAS accepted");
  for(int mode=1;mode<=4;mode++){
   android.util.AtomicFile.corruptNextCommit=mode;
   try{store.write("corrupt","{}");throw new AssertionError("Corrupted committed bytes accepted: "+mode);}catch(IllegalStateException expected){}
  }
  System.out.println("PASS 32 MiB authenticated write/read/CAS with 192 MiB heap");
 }
}
