package ai.elizaresearch.alphaphone;

public final class MediaLibraryKeyTest {
 private static void check(boolean value){if(!value)throw new AssertionError();}
 public static void main(String[] args){
  for(String volume:new String[]{"external_primary","1234-abcd"})for(boolean video:new boolean[]{false,true})for(long id:new long[]{1,99,Long.MAX_VALUE}){
   MediaLibraryKey expected=new MediaLibraryKey(volume,id,video),actual=MediaLibraryKey.parse(expected.toString());
   check(actual.volume.equals(volume)&&actual.id==id&&actual.video==video);
  }
  check(!new MediaLibraryKey("external_primary",5,false).toString().equals(new MediaLibraryKey("1234-abcd",5,false).toString()));
  check(!new MediaLibraryKey("external_primary",5,false).toString().equals(new MediaLibraryKey("external_primary",5,true).toString()));
  for(String invalid:new String[]{"5","v:5","m:external:i:5","m:internal:i:5","m:external_primary:i:0","m:external_primary:i:-1","m:external_primary:i:01","m:external_primary:i:9223372036854775808","m:external_primary:i:1:extra","m:external_primary:x:1","m:../external_primary:i:1","m:10@external_primary:i:1","content://media/external/images/1","m:external_primary:i:1\u0000"}){
   boolean rejected=false;try{MediaLibraryKey.parse(invalid);}catch(IllegalArgumentException expected){rejected=true;}check(rejected);
  }
  System.out.println("PASS media library keys");
 }
}
