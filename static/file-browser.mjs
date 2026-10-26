import {rankFiles,buildFileTree,mergeRecents,fileName,displayPath} from './files.mjs';

const $=id=>document.getElementById(id);
function el(tag,className='',text=''){const node=document.createElement(tag);node.className=className;node.textContent=text;return node;}
function action(text,callback,className=''){const node=el('button',className,text);node.addEventListener('click',callback);return node;}
const RECENTS_KEY='vl-lens.recent-files.v1';

export function createFileBrowser({getProject,getOpened,getWorkspace,getCurrent,getContext,getStatus,getError,onOpen,onRefresh,onFiles,onFolder}) {
  let source='project',selected=0,results=[],recents=[],sessionRecents=[],lastPath=null;
  const expanded=new Set();
  try{const stored=JSON.parse(localStorage.getItem(RECENTS_KEY)||'[]');if(Array.isArray(stored))recents=stored.filter(e=>typeof e.path==='string'&&typeof e.workspace==='string').slice(0,100);}catch{}
  const project=()=>getProject().map(file=>({...file,source:'project'}));
  const opened=()=>getOpened().map(file=>({...file,source:'opened'}));
  function recentFiles(){
    const available=new Map([...project(),...opened()].map(file=>[file.path,file]));
    return [...sessionRecents,...recents.filter(e=>e.workspace===getWorkspace().id)].sort((a,b)=>b.openedAt-a.openedAt)
      .map(entry=>available.get(entry.path)||{path:entry.path,name:entry.name,source:'project',unavailable:true});
  }
  const list=()=>source==='opened'?opened():source==='recent'?recentFiles():project();
  const descriptor=()=>source==='opened'?'Opened files · this session':source==='recent'?'Recent in this project':getContext();
  function setSource(next){source=next;selected=0;refresh();}
  function updateSources(){
    const counts={project:getProject().length,opened:getOpened().length,recent:recentFiles().length};
    for(const prefix of ['file','quick'])for(const button of document.querySelectorAll(`[data-${prefix}-source]`)){
      const value=button.dataset[`${prefix}Source`];button.setAttribute('aria-pressed',String(source===value));
      const label=value==='project'?'Project':value==='opened'?'Opened':'Recent';button.textContent=`${label} ${counts[value]}`;
    }
  }
  function badge(file){
    if(file.unavailable)return 'Unavailable';
    if(file.source==='opened')return file.batchLabel||'Opened';
    if(file.existsBefore&&!file.existsAfter)return 'Base only';
    if(file.existsAfter&&!file.existsBefore)return 'Target only';
    return {added:'Added',removed:'Removed',renamed:'Renamed',modified:'Modified'}[getStatus(file.path)]||(file.isRecent?'Recent':'');
  }
  async function choose(file){
    if(!file||file.unavailable)return;
    $('quickError').hidden=true;
    const loaded=await onOpen(file);
    if(loaded!==false&&getCurrent()?.path===file.path)$('quickOpen').close();
    else{$('quickError').textContent=getError()||'That file could not be opened. Choose another file.';$('quickError').hidden=false;}
  }
  function fileRow(file,{quick=false,index=0,depth=0,showPath=false}={}){
    const current=getCurrent()?.path===file.path;
    const row=action('',()=>choose(file),`${quick?'quick-file':'file-row'}${current?' current':''}${quick&&index===selected?' active':''}`);
    row.title=displayPath(file);row.disabled=Boolean(file.unavailable);
    row.append(el('span','file-glyph',file.path.split('.').at(-1).slice(0,4).toUpperCase()));
    const label=el('span','file-row-label');label.append(el('span','file-name',fileName(file)));
    if(showPath||quick){const folder=displayPath(file).split('/').slice(0,-1).join('/');label.append(el('small','file-location',folder||'Project root'));}
    row.append(label);const status=badge(file);if(status)row.append(el('span',`file-badge ${getStatus(file.path)||''}`,status));
    if(current)row.setAttribute('aria-current','page');
    if(quick){row.id=`quick-file-${index}`;row.setAttribute('role','option');row.setAttribute('aria-selected',String(index===selected));row.tabIndex=-1;}
    else{row.style.setProperty('--depth',String(depth));row.dataset.treeRow='';}
    return row;
  }
  function renderTree(){
    const container=$('fileTree'),query=$('fileSearch').value.trim(),files=list();container.replaceChildren();
    $('fileContext').textContent=`${descriptor()} · ${files.length}`;
    container.setAttribute('aria-label',descriptor());
    if(query||source==='recent'){
      const matches=query?rankFiles(files,query,200):files;
      for(const file of matches)container.append(fileRow(file,{showPath:true}));
      if(!matches.length)container.append(el('p','file-empty',query?'No matching files. Try a filename or part of its path.':source==='recent'?'Your recently viewed project files will appear here.':'No files in this source.'));
      if(matches.length===200&&files.length>200)container.append(el('p','file-empty','First 200 matches shown. Add another word to narrow the search.'));
      return;
    }
    if(!files.length){container.append(el('p','file-empty',source==='opened'?'Open files or a local folder to add patches to this session.':'No files found in this source. Open a local folder or choose another Git range.'));return;}
    let rows=0;
    function folder(node,depth){
      for(const child of node.children){
        if(rows++>1500)return;
        if(child.kind==='file'){container.append(fileRow(child.file,{depth}));continue;}
        const key=`${source}:${child.path}`,isOpen=expanded.has(key);
        const row=action('',()=>{if(expanded.has(key))expanded.delete(key);else expanded.add(key);renderTree();},'folder-row');
        row.style.setProperty('--depth',String(depth));row.dataset.treeRow='';row.dataset.folder=child.path;row.dataset.folderKey=key;
        row.setAttribute('aria-expanded',String(isOpen));row.setAttribute('aria-label',`${child.name}, ${child.count} VL files`);
        row.append(el('span','folder-chevron',isOpen?'⌄':'›'),el('span','folder-icon','▱'),el('span','folder-name',child.name),el('span','folder-count',String(child.count)));
        container.append(row);if(isOpen)folder(child,depth+1);
      }
    }
    folder(buildFileTree(files),0);
    if(rows>1500)container.append(el('p','file-empty','Use search to find more files.'));
  }
  function renderQuick(){
    const container=$('quickResults'),files=list(),query=$('quickSearch').value.trim();
    if(source==='project'&&!query){
      const recent=recentFiles().filter(file=>file.source==='project'&&!file.unavailable).slice(0,6).map(file=>({...file,isRecent:true}));
      const seen=new Set(recent.map(file=>file.path));results=[...recent,...rankFiles(files,'',80).filter(file=>!seen.has(file.path))].slice(0,80);
    }else results=source==='recent'&&!query?files.slice(0,80):rankFiles(files,query,80);
    selected=Math.max(0,Math.min(selected,results.length-1));container.replaceChildren();
    for(const [index,file] of results.entries())container.append(fileRow(file,{quick:true,index}));
    $('quickResultCount').textContent=`${results.length}${results.length===80&&files.length>80?' of '+files.length:''} ${results.length===1?'file':'files'}`;
    $('quickWorkspace').textContent=`${getWorkspace().name} / ${descriptor()}`;
    if(results.length){$('quickSearch').setAttribute('aria-activedescendant',`quick-file-${selected}`);$('quickSearch').setAttribute('aria-expanded','true');}
    else{$('quickSearch').removeAttribute('aria-activedescendant');container.append(el('p','quick-empty',query?'No matching VL files. Try fewer words or a folder name.':source==='recent'?'Open a patch to start your recent list.':'No files here yet. Open files or a folder below.'));}
  }
  function refresh(){
    $('workspaceName').textContent=getWorkspace().name||'Project';$('documentCount').textContent=String(getProject().length+getOpened().length);
    const current=getCurrent(),file=[...project(),...opened()].find(f=>f.path===current?.path)||current;
    $('currentFileButton').replaceChildren(el('span','current-file-name',file?fileName(file):'Choose a .vl file'),el('span','','⌄'));
    $('currentFileButton').title=file?displayPath(file):'Open the file picker';$('revealFile').disabled=!file;
    $('sourcePath').textContent=file?displayPath(file).split('/').slice(0,-1).join('/')||'Project root':'';
    updateSources();renderTree();if($('quickOpen').open)renderQuick();
  }
  function open(nextSource){
    if(nextSource)source=nextSource;selected=0;$('quickSearch').value='';$('quickError').hidden=true;refresh();renderQuick();
    if(!$('quickOpen').open)$('quickOpen').showModal();$('quickSearch').focus();
  }
  function showTab(tab){
    const files=tab==='files';$('fileBrowserPanel').hidden=!files;$('definitionPanel').hidden=files;
    $('browserTabFiles').setAttribute('aria-pressed',String(files));$('browserTabDefinitions').setAttribute('aria-pressed',String(!files));
  }
  function reveal(){
    const current=getCurrent();if(!current)return;
    source=getOpened().some(f=>f.path===current.path)?'opened':'project';showTab('files');$('fileSearch').value='';
    const file=list().find(f=>f.path===current.path)||current,parts=displayPath(file).split('/');
    for(let i=1;i<parts.length;i++)expanded.add(`${source}:${parts.slice(0,i).join('/')}`);
    refresh();const row=$('fileTree').querySelector('[aria-current="page"]');if(row)row.scrollIntoView({block:'nearest'});
  }
  function remember(path){
    const file=[...project(),...opened()].find(f=>f.path===path)||{path};
    if(file.source==='opened')sessionRecents=mergeRecents(sessionRecents,file,getWorkspace().id);
    else{recents=mergeRecents(recents,file,getWorkspace().id,60);try{localStorage.setItem(RECENTS_KEY,JSON.stringify(recents));}catch{}}
    if(path!==lastPath){lastPath=path;reveal();}else refresh();
  }
  for(const prefix of ['file','quick'])for(const button of document.querySelectorAll(`[data-${prefix}-source]`))button.addEventListener('click',()=>setSource(button.dataset[`${prefix}Source`]));
  $('fileSearch').addEventListener('input',renderTree);
  $('quickSearch').addEventListener('input',()=>{selected=0;$('quickError').hidden=true;renderQuick();});
  $('quickSearch').addEventListener('keydown',event=>{
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();selected=Math.max(0,Math.min(results.length-1,selected+(event.key==='ArrowDown'?1:-1)));renderQuick();$(`quick-file-${selected}`)?.scrollIntoView({block:'nearest'});}
    if(event.key==='Enter'){event.preventDefault();void choose(results[selected]);}
  });
  $('fileTree').addEventListener('keydown',event=>{
    const rows=[...$('fileTree').querySelectorAll('[data-tree-row]')],index=rows.indexOf(document.activeElement);
    if(index<0)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();rows[Math.max(0,Math.min(rows.length-1,index+(event.key==='ArrowDown'?1:-1)))]?.focus();}
    if((event.key==='ArrowRight'||event.key==='ArrowLeft')&&rows[index].dataset.folderKey){
      event.preventDefault();const key=rows[index].dataset.folderKey;
      if(event.key==='ArrowRight')expanded.add(key);else expanded.delete(key);
      renderTree();[...$('fileTree').querySelectorAll('[data-folder-key]')].find(row=>row.dataset.folderKey===key)?.focus();
    }
  });
  $('quickOpenButton').addEventListener('click',()=>open());$('currentFileButton').addEventListener('click',()=>open());$('welcomeBrowse').addEventListener('click',()=>open('project'));
  $('closeQuick').addEventListener('click',()=>$('quickOpen').close());
  $('quickOpen').addEventListener('click',event=>{if(event.target===$('quickOpen')){const r=$('quickOpen').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('quickOpen').close();}});
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='p'){event.preventDefault();open();}});
  $('revealFile').addEventListener('click',reveal);$('collapseFolders').addEventListener('click',()=>{expanded.clear();renderTree();});
  $('browserTabFiles').addEventListener('click',()=>showTab('files'));$('browserTabDefinitions').addEventListener('click',()=>showTab('definitions'));
  const files=()=>{if($('quickOpen').open)$('quickOpen').close();$('openMenu').open=false;onFiles();};
  const folder=()=>{if($('quickOpen').open)$('quickOpen').close();$('openMenu').open=false;onFolder();};
  $('uploadButton').addEventListener('click',files);$('quickFiles').addEventListener('click',files);
  $('folderButton').addEventListener('click',folder);$('quickFolder').addEventListener('click',folder);$('welcomeFolder').addEventListener('click',folder);
  $('refreshProject').addEventListener('click',()=>{$('openMenu').open=false;void onRefresh();});
  return {refresh,open,reveal,remember,showTab};
}
