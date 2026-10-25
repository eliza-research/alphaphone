// No analytics, network calls, token storage, or third-party scripts on this page.
function handleReturn() {
  const link = document.getElementById('return');
  link.hidden = true; link.removeAttribute('href');
  const url = new URL(location.href);
  const params = new URLSearchParams((url.hash || url.search).slice(1));
  const keys = [...params.keys()];
  const route = /^\/alphaphone\/(auth|gmail)\/(staging\/)?callback$/.exec(url.pathname);
  const kind = route?.[1], environment = route ? (route[2] ? 'staging' : 'production') : null;
  const valid = environment && !(url.hash && url.search) && new Set(keys).size === keys.length && /^[A-Za-z0-9_-]{43}$/.test(params.get('state') || '') &&
    (kind === 'gmail' ? (!url.search && (params.get('result') === 'connected' ? keys.length === 3 && /^[A-Za-z0-9_-]{1,128}$/.test(params.get('connectionId') || '') : keys.length === 2 && ['denied','failed'].includes(params.get('result')))) : (keys.length === 2 && ((params.has('code') && /^[A-Za-z0-9_-]{43}$/.test(params.get('code') || '')) || (params.has('error') && /^[a-z0-9_]{1,100}$/.test(params.get('error') || '')))));
  history.replaceState(null, '', url.pathname);
  if (valid) {
    const target = `alphaphone://${kind}/${environment}#${params}`;
    document.getElementById('status').textContent = 'Returning to Alpha Phone to finish connecting…';
    link.href = target; link.hidden = false;
    location.replace(target);
  } else document.getElementById('status').textContent = 'This sign-in link is invalid or incomplete. Return to Alpha Phone and try again.';
}
window.addEventListener('hashchange', handleReturn);
handleReturn();
