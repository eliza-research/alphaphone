import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// The Notes view is a lazy MobileViewHost loader (product/alpha-product.ts). Its chunk may import
// only React, shell types and the small host context: when it imported the prototype renderer, the
// bundler split the renderer's shared modules into chunks that kept development-only connection
// code (Cloud personal setup) in product bundles and failed audit-production-bundle.
test('the lazy Notes view imports nothing from the renderer', () => {
  const source = readFileSync('apps/app/src/prototype/canonical-notes-view.tsx', 'utf8');
  const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)'/gm)].filter(match => !match[1]).map(match => match[2]);
  assert.deepEqual(imports.sort(), ['./notes-host-context', 'react']);
  const context = readFileSync('apps/app/src/prototype/notes-host-context.ts', 'utf8');
  assert.deepEqual([...context.matchAll(/from\s+'([^']+)'/g)].map(match => match[1]), ['react']);
});
