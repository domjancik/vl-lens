export const displayPath=file=>file.displayPath||file.path;
export const fileName=file=>displayPath(file).split('/').at(-1);
const compare=(a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});
function tokenScore(text,token,fuzzy=true) {
  if(text===token)return 200;
  if(text.startsWith(token))return 140-token.length*.01;
  const at=text.indexOf(token);if(at>=0)return 100-at*.1;
  if(!fuzzy)return -Infinity;
  let cursor=0,first=-1,last=-1;
  for(const letter of token){const index=text.indexOf(letter,cursor);if(index<0)return -Infinity;if(first<0)first=index;last=index;cursor=index+1;}
  return 30+(first===0?10:0)-(last-first-token.length)*.4-first*.2-text.length*.05;
}
export function rankFiles(files, query, limit=100) {
  const tokens=query.trim().toLowerCase().replaceAll('\\','/').split(/\s+/).filter(Boolean);
  const candidates=files.map(file=>{
    const path=displayPath(file).toLowerCase(),name=fileName(file).toLowerCase();
    const scores=tokens.map(token=>Math.max(tokenScore(name,token),tokenScore(path,token,false)-50));
    return {file,score:scores.reduce((sum,n)=>sum+n,0),literal:tokens.every(token=>path.includes(token))};
  }).filter(result=>Number.isFinite(result.score));
  const literalMatches=candidates.some(result=>result.literal);
  return candidates.filter(result=>!literalMatches||result.literal).sort((a,b)=>b.score-a.score||compare(displayPath(a.file),displayPath(b.file))).slice(0,limit).map(result=>result.file);
}
export function buildFileTree(files) {
  const root={kind:'folder',name:'',path:'',children:[],count:0};
  for(const file of files){
    const parts=displayPath(file).split('/').filter(Boolean);let folder=root;folder.count++;
    for(let i=0;i<parts.length-1;i++){
      const path=parts.slice(0,i+1).join('/');
      let next=folder.children.find(child=>child.kind==='folder'&&child.path===path);
      if(!next){next={kind:'folder',name:parts[i],path,children:[],count:0};folder.children.push(next);}
      next.count++;folder=next;
    }
    folder.children.push({kind:'file',name:parts.at(-1),path:file.path,file});
  }
  const sort=folder=>{folder.children.sort((a,b)=>(a.kind==='folder'?0:1)-(b.kind==='folder'?0:1)||compare(a.name,b.name));for(const child of folder.children)if(child.kind==='folder')sort(child);};
  sort(root);return root;
}
export function mergeRecents(recents,file,workspace,limit=30) {
  return [{path:file.path,name:fileName(file),workspace,openedAt:Date.now()},...recents.filter(entry=>entry.path!==file.path||entry.workspace!==workspace)].slice(0,limit);
}
