import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const code=buildSync({entryPoints:['apps/app/src/runtime/cloud-membership-ui.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime'],loader:{'.css':'empty'}}).outputFiles[0].text;
const module={exports:{}};
new Function('require','module','exports',code)(createRequire(import.meta.url),module,module.exports);
const controls=extra=>React.createElement(module.exports.CloudMembershipControls,{balance:'unavailable',busy:false,onRedeem:async()=>false,onAddFunds(){},onRefresh(){},...extra});

test('membership code error is shown once and describes its invalid input',()=>{
 const html=renderToStaticMarkup(controls({error:'Check this code.'}));
 const id=html.match(/aria-describedby="([^"]+)"/)[1];
 assert.ok(html.includes(`id="${id}" role="alert">Check this code.</p>`));
 assert.equal(html.split('Check this code.').length-1,1);
 assert.match(html,/aria-invalid="true"/);
 const clear=renderToStaticMarkup(controls({}));
 assert.doesNotMatch(clear,/aria-invalid|aria-describedby|role="alert"/);
});

test('separate membership forms associate errors with distinct IDs',()=>{
 const html=renderToStaticMarkup(React.createElement(React.Fragment,null,controls({error:'First error.'}),controls({error:'Second error.'})));
 const ids=[...html.matchAll(/aria-describedby="([^"]+)"/g)].map(match=>match[1]);
 assert.equal(ids.length,2);assert.notEqual(ids[0],ids[1]);
 for(const id of ids)assert.ok(html.includes(`id="${id}" role="alert"`));
});
