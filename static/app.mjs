import {indexDocument, buildScene, children, referenceOf, choicesOf, isDefinition, labelOf, resolveReference} from './model.mjs';
import {diffDocuments} from './diff.mjs';
import {createFileBrowser} from './file-browser.mjs';
import {apiURL,viewerURL} from './remote.mjs';

const connectionParams=new URLSearchParams(location.search);
const connection={repo:connectionParams.get('repo')||'',ref:connectionParams.get('ref')||'',snapshot:''};
let appConfig={hosted:false,maxUploadBytes:12*1024*1024};

const $ = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';
const state = {catalog:[], uploads:[], workspace:{id:'local',name:'Project',gitAvailable:true,exportsAvailable:false}, importBatch:0,model:null, scene:null, scope:'', operation:'', selected:'', tab:'inspect', camera:null, load:0, exportRequest:0, identities:new Map()};
const git = {enabled:false,side:'after',comparison:null,before:null,after:null,diff:null,changes:[],documents:[],file:null,raw:false,request:0};
const fileBrowser=createFileBrowser({getProject:()=>git.enabled?git.documents:state.catalog,getOpened:()=>state.uploads,
  getWorkspace:()=>state.workspace,getCurrent:()=>state.model,
  getError:()=>$('error').hidden?'':$('errorText').textContent,
  getContext:()=>git.enabled?`Git snapshots · ${git.base?.id.slice(0,8)||'…'} → ${git.target?.id.slice(0,8)||'…'}`:'Project files',
  getStatus:path=>git.enabled?git.changes.find(file=>file.path===path||file.oldPath===path)?.status:null,
  onOpen:file=>loadDocument(file.path),onRefresh:refreshProject,onFiles:()=>$('fileInput').click(),onFolder:()=>$('folderInput').click()});
