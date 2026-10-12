import test from 'node:test';
import assert from 'node:assert/strict';
import {inventorySource} from '../scripts/inventory-interactions.mjs';

test('inventory includes lowercase DOM actions and controls without direct handlers',()=>{
 const source=`const done=document.createElement('button');
done.onclick=close;
dialog.oncancel=event=>event.preventDefault();
const markup='<button data-action="remove">Remove</button>';
root.addEventListener('click',dispatch);`;
 const rows=inventorySource('dialog.ts',source);
 assert.ok(rows.some(r=>r.kind==='dynamic-control-candidate'&&r.element==='button'));
 assert.ok(rows.some(r=>r.kind==='dom-property-candidate'&&r.event==='onclick'&&r.line===2));
 assert.ok(rows.some(r=>r.event==='oncancel'));
 assert.ok(rows.some(r=>r.kind==='control-candidate'&&r.markup.includes('data-action="remove"')));
 assert.ok(rows.some(r=>r.kind==='listener-candidate'&&r.event==='click'));
 assert.ok(rows.every(r=>r.status==='unreviewed'&&Number.isInteger(r.offset)));
});

test('template event casing and quoting do not hide actions',()=>{
 const rows=inventorySource('view.html',`<button onclick='open()'>Open</button>\n<input onChange="{{update}}">`);
 assert.deepEqual(rows.filter(r=>r.kind==='template').map(r=>[r.event,r.handler,r.line]),[['onclick','open()',1],['onChange','{{update}}',2]]);
 assert.equal(rows.filter(r=>r.kind==='control-candidate').length,2);
});
