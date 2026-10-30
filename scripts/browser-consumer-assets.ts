import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { prepareBrowserConsumer, type BrowserConsumerManifest } from './prepare-browser-consumer.mjs';

/** Runtime public URLs use the same upstream assets; product files retain precedence. */
export function browserConsumerAssets(root: string): Plugin {
  let assets: Map<string, Buffer> | undefined;
  const initialize = () => {
    if (assets) return assets;
    const collected = new Map<string, Buffer>();
    // Optional until the native shared entry is adopted. A missing module still fails bundling.
    if (!existsSync(path.join(root, '.eliza/browser-consumer'))) return collected;
    const directory = prepareBrowserConsumer(root);
    const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8')) as BrowserConsumerManifest;
    if (!Array.isArray(manifest.staticAssets)) throw Error('Missing shared App public asset inventory');
    for (const name of manifest.staticAssets) {
      if (!Object.hasOwn(manifest.files, 'public/' + name)) throw Error('Unrecorded shared App asset');
      if (existsSync(path.join(root, 'apps/app/public', name))) continue;
      collected.set(name, readFileSync(path.join(directory, 'public', name)));
    }
    assets = collected;
    return collected;
  };
  const mimeTypes: Record<string, string> = {
    '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
    '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml',
  };
  const contentType = (name: string): string => mimeTypes[path.extname(name)] ?? 'application/octet-stream';
  return {
    name: 'alpha-shared-app-assets',
    configureServer(server) {
      const files = initialize();
      server.middlewares.use((req, res, next) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\//, ''), data = files.get(name);
        if (!data) return next();
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end(); return; }
        res.writeHead(200, {'Content-Type': contentType(name), 'Content-Length': data.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache'});
        res.end(req.method === 'HEAD' ? undefined : data);
      });
    },
    generateBundle() {
      for (const [fileName, source] of initialize()) this.emitFile({type: 'asset', fileName, source});
    },
  };
}
