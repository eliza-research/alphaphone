package ai.elizaresearch.alphaphone.sense;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Decides, from a local transcript of one utterance, whether the user addressed the assistant.
 * Only an utterance that begins with the assistant name (optionally after a greeting such as
 * "hey" or "ok") is acted on; everything else is dropped. The transcript itself never leaves the
 * listener: an invocation carries no text. Pure Java.
 */
public final class WakePhrase {
 private WakePhrase(){}

 public enum Action { IGNORE, INVOKE, PAUSE_LISTENING }

 static final Set<String> NAMES=Set.of("alpha");
 static final Set<String> GREETINGS=Set.of("hey","hi","ok","okay","hello","yo");
 static final List<List<String>> PAUSE_COMMANDS=List.of(
  List.of("stop","listening"),List.of("pause","listening"),List.of("stop","listening","now"),List.of("pause"),List.of("stop"));
 /** A transcript longer than this is not a plausible single addressed command and is ignored. */
 static final int MAX_WORDS=64;

 public static List<String> words(String transcript){
  if(transcript==null)return List.of();
  String folded=Normalizer.normalize(transcript,Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
  List<String> out=new ArrayList<>();
  for(String token:folded.split("[^\\p{L}\\p{N}']+")){
   String word=token.replaceAll("^'+|'+$","");
   if(!word.isEmpty())out.add(word);
   if(out.size()>MAX_WORDS)break;
  }
  return out;
 }

 public static Action classify(String transcript){
  List<String> words=words(transcript);
  if(words.isEmpty()||words.size()>MAX_WORDS)return Action.IGNORE;
  int index=0;
  if(GREETINGS.contains(words.get(0)))index=1;
  if(index>=words.size()||!NAMES.contains(words.get(index)))return Action.IGNORE;
  List<String> rest=words.subList(index+1,words.size());
  for(List<String> command:PAUSE_COMMANDS)if(rest.equals(command))return Action.PAUSE_LISTENING;
  return Action.INVOKE;
 }

 /** For diagnostics: the configured assistant names, sorted. */
 public static List<String> names(){String[] sorted=NAMES.toArray(new String[0]);Arrays.sort(sorted);return List.of(sorted);}
}
