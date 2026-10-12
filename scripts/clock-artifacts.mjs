import fs from 'node:fs';
import path from 'node:path';
/** Only the explicit test's external-files UUID directory; never pull arbitrary result paths. */
export function collectClockArtifacts(raw,output,adb){
 const matches=[...raw.matchAll(/^INSTRUMENTATION_RESULT: realClockFixture=(.*)$/gm)];
 if(matches.length!==1)throw Error('Clock fixture artifact path missing or ambiguous');
 const remote=matches[0][1].trim();
 if(!/^\/storage\/emulated\/0\/Android\/data\/ai\.elizaresearch\.alphaphone\/files\/real-clock-[a-f0-9-]{36}$/.test(remote))throw Error('Unadmitted Clock fixture artifact path');
 const directory=path.join(output,'real-clock-artifacts');fs.mkdirSync(directory);
 adb(['pull',remote,directory]);
 const fixture=path.join(directory,path.basename(remote));
 if(!fs.existsSync(path.join(fixture,'events.jsonl')))throw Error('Clock fixture events were not copied');
 return {directory:fixture,copied:true};
}
