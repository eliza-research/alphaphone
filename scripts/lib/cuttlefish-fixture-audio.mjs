import {chromium} from 'playwright';

/** A silent, preconnected WebRTC microphone with explicitly triggered fixture PCM.
 * No host microphone or speaker is opened. The caller owns guest admission/lease. */
export async function openFixtureAudio({address,device,wav}) {
 if(!/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(address)||!/^cvd-\d+$/.test(device))throw Error('Owned Docker endpoint required');
 const browser=await chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 try {
  const page=await browser.newPage({ignoreHTTPSErrors:true});
  await page.addInitScript(({base64})=>{
   const peers=[];const Peer=window.RTCPeerConnection;
   window.RTCPeerConnection=class extends Peer {constructor(...args){super(...args);peers.push(this);}};
   const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),view=new DataView(bytes.buffer);
   const ascii=(at,n)=>String.fromCharCode(...bytes.slice(at,at+n));
   if(ascii(0,4)!=='RIFF'||ascii(8,4)!=='WAVE')throw Error('Invalid fixture WAV');
   let rate,pcm;
   for(let i=12;i+8<=bytes.length;){const name=ascii(i,4),n=view.getUint32(i+4,true),start=i+8;if(start+n>bytes.length)throw Error('Truncated fixture');
    if(name==='fmt '){if(view.getUint16(start,true)!==1||view.getUint16(start+2,true)!==1||view.getUint16(start+14,true)!==16)throw Error('Expected mono PCM16');rate=view.getUint32(start+4,true);}
    if(name==='data')pcm=new DataView(bytes.buffer,start,n);i=start+n+(n%2);
   }
   if(!rate||!pcm||pcm.byteLength%2)throw Error('Incomplete fixture');
   let context,destination,buffer,source,ended=true;
   navigator.mediaDevices.getUserMedia=async options=>{
    if(!options?.audio||options.video)throw Error('Fixture permits only synthetic audio');
    if(!context){context=new AudioContext({sampleRate:48000});destination=context.createMediaStreamDestination();buffer=context.createBuffer(1,pcm.byteLength/2,rate);const data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=pcm.getInt16(i*2,true)/32768;}
    await context.resume();return destination.stream;
   };
   window.__alphaFixtureAudio={
    async ready(){if(!context||context.state!=='running')return false;for(const peer of peers){if(peer.connectionState!=='connected')continue;for(const stat of (await peer.getStats()).values())if(stat.type==='outbound-rtp'&&stat.kind==='audio'&&stat.bytesSent>0)return true;}return false;},
    start(){if(!context||context.state!=='running'||!ended)throw Error('Fixture audio is not ready');ended=false;source=context.createBufferSource();source.buffer=buffer;source.connect(destination);source.onended=()=>{ended=true;source.disconnect();source=null;};source.start();return {sampleRate:context.sampleRate,fixtureSampleRate:rate,frames:buffer.length,durationSeconds:buffer.duration};},
    ended:()=>ended,
   };
  },{base64:wav.toString('base64')});
  await page.goto(`https://${address}:1443/devices/${device}/files/client.html`);
  await page.locator('#mic_btn').waitFor({state:'visible',timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#mic_btn')?.disabled===false,{},{timeout:30000});
  await page.locator('#mic_btn').dispatchEvent('mousedown');
  await page.waitForFunction(()=>window.__alphaFixtureAudio?.ready(),{},{timeout:30000});
  return {start:()=>page.evaluate(()=>window.__alphaFixtureAudio.start()),waitEnded:()=>page.waitForFunction(()=>window.__alphaFixtureAudio.ended(),{},{timeout:20000}),close:()=>browser.close()};
 }catch(error){await browser.close();throw error;}
}
