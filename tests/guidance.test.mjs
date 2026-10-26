import test from 'node:test';
import assert from 'node:assert/strict';
let TourProgress,placeGuide;
try{({TourProgress,placeGuide}=await import('../static/guidance-model.mjs'));}catch{}
test('viewer and range guidance have independent persistent dismissal state',()=>{
  assert.equal(typeof TourProgress,'function','First-use state is missing');
  const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
  const first=new TourProgress(storage);
  assert.equal(first.seen('viewer'),false);
  first.finish('viewer');
  assert.equal(new TourProgress(storage).seen('viewer'),true);
  assert.equal(first.seen('range'),false);
});
test('blocked browser storage does not break guidance or repeat it in the current page',()=>{
  assert.equal(typeof TourProgress,'function');
  const state=new TourProgress({getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}});
  assert.equal(state.seen('range'),false);state.finish('range');assert.equal(state.seen('range'),true);
});
test('coachmarks stay inside a viewport or modal even when their target is near an edge',()=>{
  assert.equal(typeof placeGuide,'function');
  for(const bounds of [{left:0,top:0,right:390,bottom:700},{left:200,top:100,right:1100,bottom:800}]){
    const box=placeGuide({left:bounds.right-70,right:bounds.right-10,top:bounds.bottom-50,bottom:bounds.bottom-10},bounds,{width:350,height:230});
    assert.ok(box.left>=bounds.left+12);
    assert.ok(box.top>=bounds.top+12);
    assert.ok(box.left+box.width<=bounds.right-12);
    assert.ok(box.top+box.height<=bounds.bottom-12);
  }
});
