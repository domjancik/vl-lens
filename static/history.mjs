import {layoutHistory,rangeSelection} from './history-model.mjs';

const COLORS=['#86deb8','#8ebcfa','#d8a9ec','#e3bd78','#7ed1dc','#efa3a3','#b7cb81','#aea7f4'];
const ROW=64,NS='http://www.w3.org/2000/svg';
const $=id=>document.getElementById(id);
function el(tag,cls='',text=''){const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;}
function button(label,action,cls=''){const b=el('button',cls,label);b.type='button';b.addEventListener('click',action);return b;}
function shape(tag,attrs){const e=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,String(v));return e;}
function date(value){const d=new Date(value);return Number.isNaN(+d)?'':new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(d);}

export function createHistoryBrowser({api,ensureGit,getRange,onApply,getError,getWorkspace}){
  const dialog=$('gitHistory');
  let data=null,commits=[],graph=null,base='',target='',active='base',browseRef='',anchor='',page=1,ticket=0,busy=false,applying=false;
  const lookup=()=>new Map(commits.map(c=>[c.oid,c]));
  function resolved(value){
    if(value==='HEAD')return data?.head||value;
    const ref=data?.refs.find(r=>r.name===value);if(ref)return ref.oid;
    const matches=commits.filter(c=>c.oid.startsWith(value));return value&&matches.length===1?matches[0].oid:value;
  }
  function endpoint(value){
    if(value==='WORKTREE')return {title:'Working tree',detail:'Current files · includes untracked patches'};
    if(value==='INDEX')return {title:'Staged changes',detail:'Current Git index'};
    const oid=resolved(value),commit=lookup().get(oid),refs=data?.refs.filter(r=>r.oid===oid)||[];
    return {title:refs[0]?.name||commit?.subject||value||'Choose a commit',
      detail:commit?oid.slice(0,8)+' · '+commit.author:oid?oid.slice(0,16)+' · outside loaded history':'Select from the graph or branch list'};
  }
  function error(message=''){$('historyError').textContent=message;$('historyError').hidden=!message;}
  function select(value,side=active){
    if(side==='base'&&value==='WORKTREE')return;
    if(side==='base')base=value;else target=value;
    active='target';
    render();
  }
  function range(){
    const a=resolved(base),b=resolved(target),selection=rangeSelection(commits,a,b);
    for(const [id,value,side]of [['historyBase',base,'base'],['historyTarget',target,'target']]){
      const node=$(id),info=endpoint(value);
      node.querySelector('strong').textContent=info.title;node.querySelector('small').textContent=info.detail;
      node.setAttribute('aria-pressed',String(active===side));
      node.title=(side==='base'?'Before':'After')+' snapshot: '+value;
    }
    $('historyApply').disabled=!base||!target||busy||applying;
    $('historySwap').disabled=target==='WORKTREE'||busy;
    const descriptions={same:'Same snapshot selected',forward:'Forward range',reverse:'Reverse comparison',diverged:'Across branches',unknown:'Ancestry extends outside loaded history',local:'Local snapshot comparison'};
    $('historyRangeNote').textContent=descriptions[selection.relationship]+(selection.included.size?' · '+selection.included.size+' loaded commits in range':'')+' · Net changes from A to B';
    return {a,b,selection};
  }
  function renderRefs(){
    const list=$('historyRefs'),filter=$('historyBranchSearch').value.toLowerCase();list.replaceChildren();
    const all=button(data?.provider==='github'?'⑂ Branch overview':'⑂ All branches',()=>load('*'),'history-all');
    all.setAttribute('aria-pressed',String(browseRef==='*'));list.append(all);
    for(const [kind,label]of [['branch','Branches'],['remote','Remote refs'],['tag','Tags']]){
      const refs=(data?.refs||[]).filter(r=>(r.kind||'branch')===kind&&r.name.toLowerCase().includes(filter));
      if(!refs.length)continue;
      list.append(el('div','history-ref-heading',label+' · '+refs.length));
      for(const ref of refs){
        const row=el('div','history-ref-row'),node=graph?.nodes.find(n=>n.oid===ref.oid),color=COLORS[(node?.lane??data.refs.indexOf(ref))%COLORS.length];
        const open=button('',()=>load(ref.name),'history-ref');
        open.title=ref.name+' · '+ref.oid;open.setAttribute('aria-pressed',String(browseRef===ref.name));
        const swatch=el('span','history-ref-dot');swatch.style.background=color;
        open.append(swatch,el('span','history-ref-name',ref.name));
        if(ref.name===data.defaultBranch)open.append(el('small','history-default','default'));
        row.append(open);
        for(const [side,label]of [['base','A'],['target','B']]){
          const choose=button(label,()=>select(ref.oid,side),'history-mini '+side);
          choose.title='Use '+ref.name+' as '+side;choose.setAttribute('aria-label',choose.title);row.append(choose);
        }
        list.append(row);
      }
    }
    if(filter&&!(data?.refs||[]).some(r=>r.name.toLowerCase().includes(filter)))list.append(el('p','history-muted','No matching refs. Open another branch, tag or commit below.'));
  }
  function render(){
    const scroll=$('historyScroll').scrollTop,focused=document.activeElement?.closest('[data-commit]')?.dataset.commit;
    const {a,b,selection}=range();
    const filter=$('historyCommitSearch').value.trim().toLowerCase();
    const visible=commits.filter(c=>[c.subject,c.author,c.oid,...(data?.refs.filter(r=>r.oid===c.oid).map(r=>r.name)||[])].join(' ').toLowerCase().includes(filter));
    graph=layoutHistory(visible);const byId=new Map(graph.nodes.map(n=>[n.oid,n]));
    const container=$('historyRows');container.replaceChildren();
    const width=Math.max(92,graph.lanes*22+30);container.style.setProperty('--history-graph-width',width+'px');
    const svg=shape('svg',{class:'history-lanes',width,height:graph.nodes.length*ROW,'aria-hidden':'true'});
    const x=lane=>23+22*lane,y=row=>row*ROW+ROW/2;
    for(const edge of graph.edges){
      const from=byId.get(edge.from),to=byId.get(edge.to),x1=x(from.lane),x2=x(to?.lane??edge.toLane),y1=y(from.row),y2=to?y(to.row):y1+25;
      const path=x1===x2?`M${x1} ${y1}V${y2}`:`M${x1} ${y1}C${x1} ${y1+20} ${x2} ${y1+20} ${x2} ${Math.min(y1+38,y2)}V${y2}`;
      svg.append(shape('path',{d:path,stroke:COLORS[edge.toLane%COLORS.length],fill:'none','stroke-width':2,'stroke-dasharray':edge.missing?'3 4':'none',opacity:edge.missing?.5:.8}));
    }
    for(const commit of graph.nodes){
      const selected=commit.oid===a?'base':commit.oid===b?'target':'';
      svg.append(shape('circle',{cx:x(commit.lane),cy:y(commit.row),r:selected?6:4,
        fill:COLORS[commit.lane%COLORS.length],stroke:selected==='base'?'#f1ca85':selected==='target'?'#b6f5d0':'#14202b','stroke-width':selected?3:2}));
      const row=el('div','history-commit'+(selection.included.has(commit.oid)?' in-range':'')+(commit.oid===a?' is-base':'')+(commit.oid===b?' is-target':''));
      row.dataset.commit=commit.oid;
      const choose=button('',event=>select(commit.oid,event.shiftKey?'base':active),'history-commit-main');
      choose.setAttribute('aria-label',commit.subject+', '+commit.oid.slice(0,8)+'. Select '+active);
      choose.title=commit.subject+'\n'+commit.oid+'\n'+commit.author+' · '+commit.date;
      const heading=el('span','history-commit-heading');
      if(commit.oid===a)heading.append(el('span','history-endpoint base','A'));
      if(commit.oid===b)heading.append(el('span','history-endpoint target','B'));
      const refs=data?.refs.filter(r=>r.oid===commit.oid)||[];
      for(const ref of refs.slice(0,3)){const badge=el('span','history-branch-badge',ref.name);badge.style.setProperty('--branch-color',COLORS[commit.lane%COLORS.length]);heading.append(badge);}
      if(refs.length>3)heading.append(el('small','history-muted','+'+(refs.length-3)));
      if(commit.oid===data?.head)heading.append(el('span','history-head','HEAD'));
      heading.append(el('span','history-subject',commit.subject));
      const meta=el('span','history-commit-meta');
      meta.append(el('code','',commit.oid.slice(0,8)),el('span','',commit.author),el('time','',date(commit.date)));
      if(commit.parents.length>1)meta.append(el('span','history-merge','Merge · '+commit.parents.length+' parents'));
      choose.append(heading,meta);row.append(choose);
      for(const [side,label]of [['base','A'],['target','B']]){
        const pick=button(label,()=>select(commit.oid,side),'history-mini '+side);
        pick.title='Set '+commit.oid.slice(0,8)+' as '+side;pick.setAttribute('aria-label',pick.title);row.append(pick);
      }
      const review=button('↗',()=>{base=commit.parents[0];target=commit.oid;render();},'history-mini history-review');
      review.disabled=!commit.parents.length;
      review.title=review.disabled?'Root commit has no parent. Choose two snapshots.':'Review only this commit against its first parent';
      review.setAttribute('aria-label','Review commit '+commit.oid.slice(0,8));row.append(review);
      container.append(row);
    }
    container.append(svg);
    if(!visible.length)container.append(el('p','history-empty',busy?'Loading history…':'No matching commits in loaded history.'));
    $('historyCount').textContent=(filter?visible.length+' of ':'')+commits.length+' commits loaded';
    $('historyBrowseLabel').textContent=browseRef==='*'?(data?.provider==='github'?'Branch overview':'All branches'):data?.refs.find(r=>r.name===browseRef)?.name||browseRef.slice(0,12)||'History';
    $('historyBoundary').textContent=filter?'Filtered view · dashed lines lead to hidden or unloaded parents':'Dashed lines lead to unloaded parents · Click selects '+active+' · Shift-click selects base';
    $('historyMore').hidden=!data?.hasMore;
    $('historyMore').disabled=busy||commits.length>=600;
    $('historyMore').textContent=commits.length>=600?'600 commits loaded · choose a narrower branch':'Load older commits';
    renderRefs();$('historyScroll').scrollTop=scroll;
    if(focused){const row=[...container.querySelectorAll('[data-commit]')].find(r=>r.dataset.commit===focused);row?.querySelector('button').focus({preventScroll:true});}
  }
  async function load(ref,append=false){
    const request=++ticket;busy=true;error();range();$('historyStatus').textContent='Loading '+(ref==='*'?'branch overview':ref||'history')+'…';
    $('historyMore').disabled=true;
    try{
      const next=append?page+1:1;
      const result=await api('/api/git/history?'+new URLSearchParams({ref,page:next,limit:50}));
      if(request!==ticket)return;
      data=result;page=next;
      if(!append){commits=result.commits;anchor=result.anchor;browseRef=ref||result.defaultBranch||result.ref;$('historyScroll').scrollTop=0;}
      else commits=[...new Map([...commits,...result.commits].map(c=>[c.oid,c])).values()];
      $('historyNotice').textContent=result.notice||'';
      $('historyNotice').hidden=!result.notice;
      $('historyLocalPresets').hidden=!result.specialRevisions?.length;
      $('historyStatus').textContent=result.provider==='github'?'Public GitHub · read only':'Local Git · read only';
    }catch(failure){if(request===ticket){error(failure.message);$('historyStatus').textContent='History could not be loaded';}}
    finally{if(request===ticket){busy=false;render();}}
  }
  async function open(){
    error();$('historyRepo').textContent=getWorkspace().name;
    dialog.showModal();$('historyStatus').textContent='Reading Git repository…';
    try{
      await ensureGit();
      if(!dialog.open)return;
      ({base,target}=getRange());active='base';
      await load(['INDEX','WORKTREE'].includes(target)?'HEAD':target||'HEAD');
    }catch(failure){error(failure.message);}
  }
  $('historyClose').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{ticket++;busy=false;});
  $('historyBase').addEventListener('click',()=>{active='base';render();});
  $('historyTarget').addEventListener('click',()=>{active='target';render();});
  $('historySwap').addEventListener('click',()=>{[base,target]=[target,base];render();});
  $('historyCommitSearch').addEventListener('input',render);
  $('historyBranchSearch').addEventListener('input',renderRefs);
  $('historyRefForm').addEventListener('submit',event=>{event.preventDefault();const ref=$('historyRefInput').value.trim();if(ref)void load(ref);});
  $('historyMore').addEventListener('click',()=>load(browseRef==='*'?'*':anchor,true));
  $('historyLatest').addEventListener('click',()=>{
    const first=commits[0];
    if(!first?.parents.length){error('Choose two snapshots; this commit has no parent.');return;}
    base=first.parents[0];target=first.oid;render();
  });
  for(const [id,a,b]of [['historyWorking','HEAD','WORKTREE'],['historyStaged','HEAD','INDEX'],['historyUnstaged','INDEX','WORKTREE']]){
    $(id).addEventListener('click',()=>{base=a;target=b;render();});
  }
  $('historyApply').addEventListener('click',async()=>{
    applying=true;range();error();
    try{const okay=await onApply(resolved(base),resolved(target));if(okay)dialog.close();else error(getError()||'The range could not be compared.');}
    catch(failure){error(failure.message);}
    finally{applying=false;range();}
  });
  $('historyRows').addEventListener('keydown',event=>{
    const main=event.target.closest('.history-commit-main');if(!main)return;
    const rows=[...$('historyRows').querySelectorAll('.history-commit-main')],index=rows.indexOf(main);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();rows[event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,index+(event.key==='ArrowDown'?1:-1)))]?.focus();
    }else if(event.key==='a'||event.key==='b'){
      event.preventDefault();select(main.closest('[data-commit]').dataset.commit,event.key==='a'?'base':'target');
    }
  });
  return {open};
}
