package ai.elizaresearch.alphaphone;
public final class ResetAuthorizationTest {
 static void check(boolean value){if(!value)throw new AssertionError();}
 public static void main(String[] args){
  ResetAuthorization reset=new ResetAuthorization();long one=reset.begin();check(!reset.authenticate(one,true));
  long two=reset.begin();check(reset.confirm(two));check(!reset.authenticate(two,false));
  long old=reset.begin();check(reset.confirm(old));reset.retire();check(!reset.authenticate(old,true));
  long now=reset.begin();check(reset.confirm(now));check(!reset.authenticate(old,true));check(reset.authenticate(now,true));check(!reset.authenticate(now,true));
  long after=reset.begin();try{reset.begin();throw new AssertionError();}catch(IllegalStateException expected){}check(!reset.authenticate(after,true));
  ResetAuthorization restarted=new ResetAuthorization();check(!restarted.authenticate(now,true));
  System.out.println("PASS fresh confirmation, cancellation, duplicate, retirement and stale authentication");
 }
}