function element(tag, className='', text='') {
  const node=document.createElement(tag);node.className=className;node.textContent=text;return node;
}
function svg(tag, attributes={}, text) {
  const node=document.createElementNS(svgNS,tag);
  for (const [key,value] of Object.entries(attributes)) node.setAttribute(key,String(value));
  if (text!==undefined) node.textContent=text;
  return node;
}
function button(text, action, className='subtle-button') {
  const node=element('button',className,text);node.addEventListener('click',action);return node;
}
function showError(message) {$('errorText').textContent=message;$('error').hidden=false;}
async function api(url, options) {
  const response=await fetch(apiURL(url,connection),options);
  let data;try{data=await response.json();}catch{throw Error('The server could not return this result. Try a smaller file or the desktop app.');}
  if (!response.ok) throw new Error(data.error||`Request failed (${response.status})`);
  return data;
}
function updateHash() {
  if (!state.model || state.model.uploaded) return;
  const hash=new URLSearchParams({file:state.model.path,scope:state.scope});
  if (state.operation) hash.set('operation',state.operation);
  if(git.enabled&&git.comparison){hash.set('git','1');hash.set('base',git.comparison.base.id);hash.set('target',git.comparison.target.id);hash.set('side',git.side);if(git.comparison.oldPath)hash.set('oldPath',git.comparison.oldPath);}
  history.replaceState(null,'',`#${hash}`);
}
function refreshDocuments() {
  fileBrowser.refresh();
}
async function refreshProject(){
  try{
    const data=await api('/api/documents');state.catalog=data.documents;state.workspace=data.workspace;
    connection.snapshot=data.workspace.revision||'';
    $('gitToggle').disabled=!data.workspace.gitAvailable;$('gitToggle').title=data.workspace.gitAvailable?'Compare Git snapshots':'This project is not a Git checkout';
    refreshDocuments();if(git.enabled)await refreshComparison();
  }catch(error){showError(error.message);}
}
async function loadDocument(path, scope='', operation='') {
  if(git.enabled&&!state.uploads.some(doc=>doc.path===path))return loadComparison(path,scope,operation);
  if(git.enabled)await setGitMode(false,{reload:false});
  const request=++state.load;
  $('scopeSubtitle').textContent='Reading saved graph…';
  try {
    const upload=state.uploads.find(doc=>doc.path===path);
    if(upload&&!upload.document)upload.document=await api('/api/parse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,source:await upload.file.text()})});
    const doc=upload?.document || await api(`/api/document?${new URLSearchParams({path})}`);
    if (request!==state.load) return;
    installModel(indexDocument({...doc,uploaded:Boolean(upload)}),scope,operation);
    if (innerWidth<600) document.body.classList.remove('mobile-browse');
    return true;
  } catch(error) {showError(error.message);refreshDocuments();return false;}
}
function installModel(model,scope='',operation='') {
  state.model=model;
  $('welcome').hidden=true;
  for(const id of ['fitButton','zoomIn','zoomOut','downloadSvg','findingsButton'])$(id).disabled=false;
  const paths=state.identities.get(model.documentId)||new Set();paths.add(model.path);state.identities.set(model.documentId,paths);
  $('sourcePath').textContent=model.path;$('sourcePath').title=model.path;
  $('documentVersion').textContent=`VL ${model.tree.attrs.LanguageVersion||'version unspecified'}`;
  $('definitionSearch').value='';$('error').hidden=true;fileBrowser.remember(model.path);
  openScope(scope&&model.byId.has(scope)?scope:model.definitions[0]?.id||model.documentId,operation);
}
function statusFor(id) {return git.enabled?git.diff?.[git.side==='before'?'beforeStatus':'afterStatus'].get(id):null;}
function openScope(id,operation='') {
  state.scope=id;state.operation=operation;state.selected='';
  state.scene=buildScene(state.model,id,operation);
  if (operation && !state.scene.operations.some(op=>op.id===operation)) {state.operation='';state.scene=buildScene(state.model,id);}
  includeRemovedBounds(state.scene);
  const scope=state.scene.scope;
  $('scopeTitle').textContent=scope.tag==='Document'?'Document overview':labelOf(scope);
  const ref=referenceOf(scope);
  const kind=choicesOf(scope).find(c=>/Definition$/.test(c.attrs.Kind))?.attrs.Name || (scope.tag==='Document'?'Document':'Region');
  $('scopeKind').textContent=kind;
  let ancestor=scope,category='';
  while (ancestor) {if(ancestor.attrs.DefaultCategory){category=ancestor.attrs.DefaultCategory;break;}ancestor=state.model.parent.get(ancestor);}
  $('scopeSubtitle').textContent=category || ref?.attrs.LastCategoryFullName || state.model.path.split('/').at(-1);
  const breadcrumbs=$('breadcrumbs');breadcrumbs.replaceChildren();
  breadcrumbs.append(button(state.model.path.split('/').at(-1),()=>openScope(state.model.documentId),''));
  const ancestors=[];ancestor=state.model.parent.get(scope);
  while(ancestor){if(ancestor.tag==='Node' && isDefinition(ancestor)) ancestors.unshift(ancestor);ancestor=state.model.parent.get(ancestor);}
  for(const item of ancestors){breadcrumbs.append(element('span','','/'),button(labelOf(item),()=>openScope(item.attrs.Id),''));}
  if(scope.tag!=='Document') breadcrumbs.append(element('span','','/'),element('span','',labelOf(scope)));
  const select=$('operationSelect');select.replaceChildren(new Option('All operations',''));
  for(const operation of state.scene.operations) select.append(new Option(operation.name,operation.id));
  select.value=state.operation;select.disabled=!state.scene.operations.length;
  $('operationNote').hidden=!state.operation;
  $('operationNote').textContent=state.scene.explicitParticipants.size
    ? `${state.scene.explicitParticipants.size} explicit participant(s) outlined in amber. Shared graph stays visible. Connectivity is not an execution schedule.`
    : 'Operation boundary pins shown. No explicit participant list is saved for this operation; shared nodes remain visible.';
  renderDefinitions();fit();renderInspector();updateHash();
}
function renderDefinitions() {
  if(!state.model) return;
  const list=$('definitions'),query=$('definitionSearch').value.toLowerCase();list.replaceChildren();
  const definitions=state.model.definitions.filter(def=>`${def.name} ${def.id} ${def.kind}`.toLowerCase().includes(query));
  $('definitionCount').textContent=String(state.model.definitions.length);
  for(const def of definitions){
    const item=button('',()=>openScope(def.id),`definition${state.scope===def.id?' active':''}${statusFor(def.id)?` diff-${statusFor(def.id)}`:''}`);
    item.title=`${def.kind} · ${def.id}`;item.setAttribute('aria-label',`${def.kind} ${def.name}`);
    item.append(element('span','kind-icon',def.kind==='Operation'?'ƒ':def.kind[0]||'N'),element('span','',def.name));list.append(item);
  }
  if(!definitions.length) list.append(element('p','empty-list','No matching definitions.'));
}
function selectElement(id) {state.selected=id;draw();renderInspector();}
function fit() {
  if(!state.scene)return;
  const b=state.scene.bounds,rect=$('graph').getBoundingClientRect();
  const aspect=(rect.width||700)/(rect.height||500),w=Math.max(b.w,b.h*aspect),h=w/aspect;
  state.camera={x:b.x-(w-b.w)/2,y:b.y-(h-b.h)/2,w,h};draw();
}
function setCamera() {
  if(!state.camera)return;
  const c=state.camera;$('graph').setAttribute('viewBox',`${c.x} ${c.y} ${c.w} ${c.h}`);
  const bg=$('graphBackground');if(bg)for(const key of ['x','y','width','height'])bg.setAttribute(key,String(c[{width:'w',height:'h'}[key]||key]));
  $('zoomLevel').textContent=`${Math.round(($('graph').getBoundingClientRect().width||700)/c.w*100)}%`;
}
function activateSvg(node,id,label,side=null) {
  node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',label);
  node.setAttribute('data-diff-id',id);
  const action=()=>side?navigateChange({id},side):selectElement(id);
  node.addEventListener('click',event=>{event.stopPropagation();if(!panMoved)action();});
  node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();action();}});
}
function draw() {
  if(!state.scene)return;
  const graph=$('graph'),scene=state.scene,selected=state.selected;
  graph.replaceChildren();
  const defs=svg('defs'),pattern=svg('pattern',{id:'dots',width:20,height:20,patternUnits:'userSpaceOnUse'});
  pattern.append(svg('circle',{cx:1,cy:1,r:.65,fill:'#304453'}));defs.append(pattern);graph.append(defs);
  graph.append(svg('rect',{id:'graphBackground',fill:'url(#dots)'}));
  drawRemovals(graph);
  for(const overlay of scene.overlays){
    const group=svg('g',{'pointer-events':'none'});group.append(svg('rect',{x:overlay.x,y:overlay.y,width:overlay.w,height:overlay.h,rx:4,class:'overlay'}));
    group.append(svg('text',{x:overlay.x+7,y:overlay.y+13,class:'overlay-text'},overlay.element.attrs.Name||''));graph.append(group);
  }
  for(const n of scene.nodes.filter(n=>n.region)) {
    const g=svg('g',{class:`graph-node is-region${selected===n.id?' selected':''}`,'data-node':n.id});
    g.append(svg('rect',{x:n.x,y:n.y,width:n.w,height:n.h,rx:5,class:'region-body'}));
    const header=svg('g');
    header.append(svg('rect',{x:n.x,y:n.y,width:n.w,height:18,rx:4,fill:'#1c2c37'}),svg('text',{x:n.x+7,y:n.y+13,class:'region-text'},n.label));
    activateSvg(header,n.id,`Region ${n.label}`);g.append(header);graph.append(g);
  }
  for(const link of scene.links){
    if(link.hidden&&!$('showHidden').checked)continue;
    let path=`M${link.points[0].x},${link.points[0].y}`;
    for(let i=1;i<link.points.length;i++){
      const a=link.points[i-1],b=link.points[i],mid=(a.y+b.y)/2;
      path+=` C${a.x},${mid} ${b.x},${mid} ${b.x},${b.y}`;
    }
    const group=svg('g');const classes=`link${link.state?' state':''}${link.hidden?' hidden-link':''}${link.feedback?' feedback':''}${selected===link.id?' selected':''}`;
    group.append(svg('path',{d:path,class:'link-hit'}),svg('path',{d:path,class:classes}));
    group.append(svg('title',{},`${link.feedback?'Feedback':'Link'}${link.hidden?' · hidden':''} · ${link.id}`));
    activateSvg(group,link.id,`${link.feedback?'Feedback link':'Link'} ${link.id}`);graph.append(group);
  }
  for(const n of scene.nodes.filter(n=>!n.region)){
    const g=svg('g',{class:`graph-node${n.pad?' is-pad':''}${n.definition?' is-definition':''}${selected===n.id?' selected':''}${scene.explicitParticipants.has(n.id)?' explicit':''}`,'data-node':n.id});
    g.append(svg('rect',{x:n.x,y:n.y,width:n.w,height:n.h,rx:n.pad?3:4,class:'node-body'}));
    const maxCharacters=Math.max(1,Math.floor((n.w-12)/5.2));
    const compact=n.label.length>maxCharacters ? n.label.replace(/\s*\([^)]*\)$/,'') : n.label;
    const label=compact.length>maxCharacters?compact.slice(0,Math.max(1,maxCharacters-1))+'…':compact;
    g.append(svg('text',{x:n.x+8,y:n.y+Math.min(n.h/2+4,19),class:'node-text'},label),svg('title',{},`${n.label}\n${n.id}\n${referenceOf(n.element)?.attrs.LastCategoryFullName||''}`));
    activateSvg(g,n.id,`${n.pad?'Pad':'Node'} ${n.label}`);
    if(n.definition)g.addEventListener('dblclick',event=>{event.stopPropagation();openScope(n.id);});
    graph.append(g);
  }
  for(const [id,anchor] of scene.anchors){
    if(anchor.control){graph.append(svg('circle',{cx:anchor.x,cy:anchor.y,r:1.5,class:'control-point'}));continue;}
    if(anchor.boundary)continue;
    if(anchor.element.tag!=='Pin')continue;
    const pin=svg('circle',{cx:anchor.x,cy:anchor.y,r:2.8,class:`pin${anchor.state?' state-pin':''}${selected===id?' selected':''}`});
    const attrs=anchor.element.attrs;pin.append(svg('title',{},`${attrs.Name||'Pin'} · ${attrs.Kind||''}${attrs.DefaultValue!==undefined?` · default: ${attrs.DefaultValue}`:''}`));
    activateSvg(pin,id,`Pin ${attrs.Name||id}`);graph.append(pin);
    if($('showPins').checked)graph.append(svg('text',{x:anchor.x+4,y:anchor.y+(anchor.direction==='Input'?-6:10),class:'pin-label'},attrs.Name||''));
  }
  for(const port of scene.boundaryPorts){
    const g=svg('g',{class:'boundary-port'});g.append(svg('circle',{cx:port.x,cy:port.y,r:3.5,class:`pin${selected===port.id?' selected':''}`}));
    g.append(svg('text',{x:port.x+7,y:port.y+3,class:'boundary-label'},port.label),svg('text',{x:port.x+7,y:port.y+(port.input?-8:13),class:'boundary-op'},port.operation));
    activateSvg(g,port.id,`${port.operation} ${port.label}`);graph.append(g);
  }
  if(git.enabled)for(const node of graph.querySelectorAll('[data-node],[data-diff-id]')){
    if(node.closest('.removed-ghost'))continue;
    const status=statusFor(node.getAttribute('data-diff-id')||node.getAttribute('data-node'));
    if(status)node.classList.add(`diff-${status}`);
  }
  $('emptyGraph').hidden=Boolean(scene.nodes.length||scene.links.length);
  $('graphStats').textContent=`${scene.nodes.length} nodes · ${scene.links.length} placed links`;
  const findings=state.model.warnings.length;
  $('findingsButton').textContent=findings?`${findings} source findings`:'Source findings';setCamera();
}
function metadata(container,entries) {
  const dl=element('dl','metadata');
  for(const [label,value,accent] of entries){if(value===undefined||value==='')continue;dl.append(element('dt','',label),element('dd',accent?'accent':'',String(value)));}
  container.append(dl);
}
function heading(container,text){container.append(element('h3','',text));}
function typeHint(pin) {
  const annotation=children(pin,'p:TypeAnnotation')[0];
  if(!annotation)return '';
  const collect=e=>[e.attrs.Name||'',...e.children.flatMap(collect)].filter(Boolean);
  return collect(annotation).join(' · ');
}
function showSource(container,selected) {
  const start=Math.max(0,(selected.line||1)-1),lines=state.model.source.split(/\r?\n/);
  container.append(element('p','source-label',`${state.model.path}\nStarting at line ${start+1}`));
  const excerpt=lines.slice(start,start+100).map((line,index)=>`${String(start+index+1).padStart(5)}  ${line}`).join('\n');
  container.append(element('pre','source-code',excerpt),element('p','muted','Original file excerpt, up to 100 lines. XML order is not an execution schedule.'));
}
async function showExports(container,selected) {
  const request=++state.exportRequest,identity=selected.attrs.Id;
  if(state.model.uploaded){container.append(element('p','notice','Opened files have no verified repository/export correspondence. Choose a repository document to inspect its generated C#.'));return;}
  if(!state.workspace.exportsAvailable){container.append(element('p','notice','No generated C# source folder is connected to this project.'));return;}
  if(git.enabled&&state.model.revision?.kind!=='worktree'){container.append(element('p','notice','This is a historical or staged snapshot. The local C# export is not tied to that revision. Switch to the working-tree side to inspect the current export.'));return;}
  container.append(element('p','notice','Export snapshot · matches are scoped to this source filename and DocumentId. Generated code may differ from current XML.'));
  const loading=element('p','muted','Looking up attribute and node-context references…');container.append(loading);
  try{
    const data=await api(`/api/exports?${new URLSearchParams({path:state.model.path,document:state.model.documentId,id:identity})}`);
    if(request!==state.exportRequest || state.tab!=='csharp')return;
    loading.remove();
    if(!data.hits.length)container.append(element('p','muted','No matching attribute or context in this document’s export. This does not prove the element is unused; pins and links may be lowered without attributes, or the export may be older.'));
    for(const hit of data.hits){container.append(element('p','source-label',`${hit.path}:${hit.line} · ${hit.match}`),element('pre','source-code',hit.text.split('\n').map((line,i)=>`${String(hit.startLine+i).padStart(5)}  ${line}`).join('\n')));}
    const owner=state.model.parent.get(selected);
    if(owner?.attrs.Id)container.append(button('Inspect parent element',()=>selectElement(owner.attrs.Id)));
    if(selected!==state.scene.scope)container.append(button('Inspect definition export',()=>selectElement(state.scene.scope.attrs.Id)));
  }catch(error){if(request===state.exportRequest)loading.textContent=error.message;}
}
function renderInspector() {
  const container=$('inspectorContent');container.replaceChildren();state.exportRequest++;
  if(!state.model)return;
  const selected=state.model.byId.get(state.selected)||state.model.byId.get(state.operation)||state.scene.scope,attrs=selected.attrs;
  container.append(element('span','tag',selected.tag),element('h2','',labelOf(selected)));
  if(state.tab==='diff'){renderDiffInspector(container,selected);return;}
  if(state.tab==='xml'){showSource(container,selected);return;}
  if(state.tab==='csharp'){void showExports(container,selected);return;}
  metadata(container,[['Element ID',attrs.Id],['Source line',selected.line||'not recorded'],['Document ID',state.model.documentId]]);
  const reference=referenceOf(selected);
  if(reference){
    heading(container,'Symbol reference');
    metadata(container,[['Category hint',reference.attrs.LastCategoryFullName],['Dependency hint',reference.attrs.LastDependency||reference.attrs.LastSymbolSource]]);
    for(const c of children(reference,'Choice'))container.append(element('p','key-value',`${c.attrs.Kind}: ${c.attrs.Name}`));
    const targets=resolveReference(reference,[...(git.enabled?git.documents:state.catalog),...state.uploads]);
    if(targets.length){
      heading(container,targets.length>1?'Possible source documents':'Referenced source document');
      for(const target of targets)container.append(button(`↗ ${target.path}`,()=>followReference(reference,target),'reference-target'));
    }
  }
  if(attrs.Value!==undefined || attrs.DefaultValue!==undefined){heading(container,'Saved value');metadata(container,[['Pad value',attrs.Value,true],['Pin default',attrs.DefaultValue,true],['Type hint',typeHint(selected)]]);}
  const pins=children(selected,'Pin');
  if(pins.length){
    heading(container,`Pins · ${pins.length}`);
    for(const pin of pins){
      const row=button('',()=>selectElement(pin.attrs.Id),'pin-row');
      const name=element('span');name.append(element('span','pin-direction',(pin.attrs.Kind||'').includes('Input')?'↓':'↑'),document.createTextNode(pin.attrs.Name||pin.attrs.Id));
      row.append(name,element('span','literal',pin.attrs.DefaultValue??typeHint(pin)));row.title=`${pin.attrs.Kind||''} · ${pin.attrs.Id}`;container.append(row);
    }
  }
  if(selected.tag==='Pin'){
    metadata(container,[['Pin kind',attrs.Kind],['Type hint',typeHint(selected)]]);
    const owner=state.model.parent.get(selected);if(owner?.attrs.Id)container.append(button(`Inspect owner: ${labelOf(owner)}`,()=>selectElement(owner.attrs.Id)));
  }
  if(selected.tag==='Link'){
    heading(container,'Connection route');
    for(const id of (attrs.Ids||'').split(','))container.append(button(`${state.model.byId.get(id)?.attrs.Name||state.model.byId.get(id)?.tag||'Missing'} · ${id}`,()=>selectElement(id),'reference-target'));
  }
  const fragments=children(selected,'Patch').flatMap(body=>children(body,'ProcessDefinition')).flatMap(proc=>children(proc,'Fragment'));
  if(fragments.length){
    heading(container,'Process fragments');
    for(const fragment of fragments){const target=state.model.byId.get(fragment.attrs.Patch);container.append(button(`${target?.attrs.Name||fragment.attrs.Patch} · ${fragment.attrs.Enabled||'unspecified'}`,()=>{const op=state.scene.operations.find(op=>op.id===fragment.attrs.Patch);if(op)openScope(state.scope,op.id);else selectElement(fragment.attrs.Patch);},'pin-row'));}
  }
  const participants=(attrs.ParticipatingElements||'').split(',').filter(Boolean);
  if(participants.length){heading(container,'Explicit participants');for(const id of participants)container.append(button(labelOf(state.model.byId.get(id)||{tag:'Missing',attrs:{Name:id}}),()=>selectElement(id),'pin-row'));}
  heading(container,'Saved attributes');
  for(const [key,value] of Object.entries(attrs))if(!['Id','Name'].includes(key))container.append(element('p','key-value',`${key}: ${value}`));
  const incident=state.model.all.filter(e=>e.tag==='Link'&&(e.attrs.Ids||'').split(',').includes(attrs.Id));
  if(incident.length){heading(container,`Incident links · ${incident.length}`);for(const link of incident)container.append(button(`${link.attrs.IsFeedback==='true'?'↶ ':'↳ '}${link.attrs.Id}${link.attrs.IsHidden==='true'?' · hidden':''}`,()=>selectElement(link.attrs.Id),'pin-row'));}
  if(selected.tag==='Node'&&isDefinition(selected)&&state.scope!==attrs.Id)container.append(button('Enter definition →',()=>openScope(attrs.Id)));
}
function setTab(tab) {
  state.tab=tab;
  for(const button of document.querySelectorAll('[data-tab]'))button.setAttribute('aria-pressed',String(button.dataset.tab===tab));
  renderInspector();
}
async function setGitMode(enabled,restore={}) {
  git.enabled=enabled;git.request++;state.load++;
  document.body.classList.toggle('git-mode',enabled);
  $('gitBar').hidden=!enabled;$('gitFiles').hidden=!enabled;$('diffTab').hidden=!enabled;
  $('gitToggle').setAttribute('aria-pressed',String(enabled));
  if(!enabled){
    git.comparison=null;git.diff=null;git.before=null;git.after=null;
    if(state.tab==='diff')setTab('inspect');
    if(restore.reload!==false){if(state.catalog.some(d=>d.path===state.model?.path))await loadDocument(state.model.path,state.scope);else{clearDocument();history.replaceState(null,'',location.pathname+location.search);}}
    return;
  }
  try{
    const menu=await api('/api/git/revisions');if(!git.enabled)return;
    for(const [id,specials] of [['gitBaseOptions',menu.specialRevisions.filter(r=>r.baseAllowed)],['gitTargetOptions',menu.specialRevisions]]){
      const list=$(id);list.replaceChildren();const seen=new Set();
      const add=(value,label)=>{if(seen.has(value))return;seen.add(value);const option=new Option(label,value);list.append(option);};
      for(const revision of specials)add(revision.id,revision.id);
      for(const ref of menu.refs)add(ref.name,`${ref.name} · ${ref.oid.slice(0,8)}`);
      for(const commit of menu.commits)add(commit.oid,`${commit.short} · ${commit.subject}`);
    }
    $('gitBase').value=restore.base||menu.defaults.base;$('gitTarget').value=restore.target||menu.defaults.target;
    setTab('diff');await refreshComparison(restore);
  }catch(error){showError(error.message);$('gitSummary').textContent='Git comparison unavailable';}
}
async function refreshComparison(restore={}) {
  const request=++git.request;state.load++;$('gitCompare').disabled=true;
  try{
    const data=await api(`/api/git/changes?${new URLSearchParams({base:$('gitBase').value.trim(),target:$('gitTarget').value.trim()})}`);
    if(request!==git.request||!git.enabled)return;
    git.base=data.base;git.target=data.target;git.changes=data.changes;git.documents=data.documents;refreshDocuments();
    $('gitResolved').textContent=`${data.base.id.slice(0,8)} → ${data.target.id.slice(0,8)}`;
    renderGitFiles();
    const preferred=restore.file||state.model?.path;
    const entry=git.changes.find(f=>f.path===preferred||f.oldPath===preferred)||git.changes.find(f=>f.status==='modified')||git.changes[0];
    const fallback=git.documents.some(d=>d.path===preferred)?preferred:git.documents[0]?.path;
    if(!entry&&!fallback){clearDocument();$('gitSummary').textContent='No VL documents in these snapshots';return;}
    await loadComparison(entry?.path||fallback,restore.scope||'',restore.operation||'',entry,restore.side||'after');
  }catch(error){showError(error.message);}
  finally{if(request===git.request)$('gitCompare').disabled=false;}
}
function renderGitFiles() {
  $('gitFileCount').textContent=String(git.changes.length);const list=$('gitFileList');list.replaceChildren();
  for(const entry of git.changes){
    const b=button('',()=>loadComparison(entry.path,'','',entry),`git-file${git.file?.path===entry.path?' active':''}`);
    b.title=`${entry.oldPath&&entry.newPath&&entry.oldPath!==entry.newPath?entry.oldPath+' → ':''}${entry.path}${entry.untracked?' · untracked':''}`;
    b.append(element('span',`git-status ${entry.status}`,{added:'A',removed:'D',renamed:'R',modified:'M'}[entry.status]),element('span','',entry.path));
    list.append(b);
  }
  if(!git.changes.length)list.append(element('p','muted','No changed VL files between these snapshots.'));
}
async function loadComparison(path,scope='',operation='',entry=null,side='after') {
  const request=++state.load;
  entry=entry||git.changes.find(f=>f.path===path||f.oldPath===path)||{path,oldPath:path,newPath:path,status:'modified'};
  try{
    const data=await api(`/api/git/compare?${new URLSearchParams({base:git.base?.id||$('gitBase').value,target:git.target?.id||$('gitTarget').value,path,
      oldPath:entry.oldPath||'',newPath:entry.newPath||''})}`);
    if(request!==state.load||!git.enabled)return;
    git.comparison=data;git.file=entry;
    git.before=data.before?.tree?indexDocument(data.before):null;git.after=data.after?.tree?indexDocument(data.after):null;
    recomputeDiff();
    git.side=side==='before'&&git.before?'before':git.after?'after':'before';
    const model=git[git.side]||indexDocument({path,documentId:'unavailable',tree:{tag:'Document',attrs:{Id:'unavailable'},children:[],line:0},source:(data.after||data.before)?.source||'',dependencies:[],warnings:[]});
    if(!scope||!model.byId.has(scope))scope=model.definitions.find(d=>(git.side==='before'?git.diff?.beforeStatus:git.diff?.afterStatus)?.has(d.id))?.id||(git.diff?.records.length?model.documentId:'');
    installModel(model,scope,operation);updateGitSummary();renderGitFiles();
    return true;
  }catch(error){if(request===state.load)showError(error.message);return false;}
}
function recomputeDiff() {
  git.structuralError='';
  if(git.comparison?.before?.parseError||git.comparison?.after?.parseError)git.structuralError=[git.comparison.before?.parseError,git.comparison.after?.parseError].filter(Boolean).join('; ');
  try{git.diff=git.structuralError?null:diffDocuments(git.before,git.after,{ignoreLayout:$('gitIgnoreLayout').checked});}
  catch(error){git.diff=null;git.structuralError=error.message;}
}
function updateGitSummary() {
  const summary=git.diff?.summary;
  $('gitSummary').textContent=summary?`${summary.added} added · ${summary.removed} removed · ${summary.changed} changed elements${summary.layout?` · ${summary.layout} Bounds only`:''}`:'XML diff only · a snapshot could not be structurally compared';
  $('gitBefore').disabled=!git.before;$('gitAfter').disabled=!git.after;
  $('gitBefore').setAttribute('aria-pressed',String(git.side==='before'));$('gitAfter').setAttribute('aria-pressed',String(git.side==='after'));
}
function switchSide(side,scope=state.scope) {
  if(!git[side])return;
  git.side=side;installModel(git[side],scope,state.operation);updateGitSummary();
}
function navigateChange(record,side=null) {
  side=side||(record.status==='removed'?'before':git.after?.byId.has(record.id)?'after':'before');
  const model=git[side];if(!model)return;
  let element=model.byId.get(record.id),scope=null;
  for(let current=element;current;current=model.parent.get(current))if(current.tag==='Node'&&isDefinition(current)){scope=current.attrs.Id;break;}
  switchSide(side,scope||model.documentId);selectElement(record.id);setTab('diff');
}
function removedScene() {
  if(!git.enabled||git.side!=='after'||!$('gitRemoved').checked||!git.before||!git.after||!git.diff||git.diff.identityChanged||!git.before.byId.has(state.scope))return null;
  const scene=buildScene(git.before,state.scope,state.operation);
  const nodes=scene.nodes.filter(n=>!git.after.byId.has(n.id));
  const links=scene.links.filter(l=>!git.after.byId.has(l.id)||git.after.byId.get(l.id).attrs.Ids!==l.element.attrs.Ids);
  return {...scene,nodes,links};
}
function includeRemovedBounds(scene) {
  const removed=removedScene();if(!removed)return;
  const points=[...removed.nodes.flatMap(n=>[{x:n.x,y:n.y},{x:n.x+n.w,y:n.y+n.h}]),...removed.links.flatMap(l=>l.points)];
  if(!points.length)return;
  const b=scene.bounds,x=Math.min(b.x,...points.map(p=>p.x-20)),y=Math.min(b.y,...points.map(p=>p.y-20));
  scene.bounds={x,y,w:Math.max(b.x+b.w,...points.map(p=>p.x+20))-x,h:Math.max(b.y+b.h,...points.map(p=>p.y+20))-y};
}
function drawRemovals(graph) {
  const removed=removedScene();if(!removed)return;
  const layer=svg('g',{class:'removed-ghost diff-removed'});
  for(const link of removed.links){
    if(link.hidden&&!$('showHidden').checked)continue;
    const path=svg('polyline',{points:link.points.map(p=>`${p.x},${p.y}`).join(' '),class:'link'});
    activateSvg(path,link.id,`Removed link ${link.id}`,'before');layer.append(path);
  }
  for(const n of removed.nodes){
    const g=svg('g');g.append(svg('rect',{x:n.x,y:n.y,width:n.w,height:n.h,rx:4,class:n.region?'region-body':'node-body'}));
    g.append(svg('text',{x:n.x+5,y:n.y+Math.min(14,n.h-3),class:'node-text'},`− ${n.label.slice(0,18)}`));
    activateSvg(g,n.id,`Removed ${n.region?'region':'node'} ${n.label}`,'before');layer.append(g);
  }
  graph.append(layer);
}
function renderDiffInspector(container,selected) {
  if(!git.enabled||!git.comparison){container.append(element('p','muted','Choose Git diff to compare repository snapshots.'));return;}
  container.append(element('p','source-label',`${git.comparison.base.label} → ${git.comparison.target.label} · showing ${git.side}`));
  container.append(button(git.raw?'Show graph changes':'Show unified XML diff',()=>{git.raw=!git.raw;renderInspector();}));
  if(git.structuralError)container.append(element('p','notice',git.structuralError));
  if(git.raw){container.append(element('pre','source-code git-text',git.comparison.textDiff||'No line-level XML changes. File paths or line endings may still differ.'));if(git.comparison.textDiffTruncated)container.append(element('p','notice','XML diff truncated at 512,000 characters.'));return;}
  if(git.diff?.identityChanged)container.append(element('p','notice','DocumentId changed. Old and new IDs are not treated as corresponding elements.'));
  const id=selected.attrs.Id;
  const own=git.diff?.records.find(r=>r.id===id&&(git.side==='before'?r.before:r.after));
  if(own){
    heading(container,`${own.status}${own.layoutOnly?' · Bounds only':''}`);
    for(const field of own.fields){
      const box=element('div','diff-field');box.append(element('p','source-label',field.name));
      const pair=element('div','diff-pair');pair.append(element('pre','diff-old',field.before??'∅ not present'),element('pre','diff-new',field.after??'∅ not present'));box.append(pair);container.append(box);
    }
    if(!own.fields.length)container.append(element('p','muted',`Element exists only in the ${own.status==='added'?'target':'base'} snapshot. Inspect or XML shows its saved contents.`));
  }
  const inside=(record)=>{
    for(const [model,element] of [[git.before,record.before],[git.after,record.after]])for(let current=element;current;current=model?.parent.get(current))if(current.attrs.Id===id)return true;
    return false;
  };
  const records=(git.diff?.records||[]).filter(inside);
  heading(container,`Changes in this element / scope · ${records.length}`);
  if(!records.length)container.append(element('p','muted','No structural changes in this element. Select another definition or file; the unified XML diff covers the whole file.'));
  for(const record of records.slice(0,200)){
    const b=button('',()=>navigateChange(record),`change-row diff-${record.status}`);
    b.append(element('span','',`${{added:'+',removed:'−',changed:'~'}[record.status]} ${record.tag} · ${record.label}`),element('small','',record.layoutOnly?'Bounds':record.id));container.append(b);
  }
  if(records.length>200)container.append(element('p','muted',`Showing 200 of ${records.length} records. Enter a definition to narrow the list.`));
}
async function followReference(reference,target) {
  await loadDocument(target.path);
  if(state.model?.path!==target.path)return;
  const choices=children(reference,'Choice');
  const names=choices.filter(c=>['OperationCallFlag','ProcessAppFlag','ProcessNode','OperationNode'].includes(c.attrs.Kind)).map(c=>c.attrs.Name);
  const category=children(reference,'CategoryReference')[0]?.attrs.Name;
  const matches=state.model.definitions.filter(d=>names.includes(d.name)||d.name===category);
  if(matches.length===1)openScope(matches[0].id);
  else if(matches.length>1) {$('definitionSearch').value=names[0]||category||'';renderDefinitions();}
  if(matches.length>1)fileBrowser.showTab('definitions');
}
function showFindings() {
  if(!state.model)return;
  const container=$('findingsContent');container.replaceChildren();
  container.append(element('p','notice','These checks cover XML parsing, duplicate IDs within this document and saved local link/fragment/participation targets. Gamma compilation and execution have not been performed.'));
  if(!state.model.warnings.length)container.append(element('p','muted','No issues found by the checked local-reference rules.'));
  for(const finding of state.model.warnings)container.append(element('p','key-value',`${finding.kind} · ${finding.message}`));
  const paths=state.identities.get(state.model.documentId);
  if(paths?.size>1)container.append(element('p','notice',`Reused DocumentId in opened documents: ${[...paths].join('; ')}. File path and category must disambiguate correspondence.`));
  heading(container,'Dependencies');
  for(const dep of state.model.dependencies)container.append(element('p','key-value',`${dep.Location}${dep.Version?` · ${dep.Version}`:''} (${dep.kind})`));
  heading(container,'Current view');
  container.append(element('p','muted',`${state.scene.unplacedLinks.length} links have endpoints outside this view or without a known position. Unplaced is not the same as dangling. Saved coordinates are preserved; label boxes and inferred pin positions are approximations.`));
  $('findingsDialog').showModal();
}
function zoom(factor,clientX,clientY) {
  if(!state.camera)return;
  const rect=$('graph').getBoundingClientRect(),c=state.camera;
  const px=clientX===undefined ? 0.5 : (clientX-rect.left)/rect.width;
  const py=clientY===undefined ? 0.5 : (clientY-rect.top)/rect.height;
  const w=Math.max(60,Math.min(50000,c.w*factor)),h=w*rect.height/rect.width;
  state.camera={x:c.x+(c.w-w)*px,y:c.y+(c.h-h)*py,w,h};setCamera();
}
let pan=null,panMoved=false;
$('graph').addEventListener('pointerdown',event=>{
  if(event.button!==0)return;panMoved=false;
  pan={x:event.clientX,y:event.clientY,camera:{...state.camera}};
});
window.addEventListener('pointermove',event=>{
  if(!pan||!state.camera)return;
  const rect=$('graph').getBoundingClientRect(),dx=(event.clientX-pan.x)/rect.width*pan.camera.w,dy=(event.clientY-pan.y)/rect.height*pan.camera.h;
  if(Math.abs(event.clientX-pan.x)+Math.abs(event.clientY-pan.y)>4)panMoved=true;
  if(panMoved){state.camera={...pan.camera,x:pan.camera.x-dx,y:pan.camera.y-dy};$('graph').classList.add('panning');setCamera();}
});
window.addEventListener('pointerup',()=>{pan=null;$('graph').classList.remove('panning');});
$('graph').addEventListener('wheel',event=>{event.preventDefault();zoom(event.deltaY>0?1.12:1/1.12,event.clientX,event.clientY);},{passive:false});
$('graph').addEventListener('keydown',event=>{if(event.key.toLowerCase()==='f'){event.preventDefault();fit();}if(event.key==='Escape')selectElement('');if(event.key==='+')zoom(.8);if(event.key==='-')zoom(1.25);});
$('fitButton').addEventListener('click',fit);$('zoomIn').addEventListener('click',()=>zoom(.8));$('zoomOut').addEventListener('click',()=>zoom(1.25));
$('showHidden').addEventListener('change',draw);$('showPins').addEventListener('change',draw);
$('definitionSearch').addEventListener('input',renderDefinitions);
$('operationSelect').addEventListener('change',event=>openScope(state.scope,event.target.value));
$('clearSelection').addEventListener('click',()=>selectElement(state.scope));
$('dismissError').addEventListener('click',()=>{$('error').hidden=true;});
$('aboutButton').addEventListener('click',()=>$('aboutDialog').showModal());
$('findingsButton').addEventListener('click',showFindings);
for(const b of document.querySelectorAll('.dialog-close'))b.addEventListener('click',()=>b.closest('dialog').close());
for(const b of document.querySelectorAll('[data-tab]'))b.addEventListener('click',()=>setTab(b.dataset.tab));
$('gitToggle').addEventListener('click',()=>setGitMode(!git.enabled));
$('gitCompare').addEventListener('click',()=>refreshComparison());
for(const id of ['gitBase','gitTarget'])$(id).addEventListener('keydown',event=>{if(event.key==='Enter')void refreshComparison();});
$('gitBefore').addEventListener('click',()=>switchSide('before'));
$('gitAfter').addEventListener('click',()=>switchSide('after'));
$('gitRemoved').addEventListener('change',()=>{if(state.model)openScope(state.scope,state.operation);});
$('gitIgnoreLayout').addEventListener('change',()=>{recomputeDiff();updateGitSummary();renderDefinitions();draw();renderInspector();});
$('browseToggle').addEventListener('click',()=>{document.body.classList.toggle(innerWidth<600?'mobile-browse':'sidebar-off');requestAnimationFrame(fit);});
$('inspectorToggle').addEventListener('click',()=>{
  const mobile=innerWidth<850;document.body.classList.toggle(mobile?'mobile-details':'inspector-off');
  $('inspectorToggle').setAttribute('aria-pressed',String(mobile?document.body.classList.contains('mobile-details'):!document.body.classList.contains('inspector-off')));requestAnimationFrame(fit);
});
async function openFiles(files) {
  const batch=++state.importBatch,added=[];let oversized=0;
  for(const file of files){
    if(!file.name.toLowerCase().endsWith('.vl'))continue;
    if(file.size>appConfig.maxUploadBytes){oversized++;continue;}
    const relative=file.webkitRelativePath||file.name;
    if(relative.split('/').slice(1,-1).some(part=>part.startsWith('.')||['node_modules','bin','obj','__pycache__','venv'].includes(part.toLowerCase())))continue;
    const item={path:`opened/${batch}/${relative}`,displayPath:relative,name:file.name,file,bytes:file.size,batchLabel:`Import ${batch}`};
    state.uploads.push(item);added.push(item);
  }
  refreshDocuments();
  if(oversized)showError(`${oversized} file(s) exceed this viewer's ${appConfig.maxUploadBytes/(1024*1024)} MB limit and were skipped. Use the desktop app for larger files.`);
  if(!added.length){if(!oversized)showError('No .vl files were found in that selection.');return;}
  if(added.length===1)await loadDocument(added[0].path);
  else fileBrowser.open('opened');
}
$('fileInput').addEventListener('change',event=>{void openFiles(event.target.files);event.target.value='';});
$('folderInput').addEventListener('change',event=>{void openFiles(event.target.files);event.target.value='';});
let dragDepth=0;
document.addEventListener('dragenter',event=>{if([...event.dataTransfer.types].includes('Files')){event.preventDefault();dragDepth++;$('dropOverlay').hidden=false;}});
document.addEventListener('dragover',event=>{if([...event.dataTransfer.types].includes('Files'))event.preventDefault();});
document.addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('dropOverlay').hidden=true;});
document.addEventListener('drop',event=>{event.preventDefault();dragDepth=0;$('dropOverlay').hidden=true;void openFiles(event.dataTransfer.files);});
$('downloadSvg').addEventListener('click',()=>{
  const copy=$('graph').cloneNode(true);copy.setAttribute('xmlns',svgNS);copy.setAttribute('width','1600');copy.setAttribute('height','1000');
  const styles=svg('style',{},[...document.styleSheets[0].cssRules].map(rule=>rule.cssText).join('\n'));copy.prepend(styles);
  const background=copy.querySelector('#graphBackground');background.setAttribute('fill','#10171e');
  const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)],{type:'image/svg+xml'}));
  const link=document.createElement('a');link.href=url;link.download=`${labelOf(state.scene.scope).replace(/[^\w.-]/g,'_')}.svg`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(fit,150);});
