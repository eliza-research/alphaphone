import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const source='android/app/src/androidTest/java/ai/elizaresearch/alphaphone/';
test('native accessibility bounds exclude fully clipped descendants but retain partial and real overlapping controls',()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-accessibility-bounds-'));
 const binary=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
 try{
  execFileSync(binary('javac'),['--release','11','-d',dir,join(root,source,'AccessibilityBounds.java'),join(root,'test/fixtures/AccessibilityBoundsTest.java')],{timeout:60000,stdio:'pipe'});
  assert.equal(execFileSync(binary('java'),['-cp',dir,'ai.elizaresearch.alphaphone.AccessibilityBoundsTest'],{timeout:30000,encoding:'utf8'}).trim(),'PASS native accessibility bounds');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('the installed fixture clips screen and scrollable ancestors before its unchanged reading-order assertion',()=>{
 const text=readFileSync(join(root,source,'AccessibilityInstrumentedTest.java'),'utf8');
 assert.match(text,/device\.getDisplayWidth\(\),device\.getDisplayHeight\(\)/);
 assert.match(text,/parent=parent\.getParent\(\)\)if\(parent\.isScrollable\(\)\)/);
 assert.match(text,/AccessibilityBounds\.clip/);
 assert.match(text,/Rect r=visibleBounds\(node,device\);\s*if\(r\.isEmpty\(\)\)continue;/);
 assert.match(text,/r\.top<p\.top-Math\.max\(p\.height\(\),r\.height\(\)\)\/2&&r\.left<p\.right/);
 assert.match(text,/problems,problems\.isEmpty\(\)/);
});
