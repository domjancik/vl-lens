export class TourProgress {
  constructor(storage){this.storage=storage;this.finished=new Set();}
  seen(kind){
    if(this.finished.has(kind))return true;
    try{return this.storage?.getItem('vl-lens.guidance.v1.'+kind)==='1';}catch{return false;}
  }
  finish(kind){
    this.finished.add(kind);
    try{this.storage?.setItem('vl-lens.guidance.v1.'+kind,'1');}catch{}
  }
}

export function placeGuide(anchor,bounds,size){
  const margin=12,width=Math.min(size.width,bounds.right-bounds.left-2*margin),height=Math.min(size.height,bounds.bottom-bounds.top-2*margin);
  const clamp=(n,min,max)=>Math.max(min,Math.min(n,max));
  let left=clamp(anchor.left,bounds.left+margin,bounds.right-width-margin),top,side;
  if(anchor.bottom+margin+height<=bounds.bottom-margin){top=anchor.bottom+margin;side='below';}
  else if(anchor.top-margin-height>=bounds.top+margin){top=anchor.top-margin-height;side='above';}
  else if(anchor.right+margin+width<=bounds.right-margin){left=anchor.right+margin;top=(anchor.top+anchor.bottom-height)/2;side='right';}
  else if(anchor.left-margin-width>=bounds.left+margin){left=anchor.left-margin-width;top=(anchor.top+anchor.bottom-height)/2;side='left';}
  else{top=anchor.bottom+margin;side='below';}
  return {left,top:clamp(top,bounds.top+margin,bounds.bottom-height-margin),width,height,side};
}
