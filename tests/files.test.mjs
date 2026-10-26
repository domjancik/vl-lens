import test from 'node:test';
import assert from 'node:assert/strict';
import {rankFiles,buildFileTree,mergeRecents} from '../static/files.mjs';
const files=[{path:'Effects/Color.vl'},{path:'Effects/Color/Invert.vl'},{path:'Utilities/Invert.vl'},{path:'Long/AnotherColor.vl'},{path:'Root.vl'}];
test('search ranks exact filenames, supports path tokens and fuzzy abbreviations',()=>{
  assert.equal(rankFiles(files,'Color.vl')[0]?.path,'Effects/Color.vl');
  assert.equal(rankFiles(files,'effects inv')[0]?.path,'Effects/Color/Invert.vl');
  assert.equal(rankFiles(files,'rtvl')[0]?.path,'Root.vl');
  assert.equal(rankFiles(files,'not present').length,0);
  const longPaths=[{path:'Main/vl/Blocks/Effects/Color/Schema.Blocks.Effects.Color.Blur.vl'},{path:'Main/vl/Blocks/Effects/Color/Schema.Blocks.Effects.Color.Invert.vl'}];
  assert.equal(rankFiles(longPaths,'effects invert').length,1);
  assert.equal(rankFiles([{path:'VL.LinearSpread.vl'},{path:'VL.Schema.Plugins.Keyboard.vl'}],'linear').length,1);
});
test('folder tree retains duplicate basenames and folders sort before files',()=>{
  const tree=buildFileTree(files);
  assert.equal(tree.count,5);assert.equal(tree.children[0].kind,'folder');
  const effects=tree.children.find(n=>n.name==='Effects');
  assert.equal(effects.count,2);assert.equal(effects.children[0].name,'Color');
  assert.equal(effects.children[0].children[0].file.path,'Effects/Color/Invert.vl');
});
test('recents deduplicate per workspace without losing identical paths in another project',()=>{
  const initial=[{path:'A.vl',workspace:'other',openedAt:1},{path:'A.vl',workspace:'local',openedAt:2}];
  const result=mergeRecents(initial,{path:'A.vl',name:'A.vl'},'local',2);
  assert.equal(result.length,2);assert.equal(result[0].workspace,'local');assert.equal(result[1].workspace,'other');
  assert.ok(result[0].openedAt>=2);
});
