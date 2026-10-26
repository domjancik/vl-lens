import test from 'node:test';
import assert from 'node:assert/strict';
let layoutHistory, rangeSelection;
try { ({layoutHistory,rangeSelection}=await import('../static/history-model.mjs')); } catch {}
const c=(oid,parents=[])=>({oid,parents,subject:oid,date:'2026-01-01',author:'A'});

test('merge history draws separate parent lanes and converges on the shared ancestor',()=>{
  assert.equal(typeof layoutHistory,'function','History layout is missing');
  const graph=layoutHistory([c('merge',['left','right']),c('left',['root']),c('right',['root']),c('root')]);
  const byId=new Map(graph.nodes.map(n=>[n.oid,n]));
  assert.notEqual(byId.get('left').lane,byId.get('right').lane);
  assert.equal(graph.edges.filter(e=>e.from==='merge').length,2);
  for(const edge of graph.edges)assert.ok(byId.get(edge.from).row<byId.get(edge.to).row);
  assert.equal(graph.nodes.length,4);
});
test('out of order branch pages are topologically sorted and duplicate commits are merged',()=>{
  assert.equal(typeof layoutHistory,'function');
  const graph=layoutHistory([c('root'),c('tip',['root']),c('tip',['root'])]);
  assert.deepEqual(graph.nodes.map(n=>n.oid),['tip','root']);
});
test('unloaded ancestors become boundary stubs rather than invented commit rows',()=>{
  assert.equal(typeof layoutHistory,'function');
  const graph=layoutHistory([c('tip',['outside'])]);
  assert.equal(graph.nodes.length,1);
  assert.equal(graph.edges[0].missing,true);
  const boundary=layoutHistory([c('merge',['outside-a','outside-b'])]);
  assert.notEqual(boundary.edges[0].toLane,boundary.edges[1].toLane);
});
test('selected ranges exclude base ancestry and keep unrelated branch commits out',()=>{
  assert.equal(typeof rangeSelection,'function');
  const commits=[c('merge',['left','right']),c('left',['root']),c('right',['root']),c('root'),c('unrelated')];
  const range=rangeSelection(commits,'left','merge');
  assert.deepEqual([...range.included].sort(),['merge','right']);
  assert.equal(range.relationship,'forward');
  assert.equal(rangeSelection(commits,'merge','left').relationship,'reverse');
  assert.equal(rangeSelection(commits,'left','right').relationship,'diverged');
});
test('range descriptions distinguish truncated ancestry and local mutable snapshots',()=>{
  assert.equal(typeof rangeSelection,'function');
  assert.equal(rangeSelection([c('tip',['outside'])],'older','tip').relationship,'unknown');
  assert.equal(rangeSelection([c('tip')],'tip','WORKTREE').relationship,'local');
});
