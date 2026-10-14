package ai.elizaresearch.alphaphone;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Objects;

/** Copies provider-readable source bytes, never a thumbnail or an unredacted-location request. */
final class PhotoAttachmentSource {
 static final int MAX_BYTES=5*1024*1024;
 static final class Metadata {
  final String name,mime,revision,identity;final long size;
  Metadata(String name,String mime,long size,String revision,String identity){this.name=name;this.mime=mime;this.size=size;this.revision=revision;this.identity=identity;}
  boolean same(Metadata other){return other!=null&&size==other.size&&Objects.equals(name,other.name)&&Objects.equals(mime,other.mime)&&Objects.equals(revision,other.revision)&&Objects.equals(identity,other.identity);}
 }
 interface Source {Metadata inspect()throws Exception;InputStream open()throws Exception;}
 interface Guard {void check()throws Exception;}
 static final class Copy {
  final Metadata metadata;final byte[] bytes;final String sha256;
  Copy(Metadata metadata,byte[] bytes)throws Exception{this.metadata=metadata;this.bytes=bytes;StringBuilder hash=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))hash.append(String.format(Locale.ROOT,"%02x",b&255));sha256=hash.toString();}
 }
 static Copy read(Source source,Guard guard)throws Exception{
  guard.check();Metadata before=source.inspect();
  if(before==null||before.name==null||before.name.isBlank()||before.name.length()>120||before.name.matches(".*[\\\\/\\p{Cntrl}].*")||before.size<=0||before.size>MAX_BYTES||before.revision==null||before.revision.isEmpty()||before.identity==null||before.identity.isEmpty())throw new IOException("Invalid selected photo metadata");
  if(!java.util.Arrays.asList("image/png","image/jpeg","image/webp").contains(before.mime))throw new IOException("Unsupported photo type");
  guard.check();ByteArrayOutputStream bytes=new ByteArrayOutputStream();long deadline=System.nanoTime()+10_000_000_000L;
  try(InputStream input=source.open()){
   if(input==null)throw new IOException("Photo unavailable");byte[] block=new byte[16384];int count;
   while((count=input.read(block))!=-1){guard.check();if(System.nanoTime()>deadline)throw new IOException("Photo read timed out");if(bytes.size()+count>MAX_BYTES)throw new IOException("Photo exceeds 5 MiB");bytes.write(block,0,count);}
  }
  guard.check();if(bytes.size()==0||!before.same(source.inspect()))throw new IOException("Selected photo changed");guard.check();
  // Actual readable size can differ from MediaStore's stored size after Android's privacy
  // redaction. Preserve those exact readable bytes; never request ACCESS_MEDIA_LOCATION.
  return new Copy(before,bytes.toByteArray());
 }
 /** Called on the UI thread: a completed copy still needs current delivery authority. */
 static void publish(Guard current,Runnable resolve,Runnable reject){
  try{current.check();}catch(Exception unavailable){reject.run();return;}
  resolve.run();
 }
 private PhotoAttachmentSource(){}
}
