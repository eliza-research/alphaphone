/** Test-boundary protocol shared by the two native renderer fixtures, never product code. */
export function installNativeNavigationFixture() {
  (window as any).createNativeNavigationFixture=(id: string,agentId: string,f: {unexpected: string[]})=>{
    const ok=(data: unknown)=>({status:200,data});
    let installationId='',deviceKey='';
    const navigationPrepared = new Map<string, {binding: any; claimId?: string}>();
    const navigationViews = new Set(['chat','inbox','calendar','browser','camera','photos','maps','notes','files','automations','settings']);
    const navigationRequest = (method: string, path: string, body: any, owner: unknown) => {
      const reject = () => { f.unexpected.push(method + ' ' + path); return {status:409,data:{error:'Invalid fixture navigation contract'}}; };
      if (owner !== id || method !== 'POST' || !body || typeof body !== 'object' || Array.isArray(body)) return reject();
      const exact = (keys: string[]) => Object.keys(body).length === keys.length && Object.keys(body).every(key => keys.includes(key));
      const safe = (value: unknown, pattern: RegExp) => typeof value === 'string' && pattern.exec(value)?.[0] === value;
      const prepare = /^\/api\/views\/([A-Za-z0-9_-]+)\/navigate$/.exec(path);
      if (prepare?.[0] === path) {
        const viewId=prepare[1];
        if (!navigationViews.has(viewId) || !exact(['clientId','delivery','prepareOnly','viewType','completedActionHandoffId']) || body.delivery !== 'completed-action' || body.prepareOnly !== true || body.viewType !== 'gui' || !safe(body.clientId,/^[A-Za-z0-9._-]{1,128}$/) || !safe(body.completedActionHandoffId,/^[A-Za-z0-9._:-]{1,128}$/) || navigationPrepared.has(body.completedActionHandoffId)) return reject();
        const binding={requestId:body.completedActionHandoffId,clientId:body.clientId,viewId,viewType:'gui',installationId:'fixture-view-'+viewId};
        navigationPrepared.set(binding.requestId,{binding});
        return ok({ok:true,status:'prepared',viewId,navigationBinding:binding,completedActionHandoffId:binding.requestId});
      }
      const saved=navigationPrepared.get(body.requestId);
      if (!saved || Object.entries(saved.binding).some(([key,value])=>body[key]!==value)) return reject();
      if (path === '/api/views/interact-claim') {
        if (!exact(['requestId','clientId','viewId','viewType','installationId']) || saved.claimId) return reject();
        saved.claimId=crypto.randomUUID();return ok({claimId:saved.claimId});
      }
      if (path === '/api/views/interact-result') {
        if (!exact(['requestId','clientId','viewId','viewType','installationId','claimId','success','result']) || !saved.claimId || body.claimId!==saved.claimId || typeof body.success!=='boolean' || !body.result || Object.keys(body.result).length!==1 || body.result.switched!==body.success) return reject();
        navigationPrepared.delete(body.requestId);return ok({ok:true,accepted:true});
      }
      return reject();
    };
    return {
      register(headers: Record<string,string>){installationId=headers['X-Eliza-Device-Id'];deviceKey=headers['X-Eliza-Device-Key'];},
      request(method: string,path: string,body: any,headers: Record<string,string>,owner: unknown){
        if(path.startsWith('/api/views/')&&(path.endsWith('/navigate')||path==='/api/views/interact-claim'||path==='/api/views/interact-result'))return navigationRequest(method,path,body,owner);
        if(path==='/api/client-devices/context'){
          if(method==='GET'&&owner===id&&installationId&&headers['X-Eliza-Device-Id']===installationId&&headers['X-Eliza-Device-Key']===deviceKey)return ok({subjectUserId:id,agentId,installationId,enrollmentId:'fixture-enrollment'});
          f.unexpected.push(method+' '+path);return {status:404,data:{}};
        }
      },
    };
  };
}
