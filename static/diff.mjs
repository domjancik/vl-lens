// Pure snapshot comparison: no Git, filesystem, browser or hosting dependency.
import {labelOf} from './model.mjs';

function ownFields(element) {
  const fields=new Map();
  function visit(current,path='') {
    fields.set(`${path}#tag`,current.tag);
    for(const [key,value] of Object.entries(current.attrs))if(key!=='Id')fields.set(`${path}@${key}`,value);
    if(current.text&&(current.text.trim()||!current.children.length))fields.set(`${path}#text`,current.text);
    const idChildren=current.children.filter(child=>child.attrs.Id);
    if(idChildren.length)fields.set(`${path}#children`,JSON.stringify(idChildren.map(child=>child.attrs.Id)));
    const counts=new Map();
    for(const child of current.children)if(!child.attrs.Id){
      const ordinal=counts.get(child.tag)||0;counts.set(child.tag,ordinal+1);
      visit(child,`${path}${child.tag}[${ordinal}]/`);
    }
  }
  visit(element);return fields;
}
export function diffDocuments(before,after,{ignoreLayout=false}={}) {
  for(const model of [before,after])if(model?.warnings?.some(w=>w.kind==='duplicate-id'))throw new Error('Structural comparison is ambiguous because a document contains duplicate IDs. Use the XML diff.');
  const identityChanged=Boolean(before&&after&&before.documentId!==after.documentId);
  const records=[],beforeStatus=new Map(),afterStatus=new Map();
  function record(id,oldElement,newElement) {
    const status=!oldElement?'added':!newElement?'removed':'changed';
    const fields=[];
    if(oldElement&&newElement){
      const old=ownFields(oldElement),next=ownFields(newElement);
      for(const name of new Set([...old.keys(),...next.keys()]))if(old.get(name)!==next.get(name)){
        if(ignoreLayout&&name==='@Bounds')continue;
        fields.push({name,before:old.get(name)??null,after:next.get(name)??null,kind:name==='@Bounds'?'layout':'data'});
      }
      // Moving an element between regions/operations matters independently of attributes.
      const oldParent=before.parent.get(oldElement)?.attrs.Id||'',nextParent=after.parent.get(newElement)?.attrs.Id||'';
      if(oldParent!==nextParent)fields.push({name:'#parent',before:oldParent,after:nextParent,kind:'data'});
      if(!fields.length)return;
    }
    records.push({id,status,fields,before:oldElement,after:newElement,label:labelOf(newElement||oldElement),tag:(newElement||oldElement).tag,
      layoutOnly:fields.length>0&&fields.every(f=>f.kind==='layout')});
    if(oldElement)beforeStatus.set(id,status);
    if(newElement)afterStatus.set(id,status);
  }
  if(identityChanged){
    for(const [id,e] of before.byId)record(id,e,null);
    for(const [id,e] of after.byId)record(id,null,e);
  }else{
    for(const id of new Set([...(before?.byId.keys()||[]),...(after?.byId.keys()||[])]))record(id,before?.byId.get(id),after?.byId.get(id));
  }
  // Ancestor badges help locate changed pins/links inside large definitions.
  function bubble(model,statuses){
    for(const id of [...statuses.keys()]){
      let parent=model.parent.get(model.byId.get(id));
      while(parent){if(parent.attrs.Id&&!statuses.has(parent.attrs.Id))statuses.set(parent.attrs.Id,'changed');parent=model.parent.get(parent);}
    }
  }
  if(before)bubble(before,beforeStatus);if(after)bubble(after,afterStatus);
  const summary={added:0,removed:0,changed:0,layout:0};
  for(const r of records){summary[r.status]++;if(r.layoutOnly)summary.layout++;}
  return {records,beforeStatus,afterStatus,summary,identityChanged};
}
