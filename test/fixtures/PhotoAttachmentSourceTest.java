package ai.elizaresearch.alphaphone;
import java.io.*;
import java.util.*;
public class PhotoAttachmentSourceTest {
 static PhotoAttachmentSource.Metadata metadata(String name,String mime,long size,String revision,String identity){return new PhotoAttachmentSource.Metadata(name,mime,size,revision,identity);}
 static final PhotoAttachmentSource.Metadata GOOD=metadata("photo.png","image/png",99,"revision","volume:91");
 static class Source implements PhotoAttachmentSource.Source {
  byte[] data={1,2,3};int reads,opened;boolean closed;PhotoAttachmentSource.Metadata first=GOOD,last=GOOD;
  public PhotoAttachmentSource.Metadata inspect(){return reads++==0?first:last;}
  public InputStream open(){opened++;return new ByteArrayInputStream(data){public void close(){closed=true;}};}
 }
 interface Attempt{void run()throws Exception;}
 static void rejects(Attempt attempt)throws Exception{try{attempt.run();throw new AssertionError("accepted unsafe source");}catch(IOException|SecurityException expected){}}
 public static void main(String[] args)throws Exception{
  Source source=new Source();PhotoAttachmentSource.Copy copy=PhotoAttachmentSource.read(source,()->{});
  if(!Arrays.equals(copy.bytes,source.data)||!source.closed||!copy.sha256.equals("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81"))throw new AssertionError("exact readable bytes/hash/close");
  for(PhotoAttachmentSource.Metadata changed:new PhotoAttachmentSource.Metadata[]{metadata("other.png","image/png",99,"revision","volume:91"),metadata("photo.png","image/jpeg",99,"revision","volume:91"),metadata("photo.png","image/png",98,"revision","volume:91"),metadata("photo.png","image/png",99,"new","volume:91"),metadata("photo.png","image/png",99,"revision","volume:92")}){Source item=new Source();item.last=changed;rejects(()->PhotoAttachmentSource.read(item,()->{}));if(!item.closed)throw new AssertionError("unclosed changed source");}
  Source revoked=new Source();int[] guards={0};rejects(()->PhotoAttachmentSource.read(revoked,()->{if(++guards[0]==3)throw new SecurityException();}));if(!revoked.closed)throw new AssertionError("unclosed revoked source");
  Source oversized=new Source();oversized.data=new byte[PhotoAttachmentSource.MAX_BYTES+1];rejects(()->PhotoAttachmentSource.read(oversized,()->{}));if(!oversized.closed)throw new AssertionError("unclosed oversized source");
  Source empty=new Source();empty.data=new byte[0];rejects(()->PhotoAttachmentSource.read(empty,()->{}));
  for(PhotoAttachmentSource.Metadata invalid:new PhotoAttachmentSource.Metadata[]{metadata("../photo.png","image/png",99,"r","i"),metadata("photo.gif","image/gif",99,"r","i"),metadata("photo.png","image/png",PhotoAttachmentSource.MAX_BYTES+1L,"r","i"),metadata("photo.png","image/png",99,"","i")}){Source item=new Source();item.first=invalid;rejects(()->PhotoAttachmentSource.read(item,()->{}));if(item.opened!=0)throw new AssertionError("invalid source opened");}
  // Copy completion may precede pause/selection revocation while delivery waits for the UI thread.
  boolean[] current={true};int[] delivered={0},rejected={0};
  Runnable queued=()->PhotoAttachmentSource.publish(()->{if(!current[0])throw new SecurityException();},()->delivered[0]++,()->rejected[0]++);
  current[0]=false;queued.run();if(delivered[0]!=0||rejected[0]!=1)throw new AssertionError("late byte publication");
  current[0]=true;queued.run();if(delivered[0]!=1||rejected[0]!=1)throw new AssertionError("current byte publication");
  System.out.println("PASS photo attachment source");
 }
}
