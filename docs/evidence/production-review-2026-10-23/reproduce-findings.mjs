// Controlled source counterexamples. Run from the reviewed main checkout:
// node --import=tsx /absolute/path/to/reproduce-findings.mjs /absolute/path/to/main
// No device, network, credentials or provider writes are used.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(process.argv[2]||process.cwd());
const load=file=>import(pathToFileURL(path.join(root,file)).href);
const {BackgroundNavigation}=await load('apps/app/src/maps/background-navigation.ts');
const {channelDistributionProblems}=await load('scripts/sign-aosp-release.mjs');
const {createCloudMaps}=await load('apps/app/src/maps/cloud-provider.ts');
const nav=new BackgroundNavigation({navigationAvailability:async()=>({background:true}),addListener:async()=>({remove:async()=>{}}),startNavigation:async()=>{},updateNavigation:async()=>({active:false}),stopNavigation:async()=>({stopped:true})},()=>true);
await nav.start('Fixture route','Start',()=>{});
nav.update('Fixture route','Turn left');await new Promise(resolve=>setTimeout(resolve,0));
const backgroundStillActiveAfterNativeInactive=nav.active();await nav.stop();
let provider;const requests=[];
const maps=createCloudMaps(()=>async(route)=>{requests.push(route);return route==='capabilities'?{providerId:'other-provider',connectionId:'conn_1234567890123456',revision:'v1',attribution:'Fixture provider',regions:[{id:'test',name:'Test',bounds:[-180,-90,180,90]}],capabilities:{search:true,placeDetails:true,traffic:'none',transit:'none',modes:['walk']}}:{place:null}},(_config,value)=>{provider=value});
await maps.initializeCloudMaps();
const providerInstalled=!!provider;
const detailResult=await provider.detail('opaque-place-123',new AbortController().signal);
maps.retireCloudMaps();
console.log(JSON.stringify({backgroundStillActiveAfterNativeInactive,missingRecoveryProblems:channelDistributionProblems({recovery:{knownGoodRelease:{}},drills:{signedUpdate:'passed'}}),opaquePlaceDetail:{providerInstalled,result:detailResult,requests}},null,2));
