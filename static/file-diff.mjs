const node=(tag,cls='',text='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
const bytes=n=>new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(n>=1048576?n/1048576:n>=1024?n/1024:n)+(n>=1048576?' MB':n>=1024?' KB':' bytes');

export function renderFileDiff(container,data,view,onView){
  container.replaceChildren();
  const nav=node('div','file-diff-nav');
  for(const [id,title]of (data.kind==='text'?[['diff','Unified diff'],['before','Before'],['after','After']]:[['diff','File metadata']])){
    const b=node('button','',title);b.type='button';b.setAttribute('aria-pressed',String(view===id));
    b.disabled=id!=='diff'&&!data[id];b.addEventListener('click',()=>onView(id));nav.append(b);
  }
  if(data.kind==='text'){
    const wrap=node('button','','Wrap lines');wrap.type='button';
    wrap.setAttribute('aria-pressed',String(container.classList.contains('wrap-lines')));
    wrap.addEventListener('click',()=>{container.classList.toggle('wrap-lines');renderFileDiff(container,data,view,onView);});nav.append(wrap);
  }
  const stats=node('span','file-diff-stats');
  stats.textContent=data.kind==='text'?('+'+data.lineStats.added+'  −'+data.lineStats.removed+(data.textDiffTruncated?' · partial preview':'')):data.kind==='binary'?'Binary file':'File metadata';
  nav.append(stats);container.append(nav);
  const scroll=node('div','file-diff-scroll');container.append(scroll);
  if(data.oldPath&&data.newPath&&data.oldPath!==data.newPath)scroll.append(node('p','file-diff-notice','Renamed: '+data.oldPath+' → '+data.newPath));
  if([data.before,data.after].some(s=>s?.kind==='symlink'))scroll.append(node('p','file-diff-notice','Symbolic link targets are shown as text. Links are not followed.'));
  if(data.kind!=='text'){
    scroll.append(node('div','file-diff-binary-symbol',data.kind==='binary'?'◈':'▱'));
    scroll.append(node('h2','',data.kind==='binary'?'Binary file comparison':'File content is not available as text'));
    scroll.append(node('p','file-diff-notice',data.identical?'Content is identical.':'Compare the saved sizes and object identities below.'));
    const cards=node('div','file-snapshot-cards');
    for(const side of ['before','after']){
      const snapshot=data[side],card=node('section','file-snapshot-card');
      card.append(node('h3','',side==='before'?'A · Before':'B · After'));
      if(!snapshot)card.append(node('p','','File does not exist in this snapshot.'));
      else{
        const items=[['Path',snapshot.path],['Size',bytes(snapshot.bytes||0)],['Type',snapshot.kind],['Git object',snapshot.oid],['SHA-256',snapshot.sha256]];
        for(const [label,value]of items)if(value!==undefined){card.append(node('small','',label),node('code','',String(value)));}
        if(snapshot.message)card.append(node('p','file-diff-notice',snapshot.message));
      }
      cards.append(card);
    }
    scroll.append(cards);return;
  }
  if(data.textDiffTruncated)scroll.append(node('p','file-diff-notice','Partial preview: source views are limited to 128,000 characters per file; the diff is limited to 6,000 rows. Changes beyond these limits are not shown.'));
  const info=node('div','file-diff-encoding');
  for(const side of ['before','after'])if(data[side]){
    const s=data[side];info.append(node('span','',(side==='before'?'Before':'After')+': '+bytes(s.bytes||0)+' · '+(s.encoding||'UTF-8')+' · '+(s.newline||'none')+(s.endsWithNewline===false?' · no final newline':'')));
  }
  scroll.append(info);
  const table=node('table','file-diff-table'),body=node('tbody');
  if(view==='diff'){
    if(!data.lines.length)scroll.append(node('p','file-diff-empty',data.identical?'No content changes.':!data.before?'Empty file added.':!data.after?'Empty file removed.':'No line changes in this preview. Encoding or line endings may differ.'));
    for(const line of data.lines){
      const row=node('tr','line-'+line.kind);
      if(line.kind==='hunk'){const cell=node('td','file-hunk',line.text);cell.colSpan=4;row.append(cell);}
      else row.append(node('td','file-line-number',line.oldLine??''),node('td','file-line-number',line.newLine??''),node('td','file-line-sign',line.kind==='add'?'+':line.kind==='remove'?'−':' '),node('td','file-line-content',line.text||' '));
      body.append(row);
    }
  }else{
    const snapshot=data[view],lines=(snapshot?.source||'').split(/\r\n|\r|\n/);
    for(const [index,text]of lines.slice(0,6000).entries()){
      const row=node('tr','line-context');row.append(node('td','file-line-number',index+1),node('td','file-line-content',text||' '));body.append(row);
    }
    if(lines.length>6000)scroll.append(node('p','file-diff-notice','Source view limited to 6,000 lines.'));
  }
  table.append(body);scroll.append(table);
}