function clearDocument(){
  state.model=null;state.scene=null;state.selected='';state.camera=null;state.scope='';state.operation='';
  $('welcome').hidden=false;$('graph').replaceChildren();$('scopeTitle').textContent='Open a VL patch';$('scopeSubtitle').textContent='Choose a file to explore its definitions and connections';
  $('breadcrumbs').replaceChildren();$('scopeKind').textContent='VL';$('graphStats').textContent='No file selected';$('operationNote').hidden=true;
  $('operationSelect').replaceChildren(new Option('All operations',''));$('operationSelect').disabled=true;
  $('definitions').replaceChildren();$('definitionCount').textContent='0';$('inspectorContent').replaceChildren(element('p','muted','Open a patch, then select a node, pin or link to inspect it.'));
  for(const id of ['fitButton','zoomIn','zoomOut','downloadSvg','findingsButton'])$(id).disabled=true;
  refreshDocuments();
}
try {
  appConfig=await api('/api/config');
  $('modeBadge').textContent=connection.repo?'GITHUB · READ ONLY':appConfig.hosted?'WEB · READ ONLY':'LOCAL · READ ONLY';
  $('repositoryInput').value=connection.repo;$('repositoryRef').value=connection.ref;
  $('connectGitHub').textContent=connection.repo?'⑂ '+connection.repo:'Connect GitHub';
  $('privacyNote').textContent=appConfig.hosted?'Opened files are sent to this server for parsing and are not saved. Use the desktop app to keep local files on your computer.':'Local files are parsed on this computer and are not uploaded. GitHub mode reads public repository snapshots.';
  clearDocument();await refreshProject();
  const hash=new URLSearchParams(location.hash.slice(1)),path=hash.get('file');
  if(hash.get('git')==='1'&&state.workspace.gitAvailable)await setGitMode(true,{file:path,scope:hash.get('scope')||'',operation:hash.get('operation')||'',base:hash.get('base'),target:hash.get('target'),side:hash.get('side')||'after'});
  else if(state.catalog.some(doc=>doc.path===path))await loadDocument(path,hash.get('scope')||'',hash.get('operation')||'');
  else if(path){showError('The saved file is not available in this project. Choose a file to continue.');fileBrowser.open('project');}
}catch(error){showError(error.message);}

$('connectGitHub').addEventListener('click',()=>$('repositoryDialog').showModal());
$('repositoryForm').addEventListener('submit',event=>{
  event.preventDefault();
  try{location.assign(viewerURL($('repositoryInput').value,$('repositoryRef').value));}
  catch(error){$('repositoryError').textContent=error.message;}
});
$('localProject').addEventListener('click',()=>location.assign('/viewer'));
