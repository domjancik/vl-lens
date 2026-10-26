import test from 'node:test';
import assert from 'node:assert/strict';
import {repositorySlug, apiURL, viewerURL} from '../static/remote.mjs';

test('repository links reject other hosts and credentials',()=>{
  assert.equal(repositorySlug('https://github.com/vvvv/VL.StandardLib.git'),'vvvv/VL.StandardLib');
  for(const value of ['https://evil.test/a/b','https://token@github.com/a/b','a/b/c','a/..'])
    assert.throws(()=>repositorySlug(value));
});
test('snapshot requests pin files while keeping Git revision inputs independent',()=>{
  const connection={repo:'person/library',ref:'feature/hello',snapshot:'a'.repeat(40)};
  const file=new URL(apiURL('/api/document?path=A.vl',connection),'http://localhost');
  assert.equal(file.searchParams.get('repo'),'person/library');
  assert.equal(file.searchParams.get('ref'),connection.snapshot);
  assert.equal(new URL(apiURL('/api/documents',connection),'http://localhost').searchParams.get('ref'),'feature/hello');
  assert.equal(apiURL('/api/parse',connection),'/api/parse');
  const history=new URL(apiURL('/api/git/history?ref=feature%2Fother&page=2',connection),'http://localhost');
  assert.equal(history.searchParams.get('ref'),'feature/other');
  assert.equal(history.searchParams.get('page'),'2');
  assert.equal(viewerURL('person/library','feature/hello'),'/viewer?repo=person%2Flibrary&ref=feature%2Fhello');
});
