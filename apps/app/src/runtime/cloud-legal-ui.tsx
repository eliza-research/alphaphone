import { useState } from 'react';
import content from './cloud-legal-content.json';
/** Backend service legal copy retained verbatim, with product-owned navigation. */
export function CloudLegalViews() {
  const [page,setPage]=useState<'terms'|'privacy'|null>(null);
  return <section className="alpha-cloud-legal">
    <nav aria-label="Account legal information"><button onClick={()=>setPage('terms')}>Terms of Service</button><button onClick={()=>setPage('privacy')}>Privacy Policy</button></nav>
    {page&&<article aria-label={page==='terms'?'Terms of Service':'Privacy Policy'}>
      <button onClick={()=>setPage(null)}>Return to sign-in</button>
      <h2>{page==='terms'?'Terms of Service':'Privacy Policy'}</h2>
      <p>These are the backend service’s terms. Service names and legal text are retained from the bundled source.</p>
      {content[page].map(section=><section key={section.title}><h3>{section.title}</h3>{section.paragraphs.map(p=><p key={p}>{p}</p>)}{section.items.length>0&&<ul>{section.items.map(item=><li key={item}>{item}</li>)}</ul>}</section>)}
      <button onClick={()=>setPage(null)}>Return to sign-in</button>
    </article>}
  </section>;
}
