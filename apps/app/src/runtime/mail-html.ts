import createDOMPurify from 'dompurify';

const purifier=createDOMPurify();
const imageUrl=(value:string)=>{
  if(/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(value))return value;
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
};
purifier.addHook('uponSanitizeAttribute',(node,data)=>{
  if(node.nodeName==='IMG'&&data.attrName==='src'){
    const url=imageUrl(data.attrValue);if(url)node.setAttribute('data-alpha-image',url);
  }
  if(node.nodeName==='A'&&data.attrName==='href'){
    try{const url=new URL(data.attrValue);if(url.protocol==='https:'&&!url.username&&!url.password)node.setAttribute('data-alpha-link',url.href);}catch{}
  }
});
/** Email markup is isolated from app CSS and scripts. Remote images require an
 * explicit user tap. No requests, scripts, forms or navigation during preparation. */
export function prepareMailHtml(html:string,showRemoteImages=false):{document:string;remoteImages:number}{
  if(new TextEncoder().encode(html).length>512*1024)throw Error('Formatted email is too large');
  const content=purifier.sanitize(html,{USE_PROFILES:{html:true},RETURN_DOM_FRAGMENT:true,ALLOW_DATA_ATTR:false,ADD_ATTR:['data-alpha-image','data-alpha-link'],ADD_TAGS:['style'],FORBID_TAGS:['form','input','button','textarea','select','iframe','object','embed','video','audio','source','link','meta','base'],FORBID_ATTR:['src','srcset','href','action','formaction','background','ping','target','autofocus']});
  let remoteImages=0;
  for(const node of content.querySelectorAll<HTMLImageElement>('img')){
    const src=imageUrl(node.getAttribute('data-alpha-image')||'');node.removeAttribute('data-alpha-image');
    if(src?.startsWith('https:')){remoteImages++;if(showRemoteImages)node.src=src;else{const label=document.createElement('span');label.textContent=node.alt?`[Image: ${node.alt}]`:'[Image]';label.style.color='#666';node.replaceWith(label);}}
    else if(src)node.src=src;else node.remove();
  }
  for(const node of content.querySelectorAll('a[data-alpha-link]')){node.setAttribute('role','link');node.setAttribute('tabindex','0');}
  const container=document.createElement('div');container.append(content);
  const csp=`default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:${showRemoteImages?' https:':''}; font-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`;
  return {document:`<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;color:#171717;background:#fff;font:15px/1.5 Arial,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%!important}body>table{width:100%!important}td{overflow-wrap:anywhere}a[role=link]{color:#245dc1;cursor:pointer;text-decoration:underline}:focus-visible{outline:2px solid #245dc1}</style></head><body>${container.innerHTML}</body></html>`,remoteImages};
}
