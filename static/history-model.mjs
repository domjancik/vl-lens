/** Pure, provider-independent commit topology and range selection. */
export function layoutHistory(input){
  const commits=new Map();
  for(const commit of input)if(!commits.has(commit.oid))commits.set(commit.oid,{...commit,parents:[...new Set(commit.parents||[])]});
  const order=new Map([...commits.keys()].map((id,index)=>[id,index]));
  const incoming=new Map([...commits.keys()].map(id=>[id,0]));
  for(const commit of commits.values())for(const parent of commit.parents)if(commits.has(parent))incoming.set(parent,incoming.get(parent)+1);
  const ready=[...commits.keys()].filter(id=>!incoming.get(id)),sorted=[];
  while(ready.length){
    ready.sort((a,b)=>order.get(a)-order.get(b));
    const id=ready.shift();sorted.push(commits.get(id));
    for(const parent of commits.get(id).parents)if(incoming.has(parent)){
      incoming.set(parent,incoming.get(parent)-1);
      if(!incoming.get(parent))ready.push(parent);
    }
  }
  if(sorted.length!==commits.size)throw Error('History contains cyclic parent links.');
  const lanes=[],nodes=[],edges=[];
  let width=1;
  for(const commit of sorted){
    let lane=lanes.indexOf(commit.oid);
    if(lane<0){lane=lanes.indexOf(null);if(lane<0)lane=lanes.length;}
    lanes[lane]=commit.oid;
    nodes.push({...commit,lane,row:nodes.length});
    lanes[lane]=null;
    const used=new Set();
    for(const [index,parent] of commit.parents.entries()){
      let column=lanes.indexOf(parent);
      if(column<0){
        column=index===0&&lanes[lane]===null?lane:lanes.indexOf(null);
        if(column<0)column=lanes.length;
        while(used.has(column)||lanes[column]!=null)column++;
        if(commits.has(parent))lanes[column]=parent;
      }
      used.add(column);
      edges.push({from:commit.oid,to:parent,fromLane:lane,toLane:column,missing:!commits.has(parent)});
      width=Math.max(width,column+1);
    }
    width=Math.max(width,lane+1);
  }
  return {nodes,edges,lanes:width};
}

export function rangeSelection(commits,base,target){
  const known=new Map(commits.map(c=>[c.oid,c]));
  function ancestry(id){
    const found=new Set(),pending=[id];let complete=true;
    while(pending.length){
      const next=pending.pop();if(!next||found.has(next))continue;
      found.add(next);
      const commit=known.get(next);
      if(!commit){complete=false;continue;}
      pending.push(...(commit.parents||[]));
    }
    return {found,complete};
  }
  if(['INDEX','WORKTREE'].includes(base)||['INDEX','WORKTREE'].includes(target))return {included:new Set(),relationship:'local',complete:false};
  const before=ancestry(base),after=ancestry(target);
  const included=new Set([...after.found].filter(id=>known.has(id)&&!before.found.has(id)));
  const relationship=base===target?'same':after.found.has(base)?'forward':before.found.has(target)?'reverse':
    before.complete&&after.complete?'diverged':'unknown';
  return {included,relationship,complete:before.complete&&after.complete};
}
