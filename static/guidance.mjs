import {TourProgress,placeGuide} from './guidance-model.mjs';

const $=id=>document.getElementById(id);
const steps={
  viewer:[
    {target:'#connectGitHub',title:'Start with your files',text:'Connect a public GitHub repository here. Open… adds local VL files or a folder. In the desktop app, use File → Open project folder to browse a local Git project.'},
    {target:'#quickOpenButton',title:'Find any file quickly',text:'Browse files opens the file picker. Search a name or path, or press Ctrl+P (Cmd+P on Mac). In Git mode, the picker includes every file type.'},
    {target:'.graph-panel',title:'Explore the patch and its details',text:'For VL files, choose a definition, drag to pan, and scroll to zoom. Click a node or wire to inspect it on the right. Other Git files open as text or metadata comparisons.'},
    {target:'#gitHistoryButton',title:'Choose what changed',text:'History shows branches and commits. Choose A for the before snapshot and B for the after snapshot, then Compare range. A short range guide appears the first time you open it. Replay either tour from Help.',history:true}
  ],
  range:[
    {target:'#historyRefs',title:'Find the branch you want',text:'Click a branch name to browse its commits. The small A and B buttons beside a branch select that branch’s tip as a snapshot.'},
    {target:'#historyBase',title:'A is your starting point',text:'Base means Before. Select A here, then click a commit in the graph. You can also click the A button beside any commit or branch.'},
    {target:'#historyTarget',title:'B is your ending point',text:'Target means After. Select B here, then choose a commit, or use its B button. The highlighted range shows the loaded commits between your selections.'},
    {target:'#historyApply',title:'Apply your selected range',text:'Compare range applies A → B and updates the changed-file list and diff. Latest commit fills in a commit and its first parent. For local Git, use the staged or working-tree presets.'}
  ],
  connect:[
    {target:'#connectGitHub',title:'Connect a Git repository first',text:'Connect a public GitHub repository here, or open a local Git project in the desktop app. History becomes available when a Git repository is connected.'}
  ]
};

export function createGuidance(){
  const loopback=['127.0.0.1','localhost'].includes(location.hostname);
  const storage={
    getItem(key){
      try{if(localStorage.getItem(key)==='1')return '1';}catch{}
      // Cookies persist across the desktop application's random loopback ports.
      if(loopback)try{return document.cookie.split('; ').find(v=>v.startsWith(encodeURIComponent(key)+'='))?.split('=')[1];}catch{}
      return null;
    },
    setItem(key,value){
      try{localStorage.setItem(key,value);}catch{}
      if(loopback)try{document.cookie=encodeURIComponent(key)+'='+value+'; Path=/; Max-Age=31536000; SameSite=Strict';}catch{}
    }
  };
  const progress=new TourProgress(storage);
  let kind=null,index=0,card=null,previous=null,requestedRange=false,frame=0;
  const element=(tag,cls,text='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;};
  function action(text,callback,cls=''){const b=element('button',cls,text);b.type='button';b.addEventListener('click',callback);return b;}
  function bounds(){
    const view={left:0,top:0,right:innerWidth,bottom:innerHeight};
    if(kind!=='range')return view;
    const r=$('gitHistory').getBoundingClientRect();
    return {left:Math.max(0,r.left),top:Math.max(0,r.top),right:Math.min(innerWidth,r.right),bottom:Math.min(innerHeight,r.bottom)};
  }
  function position(){
    if(!card||!kind)return;
    const target=document.querySelector(steps[kind][index].target);
    if(!target)return;
    const area=bounds();card.style.maxHeight=Math.max(140,area.bottom-area.top-24)+'px';
    const width=Math.min(350,area.right-area.left-24);card.style.width=width+'px';
    const anchor=target.getBoundingClientRect(),box=placeGuide(anchor,area,{width,height:card.offsetHeight});
    card.style.left=box.left+'px';card.style.top=box.top+'px';card.dataset.placement=box.side;
    card.style.setProperty('--guide-arrow-x',Math.max(18,Math.min(box.width-18,(anchor.left+anchor.right)/2-box.left))+'px');
  }
  function stop(remember=true){
    if(remember&&kind&&kind!=='connect')progress.finish(kind);
    document.querySelectorAll('.guide-target').forEach(e=>e.classList.remove('guide-target'));
    card?.remove();card=null;kind=null;
    if(previous?.isConnected)previous.focus({preventScroll:true});
  }
  function render(){
    document.querySelectorAll('.guide-target').forEach(e=>e.classList.remove('guide-target'));
    const step=steps[kind][index],target=document.querySelector(step.target);
    target?.classList.add('guide-target');
    card?.remove();card=element('section','guide-card');
    card.setAttribute('role','dialog');card.setAttribute('aria-label',kind==='range'?'Diff range guide':'Viewer quick tour');card.tabIndex=-1;
    const head=element('div','guide-card-heading');
    head.append(element('span','',((kind==='range'?'DIFF RANGE':'QUICK TOUR')+' · '+(index+1)+' OF '+steps[kind].length)));
    const close=action('×',()=>stop(true),'guide-close');close.setAttribute('aria-label','Close quick tour');head.append(close);
    const title=element('h3','',step.title),text=element('p','',step.text);title.id='guideTitle';text.id='guideDescription';
    card.setAttribute('aria-labelledby',title.id);card.setAttribute('aria-describedby',text.id);
    card.append(head,title,text);
    if(step.history&&!$('gitHistoryButton').disabled)card.append(action('Show range selection ↗',()=>{stop(true);requestRange();},'guide-open-history'));
    const footer=element('div','guide-card-actions');
    footer.append(action('Skip tour',()=>stop(true),'guide-skip'));
    const back=action('Back',()=>{index--;render();});back.disabled=index===0;footer.append(back);
    footer.append(action(index===steps[kind].length-1?'Got it':'Next',()=>{if(index===steps[kind].length-1)stop(true);else{index++;render();}},'guide-next'));
    card.append(footer);
    (kind==='range'?$('gitHistory'):document.body).append(card);
    position();card.focus({preventScroll:true});
    card.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();stop(true);}});
  }
  function start(which){
    if(kind)stop(false);
    $('helpMenu').open=false;
    previous=document.activeElement;kind=which;index=0;render();
  }
  function requestRange(){
    if($('gitHistoryButton').disabled){start('connect');return;}
    requestedRange=true;
    if($('gitHistory').open&&document.querySelector('.history-commit')){requestedRange=false;start('range');}
    else $('gitHistoryButton').click();
  }
  $('tourButton').addEventListener('click',()=>start('viewer'));
  $('rangeTourButton').addEventListener('click',()=>{$('helpMenu').open=false;requestRange();});
  $('historyGuideButton').addEventListener('click',()=>start('range'));
  $('gitHistory').addEventListener('historyready',()=>{
    if(requestedRange||!progress.seen('range')){
      requestedRange=false;
      if(kind==='viewer')stop(true);
      start('range');
    }
  });
  $('gitHistory').addEventListener('close',()=>{requestedRange=false;if(kind==='range')stop(true);});
  $('gitHistory').addEventListener('cancel',event=>{if(kind==='range'){event.preventDefault();stop(true);}});
  function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;position();});}
  window.addEventListener('resize',schedule);document.addEventListener('scroll',schedule,true);
  return {offer(){
    if($('gitHistory').open&&document.querySelector('.history-commit')&&!progress.seen('range')){start('range');return;}
    if(!progress.seen('viewer')&&!document.querySelector('dialog[open]')&&!document.activeElement?.matches('input,textarea,[contenteditable=true]'))start('viewer');
  }};
}
