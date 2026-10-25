package ai.elizaresearch.alphaphone;
public final class BrowserExternalPageTest {
 public static void main(String[] args){
  String own="https://localhost/";
  for(String page:new String[]{"https://accounts.example/signin?continue=x#step","https://example.com:8443/"})if(!BrowserExternalPage.allowed(page,own))throw new AssertionError(page);
  for(String page:new String[]{"http://example.com/","javascript:alert(1)","file:///x","content://x/y","intent://x","https://user:secret@example.com/","https://localhost/","https://LOCALHOST:443/","https://example.com/\n","https://example.com\\@other.invalid/","https:///missing","https://example.com/"+"x".repeat(4096)})if(BrowserExternalPage.allowed(page,own))throw new AssertionError(page);
  if(!BrowserExternalPage.eligible("alpha","browser",true,true,true))throw new AssertionError();
  if(BrowserExternalPage.eligible("alpha","alpha",true,true,true)||BrowserExternalPage.eligible("alpha",null,true,true,true)||BrowserExternalPage.eligible("alpha","browser",false,true,true)||BrowserExternalPage.eligible("alpha","browser",true,false,true)||BrowserExternalPage.eligible("alpha","deep-link-app",true,true,false))throw new AssertionError("unsafe resolver admitted");
  System.out.println("PASS external page admission");
 }
}
