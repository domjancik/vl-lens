import test from 'node:test';
import assert from 'node:assert/strict';
import {indexDocument} from '../static/model.mjs';
import {diffDocuments} from '../static/diff.mjs';
const e=(tag,attrs={},children=[],text='')=>({tag,attrs,children,text,line:1});
const doc=()=>({path:'Main/vl/A.vl',documentId:'d',tree:e('Document',{Id:'d'},[
  e('Node',{Id:'class',Name:'Example'},[
    e('p:NodeReference',{},[e('Choice',{Kind:'ClassDefinition',Name:'Class'})]),
    e('Patch',{Id:'body'},[
      e('Node',{Id:'n',Bounds:'10,20,40,19'},[e('p:NodeReference',{},[e('Choice',{Kind:'OperationCallFlag',Name:'-'})]),e('Pin',{Id:'pin',DefaultValue:'1'})]),
      e('Link',{Id:'link',Ids:'a,b',IsFeedback:'true'}),e('Pad',{Id:'gone',Value:'old'})
    ])
  ])
])});
const find=(d,id)=>{let result;const visit=e=>{if(e.attrs.Id===id)result=e;e.children.forEach(visit);};visit(d.tree);return result;};
test('compares defaults, reference choices, feedback and addition/removal by local ID',()=>{
  const a=doc(),b=doc();find(b,'pin').attrs.DefaultValue='0.5';
  find(b,'n').children[0].children[0].attrs.Name='+';find(b,'link').attrs.Ids='b,a';
  const body=find(b,'body');body.children=body.children.filter(n=>n.attrs.Id!=='gone');body.children.push(e('Pad',{Id:'new',Value:'new'}));
  const diff=diffDocuments(indexDocument(a),indexDocument(b));
  assert.equal(diff.afterStatus.get('pin'),'changed');assert.equal(diff.afterStatus.get('n'),'changed');
  assert.equal(diff.beforeStatus.get('gone'),'removed');assert.equal(diff.afterStatus.get('new'),'added');
  assert.ok(diff.records.find(r=>r.id==='pin').fields.some(f=>f.before==='1'&&f.after==='0.5'));
  assert.ok(diff.records.find(r=>r.id==='link').fields.some(f=>f.after==='b,a'));
});
test('separates bounds-only edits and bubbles pin changes to enclosing nodes',()=>{
  const a=doc(),b=doc();find(b,'n').attrs.Bounds='50,60,40,19';
  let diff=diffDocuments(indexDocument(a),indexDocument(b));
  assert.ok(diff.records.length);
  assert.equal(diff.records.find(r=>r.id==='n').layoutOnly,true);
  find(b,'pin').attrs.DefaultValue='2';diff=diffDocuments(indexDocument(a),indexDocument(b));
  assert.equal(diff.afterStatus.get('class'),'changed');assert.equal(diff.afterStatus.get('n'),'changed');
  assert.equal(diff.records.find(r=>r.id==='pin').layoutOnly,false);
});
test('ignores formatting and attribute order while retaining id-less text values',()=>{
  const a=doc(),b=doc();find(a,'pin').children.push(e('p:Value',{},[],'alpha'));
  find(b,'pin').children.push(e('p:Value',{},[],'beta'));
  let diff=diffDocuments(indexDocument(a),indexDocument(b));
  assert.ok(diff.records.length);
  assert.ok(diff.records.find(r=>r.id==='pin').fields.some(f=>f.before==='alpha'&&f.after==='beta'));
  assert.equal(diffDocuments(indexDocument(doc()),indexDocument(doc())).records.length,0);
  const formatted=doc();find(formatted,'class').text='\n  ';
  assert.equal(diffDocuments(indexDocument(doc()),indexDocument(formatted)).records.length,0);
});
test('does not match copied element IDs when document identity changes',()=>{
  const b=doc();b.documentId='different';b.tree.attrs.Id='different';
  const diff=diffDocuments(indexDocument(doc()),indexDocument(b));
  assert.equal(diff.identityChanged,true);assert.equal(diff.afterStatus.get('n'),'added');assert.equal(diff.beforeStatus.get('n'),'removed');
});
test('supports whole added and deleted documents',()=>{
  assert.equal(diffDocuments(null,indexDocument(doc())).afterStatus.get('n'),'added');
  assert.equal(diffDocuments(indexDocument(doc()),null).beforeStatus.get('n'),'removed');
});
test('ignoring Bounds does not hide changed defaults or operation participation',()=>{
  const a=doc(),b=doc();find(b,'n').attrs.Bounds='90,90,40,19';
  assert.equal(diffDocuments(indexDocument(a),indexDocument(b),{ignoreLayout:true}).records.length,0);
  find(b,'pin').attrs.DefaultValue='3';find(b,'body').attrs.ParticipatingElements='n,link';
  const diff=diffDocuments(indexDocument(a),indexDocument(b),{ignoreLayout:true});
  assert.ok(diff.records.some(r=>r.id==='pin'));
  assert.ok(diff.records.some(r=>r.id==='body'&&r.fields.some(f=>f.name==='@ParticipatingElements')));
});
test('duplicate local IDs fail structural matching explicitly',()=>{
  const b=doc();b.warnings=[{kind:'duplicate-id'}];
  assert.throws(()=>diffDocuments(indexDocument(doc()),indexDocument(b)),/duplicate IDs/);
});
