import test from 'node:test';
import assert from 'node:assert/strict';
import { indexDocument, buildScene, resolveReference } from '../static/model.mjs';

const e = (tag, attrs = {}, children = []) => ({ tag, attrs, children, line: 1 });
const ref = (...choices) => e('p:NodeReference', { LastDependency: 'Other.vl', LastCategoryFullName: 'Example' }, choices.map(([Kind, Name]) => e('Choice', { Kind, Name })));
const doc = () => ({path:'example.vl',documentId:'d',warnings:[],tree:e('Document',{Id:'d'},[
  e('Patch',{Id:'root'},[e('Canvas',{Id:'canvas'},[
    e('Node',{Id:'class',Name:'Example',Bounds:'20,20'},[
      ref(['ClassDefinition','Class']),
      e('Patch',{Id:'body'},[
        e('Canvas',{},[
          e('Node',{Id:'n',Bounds:'-50,40,80,24'},[ref(['OperationCallFlag','Get']),e('Pin',{Id:'out',Name:'Output',Kind:'StateOutputPin'})]),
          e('ControlPoint',{Id:'cp',Bounds:'-10,100'}),
          e('Node',{Id:'region',Bounds:'-30,120,150,100'},[ref(['ApplicationStatefulRegion','ForEach']),e('Patch',{Id:'regionBody'},[
            e('Node',{Id:'inner',Bounds:'0,160,60,20'},[ref(['OperationCallFlag','-']),e('Pin',{Id:'in',Kind:'InputPin',DefaultValue:'1'})])
          ])]),
          e('Pad',{Id:'pad',Bounds:'120,40,60,20',Value:'Time'})
        ]),
        e('Patch',{Id:'update',Name:'Update',ParticipatingElements:'n'},[e('Pin',{Id:'result',Name:'Result',Kind:'OutputPin'})]),
        e('ProcessDefinition',{Id:'process'},[e('Fragment',{Id:'fragment',Patch:'update',Enabled:'true'})]),
        e('Link',{Id:'link',Ids:'out,cp,in',IsHidden:'true',IsFeedback:'true'}),
        e('Link',{Id:'oplink',Ids:'in,result'})
      ])
    ])
  ])])
])});

test('scene expands regions, keeps negative coordinates and routes through all link endpoints', () => {
  const model=indexDocument(doc());const scene=buildScene(model,'class','');
  assert.deepEqual(scene.nodes.map(n=>n.id).sort(),['inner','n','pad','region']);
  assert.equal(scene.anchors.get('cp').x,-10);
  const link=scene.links.find(l=>l.id==='link');
  assert.equal(link.points.length,3);assert.equal(link.hidden,true);assert.equal(link.feedback,true);
  assert.equal(scene.nodes.find(n=>n.id==='n').x,-50);
  assert.ok(scene.anchors.has('result'));
});
test('operation lens marks explicit participation without inventing a schedule', () => {
  const model=indexDocument(doc());const scene=buildScene(model,'class','update');
  assert.deepEqual([...scene.explicitParticipants],['n']);
  assert.equal(scene.operations[0].id,'update');
  assert.equal(scene.nodes.find(n=>n.id==='inner').element.children.find(p=>p.tag==='Pin').attrs.DefaultValue,'1');
});
test('definition identities remain scoped to file even when documents reuse IDs', () => {
  const a=indexDocument(doc());const b=indexDocument({...doc(),path:'copy.vl'});
  assert.notEqual(a.key,b.key);assert.equal(a.definitions[0].id,'class');
});
test('reference navigation reports ambiguity instead of guessing between matching filenames', () => {
  const reference=e('p:NodeReference',{LastDependency:'Other.vl'},[]);
  assert.equal(resolveReference(reference,[{path:'a/Other.vl'},{path:'b/Other.vl'}]).length,2);
  assert.equal(resolveReference(reference,[{path:'a/Other.vl'},{path:'b/Different.vl'}])[0].path,'a/Other.vl');
});
test('fit bounds frame the actual graph even when every saved coordinate is positive', () => {
  const input=doc();
  function move(element) {
    if (element.attrs.Bounds) {
      const bounds=element.attrs.Bounds.split(',').map(Number);bounds[0]+=1000;bounds[1]+=1000;
      element.attrs.Bounds=bounds.join(',');
    }
    element.children.forEach(move);
  }
  move(input.tree);
  const scene=buildScene(indexDocument(input),'class');
  assert.ok(scene.bounds.x>800);assert.ok(scene.bounds.y>800);
});
test('fit includes source overlays and unconnected routing points', () => {
  const input=doc();
  const body=input.tree.children[0].children[0].children[0].children.find(e=>e.attrs.Id==='body');
  body.children.push(e('Overlay',{Id:'overlay',Bounds:'300,300,400,80'}),e('ControlPoint',{Id:'loose',Bounds:'-200,-200'}));
  const scene=buildScene(indexDocument(input),'class');
  assert.ok(scene.bounds.x<=-200);assert.ok(scene.bounds.x+scene.bounds.w>=700);
});
test('saved box dimensions are preserved even for long operation names', () => {
  const input=doc();
  function rename(element){if(element.attrs.Id==='n')element.attrs.Name='GetFixtures (Fixtures Indices)';element.children.forEach(rename);}
  rename(input.tree);
  const node=buildScene(indexDocument(input),'class').nodes.find(n=>n.id==='n');
  assert.equal(node.w,80);assert.equal(node.h,24);
});
