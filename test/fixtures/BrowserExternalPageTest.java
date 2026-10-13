package ai.elizaresearch.alphaphone;
public final class BrowserExternalPageTest {
 public static void main(String[] args){
  String own="https://localhost/";
  for(String page:new String[]{"https://accounts.example/signin?continue=x#step","https://example.com:8443/"})if(!BrowserExternalPage.allowed(page,own))throw new AssertionError(page);
  for(String page:new String[]{"http://example.com/","javascript:alert(1)","file:///x","content://x/y","intent://x","https://user:secret@example.com/","https://localhost/","https://LOCALHOST:443/","https://example.com/\n","https://example.com\\@other.invalid/","https:///missing","https://example.com/"+"x".repeat(4096)})if(BrowserExternalPage.allowed(page,own))throw new AssertionError(page);
  if(!BrowserExternalPage.eligible("alpha","browser",true,true,true))throw new AssertionError();
  if(BrowserExternalPage.eligible("alpha","alpha",true,true,true)||BrowserExternalPage.eligible("alpha",null,true,true,true)||BrowserExternalPage.eligible("alpha","browser",false,true,true)||BrowserExternalPage.eligible("alpha","browser",true,false,true)||BrowserExternalPage.eligible("alpha","deep-link-app",true,true,false))throw new AssertionError("unsafe resolver admitted");
  java.util.concurrent.atomic.AtomicInteger mode=new java.util.concurrent.atomic.AtomicInteger(2);
  BrowserPasskeys.disable(()->mode.set(0),mode::get,0);
  BrowserPasskeys.disable(()->{throw new UnsupportedOperationException();},mode::get,0);
  mode.set(2);
  try{BrowserPasskeys.disable(()->{throw new UnsupportedOperationException();},mode::get,0);throw new AssertionError("broken provider enabled passkeys");}catch(UnsupportedOperationException expected){}
  try{BrowserPasskeys.disable(()->{},mode::get,0);throw new AssertionError("ignored setting enabled passkeys");}catch(IllegalStateException expected){}
  System.out.println("PASS external page and deferred passkey policy");
 }
}
