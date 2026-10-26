import test from 'node:test';
import assert from 'node:assert/strict';
let chooseComparisonFile;
try{({chooseComparisonFile}=await import('../static/diff.mjs'));}catch{}
test('changing a range preserves the current patch even if other patches changed',()=>{
  assert.equal(typeof chooseComparisonFile,'function');
  const changes=[{path:'Large.vl',oldPath:'Large.vl',newPath:'Large.vl',status:'modified'}];
  assert.equal(chooseComparisonFile(changes,[{path:'Current.vl'},{path:'Large.vl'}],'Current.vl').path,'Current.vl');
  const renamed={path:'New.vl',oldPath:'Current.vl',newPath:'New.vl',status:'renamed'};
  assert.equal(chooseComparisonFile([renamed],[{path:'New.vl'}],'Current.vl').entry,renamed);
});
