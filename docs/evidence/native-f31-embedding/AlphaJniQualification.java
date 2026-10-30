package ai.elizaresearch.alphaphone;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
public final class AlphaJniQualification {
  private static void check(boolean ok,String msg) { if(!ok) throw new AssertionError(msg); }
  private static double checkVector(float[] v) {
    check(v!=null && v.length==384,"384 dimensions");
    double square=0; for(float x:v) { check(Float.isFinite(x),"finite"); square+=(double)x*x; }
    double norm=Math.sqrt(square); check(norm>0.999 && norm<1.001,"unit norm "+norm); return norm;
  }
  private static double cosine(float[] a,float[] b) { double dot=0,aa=0,bb=0;for(int i=0;i<a.length;i++){dot+=(double)a[i]*b[i];aa+=(double)a[i]*a[i];bb+=(double)b[i]*b[i];}return dot/Math.sqrt(aa*bb); }
  public static void main(String[] args) {
    check(args.length==1,"bundle argument");
    check(ElizaVoiceNative.ensureLoaded(),"actual Alpha loader: "+ElizaVoiceNative.getLoadError());
    check(ElizaVoiceNative.isLoaded(),"loaded flag");
    String abi=ElizaVoiceNative.nativeVoiceAbiVersion();check("20".equals(abi),"ABI20");
    check(ElizaVoiceNative.nativeEmbedSupported()==1,"embedding supported");
    long ctx=ElizaVoiceNative.nativeContextCreateUtf8(args[0].getBytes(StandardCharsets.UTF_8));check(ctx!=0,"context");
    try {
      String text="A reminder to buy fresh apples tomorrow.";byte[] utf8=text.getBytes(StandardCharsets.UTF_8);
      int[] tokens=ElizaVoiceNative.nativeTokenizeUtf8(ctx,utf8);
      int[] optionTokens=ElizaVoiceNative.nativeTokenizeWithOptionsUtf8(ctx,utf8,false);
      check(tokens!=null&&tokens.length>0&&Arrays.equals(tokens,optionTokens),"matching tokens");
      float[] legacy=ElizaVoiceNative.nativeEmbed(ctx,text,2);double n1=checkVector(legacy);
      float[] bytes=ElizaVoiceNative.nativeEmbedUtf8(ctx,utf8,2);double n2=checkVector(bytes);
      float[] options=ElizaVoiceNative.nativeEmbedWithOptionsUtf8(ctx,utf8,2,false);double n3=checkVector(options);
      float[] repeat=ElizaVoiceNative.nativeEmbedWithOptionsUtf8(ctx,utf8,2,false);double n4=checkVector(repeat);
      double same=cosine(bytes,options),stable=cosine(options,repeat);
      check(same>0.999999&&stable>0.999999,"matching deterministic embeddings");
      System.out.println("ALPHA_JNI_RESULT={\"status\":\"passed\",\"abi\":\""+abi+"\",\"className\":\"ai/elizaresearch/alphaphone/ElizaVoiceNative\",\"loader\":\"actual ensureLoaded\",\"dimensions\":384,\"tokenCount\":"+tokens.length+",\"norms\":["+n1+","+n2+","+n3+","+n4+"],\"matchingCosine\":"+same+",\"repeatCosine\":"+stable+"}");
    } finally {ElizaVoiceNative.nativeContextDestroy(ctx);}
  }
}
