export interface BrowserConsumerManifest {
  schema: 'eliza-browser-consumer-v1';
  revision: string;
  distributable: boolean;
  diagnostic: boolean;
  entry: string;
  types: string;
  stylesEntry: string;
  prebootEntry?: string;
  prebootTypes?: string;
  staticAssets: string[];
  styles: string[];
  files: Record<string, {bytes: number; sha256: string}>;
  [name: string]: unknown;
}
export function inspectBrowserConsumer(directory: string, source: {pin: string; verify(manifest: BrowserConsumerManifest): void}): {manifest: BrowserConsumerManifest; manifestSha256: string};
export function prepareBrowserConsumer(root?: string, input?: string): string;
