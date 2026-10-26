import {createInterface} from 'node:readline';
import {indexDocument,buildScene} from '../static/model.mjs';
import {diffDocuments} from '../static/diff.mjs';
let documents=0,scopes=0,nodes=0,links=0,findings=0,maxNodes=0;
for await (const line of createInterface({input:process.stdin,crlfDelay:Infinity})) {
  const document=JSON.parse(line),model=indexDocument(document);
  if(diffDocuments(model,model).records.length)throw Error(`${document.path}: self comparison produced changes`);
  documents++;findings+=document.warnings.length;
  for (const scope of [model.documentId,...model.definitions.map(def=>def.id)]) {
    const scene=buildScene(model,scope);
    for(const key of ['x','y','w','h'])if(!Number.isFinite(scene.bounds[key]))throw Error(`${document.path}: invalid bounds`);
    for(const link of scene.links)if(link.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw Error(`${document.path}: invalid route`);
    scopes++;nodes+=scene.nodes.length;links+=scene.links.length;maxNodes=Math.max(maxNodes,scene.nodes.length);
  }
}
console.log(JSON.stringify({documents,scopes,nodes,placedLinks:links,structuralFindings:findings,maxNodesPerScope:maxNodes,gammaCompiled:false},null,2));
