package ai.elizaresearch.alphaphone;
/** Do not enable unqualified WebAuthn; tolerate a broken setter only if NONE is verified. */
final class BrowserPasskeys {
 static void disable(Runnable disable,java.util.function.IntSupplier current,int none){
  try{disable.run();}catch(RuntimeException unsupported){
   if(current.getAsInt()!=none)throw unsupported;
   return;
  }
  if(current.getAsInt()!=none)throw new IllegalStateException("Passkeys could not be disabled");
 }
 private BrowserPasskeys(){}
}
