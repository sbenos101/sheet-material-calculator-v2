<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>

<script>

const tooltipBubble = document.getElementById('tooltip-bubble');
let tooltipHideTimer = null;

function showTooltip(el, tip) {
  clearTimeout(tooltipHideTimer);
  tooltipBubble.textContent = tip;
  tooltipBubble.style.display = 'block';
  positionTooltip(el);
}

function positionTooltip(el) {
  const rect = el.getBoundingClientRect();
  const bw = tooltipBubble.offsetWidth || 210;
  const bh = tooltipBubble.offsetHeight || 60;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const PAD = 8;

  const useVertical = vw < 600;

  let left, top;

  if (useVertical) {
    left = rect.left + rect.width / 2 - bw / 2;
    left = Math.min(Math.max(left, PAD), vw - bw - PAD);

    if (rect.top >= bh + PAD + 4) {
      top = rect.top - bh - 8;
    } else {
      top = rect.bottom + 8;
    }
  } else {
    left = rect.right + 10;
    if (left + bw > vw - PAD) left = rect.left - bw - 10;
    top = rect.top + rect.height / 2 - bh / 2;
  }

  top = Math.max(PAD, Math.min(vh - bh - PAD, top));
  tooltipBubble.style.left = left + 'px';
  tooltipBubble.style.top  = top + 'px';
}

function hideTooltip() {
  tooltipHideTimer = setTimeout(() => { tooltipBubble.style.display = 'none'; }, 120);
}

function initTooltips(root) {
  root = root || document;
  root.querySelectorAll('.tooltip-wrap[data-tip]').forEach(wrap => {
    const tip = wrap.dataset.tip;
    wrap.addEventListener('mouseenter', () => showTooltip(wrap, tip));
    wrap.addEventListener('mouseleave', hideTooltip);
    wrap.addEventListener('touchstart', e => {
      e.preventDefault();
      e.stopPropagation();
      if (tooltipBubble.style.display === 'block' && tooltipBubble.textContent === tip) {
        hideTooltip();
      } else {
        showTooltip(wrap, tip);
      }
    }, { passive: false });
  });
}

document.addEventListener('touchstart', e => {
  if (!e.target.closest('.tooltip-wrap')) hideTooltip();
}, { passive: true });

initTooltips();

function applyStepperTabIndex() {
  document.querySelectorAll('.num-step').forEach(btn => { btn.tabIndex = -1; });
}
applyStepperTabIndex();

document.querySelector('.sidebar').addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const allInputs = [...document.querySelectorAll('.sidebar input.inp, .sidebar select.inp')];
  const idx = allInputs.indexOf(document.activeElement);
  if (idx === -1) return;
  e.preventDefault();
  const next = e.shiftKey
    ? allInputs[idx - 1] ?? allInputs[allInputs.length - 1]
    : allInputs[idx + 1] ?? allInputs[0];
  next.focus();
  next.select && next.select();
});

let cuttingMode = '2d';
let lastSolution = null;
let selectedSheetId = null;
let lastAvailable = [];
let lastStats = null;

const EPS = 1e-5;
const view = { scale:1, offsetX:0, offsetY:0, isPanning:false, mouseDown:false, startX:0, startY:0, downClientX:0, downClientY:0 };

const PALETTE = [
  '#009845','#2563eb','#d97706','#7c3aed','#dc2626','#0891b2','#65a30d','#ea580c',
  '#db2777','#0d9488','#4f46e5','#b45309','#0284c7','#84cc16','#f97316','#a21caf'
];
const labelColorMap = new Map();
function getColor(base) {
  if (!labelColorMap.has(base)) labelColorMap.set(base, PALETTE[labelColorMap.size % PALETTE.length]);
  return labelColorMap.get(base);
}

function getUnit() { return document.getElementById('unit-type')?.value || 'mm'; }
function mmFactor() { const u=getUnit(); if(u==='in')return 1/25.4; if(u==='cm')return 1/10; return 1; }
function fromMM(v) { return v * mmFactor(); }
function unitLabel() { const u=getUnit(); if(u==='in')return 'in'; if(u==='cm')return 'cm'; return 'mm'; }
function fmtLen(mm) {
  if(!Number.isFinite(mm))return '—';
  const u=getUnit(),v=fromMM(mm);
  let dp; if(u==='in')dp=3; else if(u==='cm')dp=2; else dp=1;
  return Number(v.toFixed(dp))+'\u202f'+u;
}
function fmtArea(mm2) {
  if(!Number.isFinite(mm2))return '—';
  const u=getUnit(); let factor,suffix;
  if(u==='in'){factor=1/(25.4*25.4);suffix='in²';}
  else if(u==='cm'){factor=1/100;suffix='cm²';}
  else{factor=1e-6;suffix='m²';}
  const dp=u==='mm'?4:2;
  return Number((mm2*factor).toFixed(dp))+'\u202f'+suffix;
}
function fmtPct(v) { return Number(v.toFixed(1))+'%'; }
function dispDp() { const u=getUnit(); if(u==='in')return 3; if(u==='cm')return 2; return 1; }
function dispStep() { const u=getUnit(); if(u==='in')return 0.001; if(u==='cm')return 0.1; return 1; }
function mmToDisp(mm) { return +(mm*mmFactor()).toFixed(dispDp()); }

function markDimInput(el) {
  if(!el.dataset.mm) el.dataset.mm = parseFloat(el.value)||0;
  el.addEventListener('input', () => {
    const v=parseFloat(el.value)||0; el.dataset.mm = v/mmFactor();
  });
}

function updateUnitLabels() {
  const u=unitLabel(), step=dispStep();
  document.querySelectorAll('.avail-w-label,.avail-h-label,.req-w-label,.req-h-label').forEach(el=>{
    el.textContent=el.dataset.base+' ('+u+')';
  });
  document.querySelectorAll('input[data-mm]').forEach(el=>{
    const mm=parseFloat(el.dataset.mm)||0;
    el.value=mmToDisp(mm); el.step=step;
  });
}

function initUnitConvFields() {
  ['blade-thickness','blade-offset'].forEach(id=>{
    const el=document.getElementById(id); if(el) markDimInput(el);
  });
}

function makeAvailRow(w='2440',h='1220',q='1',removable=false) {
  const wMM=parseFloat(w)||0, hMM=parseFloat(h)||0;
  const dispW=wMM?mmToDisp(wMM):'', dispH=hMM?mmToDisp(hMM):'';
  const step=dispStep(), u=unitLabel();
  const div=document.createElement('div'); div.className='sheet-row';
  div.innerHTML=`
    <div class="field">
      <div class="field-label"><span class="avail-w-label" data-base="Length">Length (${u})</span></div>
      <div class="num-wrap">
        <input class="inp avail-w" type="number" min="0" step="${step}" value="${dispW}" data-mm="${wMM}">
        <div class="num-steppers"><button class="num-step" type="button">▲</button><button class="num-step" type="button">▼</button></div>
      </div>
    </div>
    <div class="field">
      <div class="field-label"><span class="avail-h-label" data-base="Width">Width (${u})</span></div>
      <div class="num-wrap">
        <input class="inp avail-h" type="number" min="0" step="${step}" value="${dispH}" data-mm="${hMM}">
        <div class="num-steppers"><button class="num-step" type="button">▲</button><button class="num-step" type="button">▼</button></div>
      </div>
    </div>
    <div class="field">
      <div class="field-label">Qty</div>
      <div class="num-wrap">
        <input class="inp avail-q" type="number" min="1" step="1" value="${q}">
        <div class="num-steppers"><button class="num-step" type="button">▲</button><button class="num-step" type="button">▼</button></div>
      </div>
    </div>
    <button class="btn-remove" type="button" title="Remove" ${removable?'':'disabled'}>×</button>
  `;
  markDimInput(div.querySelector('.avail-w'));
  markDimInput(div.querySelector('.avail-h'));
  div.querySelectorAll('.num-wrap').forEach(wrap=>{
    const inp=wrap.querySelector('input');
    const [up,dn]=wrap.querySelectorAll('.num-step');
    up.addEventListener('click',()=>{inp.value=Math.max(parseFloat(inp.min)||0,(parseFloat(inp.value)||0)+(parseFloat(inp.step)||1));inp.dispatchEvent(new Event('input'));});
    dn.addEventListener('click',()=>{inp.value=Math.max(parseFloat(inp.min)||0,(parseFloat(inp.value)||0)-(parseFloat(inp.step)||1));inp.dispatchEvent(new Event('input'));});
  });
  div.querySelector('.btn-remove').addEventListener('click',()=>{div.remove();render();});
  div.querySelectorAll('.inp').forEach(el=>el.addEventListener('input',render));
  return div;
}

function makeReqRow(w='',h='',q='1',removable=false) {
  const wMM=parseFloat(w)||0, hMM=parseFloat(h)||0;
  const dispW=wMM?mmToDisp(wMM):'', dispH=hMM?mmToDisp(hMM):'';
  const step=dispStep(), u=unitLabel();
  const div=document.createElement('div'); div.className='sheet-row';
  div.innerHTML=`
    <div class="field">
      <div class="field-label"><span class="req-w-label" data-base="Length">Length (${u})</span></div>
      <div class="num-wrap">
        <input class="inp req-w" type="number" min="0" step="${step}" value="${dispW}" data-mm="${wMM}" placeholder="0">
        <div class="num-steppers"><button class="num-step" type="button">▲</button><button class="num-step" type="button">▼</button></div>
      </div>
    </div>
    <div class="field">
      <div class="field-label"><span class="req-h-label" data-base="Width">Width (${u})</span></div>
      <div class="num-wrap">
        <input class="inp req-h" type="number" min="0" step="${step}" value="${dispH}" data-mm="${hMM}" placeholder="0">
        <div class="num-steppers"><button class="num-step" type="button">▲</button><button class="num-step" type="button">▼</button></div>
      </div>
    </div>
    <div class="field">
      <div class="field-label">Qty</div>
      <div class="num-wrap">
        <input class="inp req-q" type="number" min="1" step="1" value="${q}">
        <div class="num-steppers"><button class="num-step" type="button">▲</button><button class="num-step" type="button">▼</button></div>
      </div>
    </div>
    <button class="btn-remove" type="button" title="Remove" ${removable?'':'disabled'}>×</button>
  `;
  markDimInput(div.querySelector('.req-w'));
  markDimInput(div.querySelector('.req-h'));
  div.querySelectorAll('.num-wrap').forEach(wrap=>{
    const inp=wrap.querySelector('input');
    const [up,dn]=wrap.querySelectorAll('.num-step');
    up.addEventListener('click',()=>{inp.value=Math.max(parseFloat(inp.min)||0,(parseFloat(inp.value)||0)+(parseFloat(inp.step)||1));inp.dispatchEvent(new Event('input'));});
    dn.addEventListener('click',()=>{inp.value=Math.max(parseFloat(inp.min)||0,(parseFloat(inp.value)||0)-(parseFloat(inp.step)||1));inp.dispatchEvent(new Event('input'));});
  });
  div.querySelector('.btn-remove').addEventListener('click',()=>{div.remove();render();});
  div.querySelectorAll('.inp').forEach(el=>el.addEventListener('input',render));
  return div;
}

document.getElementById('available-rows').appendChild(makeAvailRow('2440','1220','1',false));
document.getElementById('required-rows').appendChild(makeReqRow('','','1',false));

document.getElementById('add-available').addEventListener('click',()=>{
  const row=makeAvailRow('','','1',true);
  document.getElementById('available-rows').appendChild(row);
  applyStepperTabIndex();
  row.querySelector('.avail-w').focus();
});
document.getElementById('add-required').addEventListener('click',()=>{
  const row=makeReqRow('','','1',true);
  document.getElementById('required-rows').appendChild(row);
  applyStepperTabIndex();
  row.querySelector('.req-w').focus();
});

document.querySelectorAll('.num-step[data-target]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const el=document.getElementById(btn.dataset.target); if(!el)return;
    const step=parseFloat(el.step)||0.1, dir=parseFloat(btn.dataset.dir);
    el.value=Math.max(parseFloat(el.min)||0,parseFloat((parseFloat(el.value)||0)+dir*step).toFixed(2));
    el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));
  });
});

['blade-thickness','blade-offset','allow-rotate'].forEach(id=>{
  document.getElementById(id)?.addEventListener('change',render);
  document.getElementById(id)?.addEventListener('input',render);
});

document.getElementById('unit-type').addEventListener('change',()=>{updateUnitLabels();render();});

document.querySelectorAll('.mode-tab').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.mode-tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    cuttingMode=btn.dataset.mode;
    document.getElementById('linear-info').classList.toggle('visible', cuttingMode==='linear');
    document.getElementById('guillotine-info').classList.toggle('visible', cuttingMode==='guillotine');
    labelColorMap.clear(); render();
  });
});

function readAvailable() {
  return [...document.querySelectorAll('#available-rows .sheet-row')].flatMap(r=>{
    const wEl=r.querySelector('.avail-w'),hEl=r.querySelector('.avail-h');
    const w=parseFloat(wEl.dataset.mm)||0, h=parseFloat(hEl.dataset.mm)||0;
    const q=Math.max(1,Math.floor(Number(r.querySelector('.avail-q').value)));
    if(w>0&&h>0)return[{width:w,height:h,quantity:q}]; return[];
  });
}

function readRequired() {
  return [...document.querySelectorAll('#required-rows .sheet-row')].flatMap(r=>{
    const wEl=r.querySelector('.req-w'),hEl=r.querySelector('.req-h');
    const w=parseFloat(wEl.dataset.mm)||0, h=parseFloat(hEl.dataset.mm)||0;
    const q=Math.max(1,Math.floor(Number(r.querySelector('.req-q').value)));
    if(w>0&&h>0){const label=`${fmtLen(w)} × ${fmtLen(h)}`;return[{width:w,height:h,quantity:q,label}];}
    return[];
  });
}

function getKerf()  { const el=document.getElementById('blade-thickness'); return Math.max(0,parseFloat(el.dataset.mm??el.value)||0); }
function getEdge()  { const el=document.getElementById('blade-offset');    return Math.max(0,parseFloat(el.dataset.mm??el.value)||0); }
function getAllowRotate() { return document.getElementById('allow-rotate').checked; }

function innerDims(sheet,edge){edge=edge||0;return{x0:edge,y0:edge,W:Math.max(0,sheet.width-2*edge),H:Math.max(0,sheet.height-2*edge)};}

class MaxRectsBin {
  constructor(W,H,kerf,edge){
    this.W=W;this.H=H;this.kerf=kerf;this.edge=edge;
    const{x0,y0,W:iW,H:iH}=innerDims({width:W,height:H},edge);
    const hk=kerf/2;
    this.free=(iW>0&&iH>0)?[{x:x0-hk,y:y0-hk,w:iW+kerf,h:iH+kerf}]:[];
    this.used=[];this.gu=[];
  }
  _contact(x,y,w,h){
    let s=0;const e=this.edge,sw=this.W-e,sh=this.H-e;
    if(Math.abs(x-e)<EPS)s+=h;if(Math.abs(y-e)<EPS)s+=w;
    if(Math.abs(x+w-sw)<EPS)s+=h;if(Math.abs(y+h-sh)<EPS)s+=w;
    for(const u of this.gu){
      if(Math.abs(u.x+u.w-x)<EPS&&!(u.y>=y+h||y>=u.y+u.h))s+=h;
      if(Math.abs(x+w-u.x)<EPS&&!(u.y>=y+h||y>=u.y+u.h))s+=h;
      if(Math.abs(u.y+u.h-y)<EPS&&!(u.x>=x+w||x>=u.x+u.w))s+=w;
      if(Math.abs(y+h-u.y)<EPS&&!(u.x>=x+w||x>=u.x+u.w))s+=w;
    }
    return s;
  }
  _findNode(w,h,rotate){
    let best=null;
    const consider=(fr,rw,rh,rot)=>{
      if(rw>fr.w+EPS||rh>fr.h+EPS)return;
      const score=[-this._contact(fr.x,fr.y,rw,rh),fr.w*fr.h-rw*rh,fr.y,fr.x];
      const cand={x:fr.x,y:fr.y,w:rw,h:rh,rotated:rot,score};
      if(!best){best=cand;return;}
      for(let i=0;i<score.length;i++){
        if(score[i]<best.score[i]-EPS){best=cand;return;}
        if(score[i]>best.score[i]+EPS)return;
      }
    };
    for(const fr of this.free){consider(fr,w,h,false);if(rotate)consider(fr,h,w,true);}
    return best;
  }
  insert(w,h,label,base,origW,origH,rotate){
    const node=this._findNode(w+this.kerf,h+this.kerf,rotate);
    if(!node)return false;
    const{x:gx,y:gy,w:gw,h:gh}=node;
    this.gu.push({x:gx,y:gy,w:gw,h:gh});
    this._place({x:gx,y:gy,w:gw,h:gh});
    const hk=this.kerf/2;
    const pw=node.rotated?origH:origW,ph=node.rotated?origW:origH;
    this.used.push({x:gx+hk,y:gy+hk,w:pw,h:ph,label,base,rotated:node.rotated});
    return true;
  }
  insertForced(w,h,label,base,origW,origH,forceRotated){
    const node=this._findNode(w+this.kerf,h+this.kerf,false);
    if(!node)return false;
    const{x:gx,y:gy}=node;
    this.gu.push({x:gx,y:gy,w:node.w,h:node.h});
    this._place({x:gx,y:gy,w:node.w,h:node.h});
    const hk=this.kerf/2;
    this.used.push({x:gx+hk,y:gy+hk,w:w,h:h,label,base,rotated:forceRotated});
    return true;
  }
  _place(used){
    let i=0;
    while(i<this.free.length){if(!this._split(this.free[i],used))i++;else this.free.splice(i,1);}
    this._prune();this._merge();
  }
  _split(fr,u){
    const x1=u.x,y1=u.y,x2=u.x+u.w,y2=u.y+u.h,fx1=fr.x,fy1=fr.y,fx2=fr.x+fr.w,fy2=fr.y+fr.h;
    if(x2<=fx1+EPS||x1>=fx2-EPS||y2<=fy1+EPS||y1>=fy2-EPS)return false;
    if(x1>fx1+EPS)this.free.push({x:fx1,y:fy1,w:x1-fx1,h:fr.h});
    if(x2<fx2-EPS)this.free.push({x:x2,y:fy1,w:fx2-x2,h:fr.h});
    const ox1=Math.max(fx1,x1),ox2=Math.min(fx2,x2);
    if(y1>fy1+EPS)this.free.push({x:ox1,y:fy1,w:Math.max(0,ox2-ox1),h:y1-fy1});
    if(y2<fy2-EPS)this.free.push({x:ox1,y:y2,w:Math.max(0,ox2-ox1),h:fy2-y2});
    return true;
  }
  _prune(){
    this.free=this.free.filter(r=>r.w>EPS&&r.h>EPS);
    for(let i=0;i<this.free.length;i++)for(let j=i+1;j<this.free.length;j++){
      const a=this.free[i],b=this.free[j];if(!a||!b)continue;
      if(a.x>=b.x-EPS&&a.y>=b.y-EPS&&a.x+a.w<=b.x+b.w+EPS&&a.y+a.h<=b.y+b.h+EPS){this.free.splice(i,1);i--;break;}
      if(b.x>=a.x-EPS&&b.y>=a.y-EPS&&b.x+b.w<=a.x+a.w+EPS&&b.y+b.h<=a.y+a.h+EPS){this.free.splice(j,1);j--;}
    }
  }
  _merge(){
    let merged=true;
    while(merged){merged=false;
      for(let i=0;i<this.free.length;i++)for(let j=i+1;j<this.free.length;j++){
        const a=this.free[i],b=this.free[j];
        if(Math.abs(a.y-b.y)<EPS&&Math.abs(a.h-b.h)<EPS){
          if(Math.abs(a.x+a.w-b.x)<EPS){this.free[i]={x:a.x,y:a.y,w:a.w+b.w,h:a.h};this.free.splice(j,1);merged=true;break;}
          if(Math.abs(b.x+b.w-a.x)<EPS){this.free[i]={x:b.x,y:b.y,w:b.w+a.w,h:a.h};this.free.splice(j,1);merged=true;break;}
        }
        if(Math.abs(a.x-b.x)<EPS&&Math.abs(a.w-b.w)<EPS){
          if(Math.abs(a.y+a.h-b.y)<EPS){this.free[i]={x:a.x,y:a.y,w:a.w,h:a.h+b.h};this.free.splice(j,1);merged=true;break;}
          if(Math.abs(b.y+b.h-a.y)<EPS){this.free[i]={x:b.x,y:b.y,w:a.w,h:b.h+a.h};this.free.splice(j,1);merged=true;break;}
        }
      }
    }
  }
}

function solveLinear(available,items,kerf,edge,rotate){
  const pool=[];available.forEach(s=>{for(let i=0;i<s.quantity;i++)pool.push({width:s.width,height:s.height});});
  let remaining=items.flatMap(it=>{const arr=[];for(let i=0;i<it.quantity;i++)arr.push({...it,label:it.quantity>1?`${it.label} #${i+1}`:it.label,base:it.label});return arr;});
  remaining.sort((a,b)=>b.width*b.height-a.width*a.height);
  const sheets=[];let sheetId=1;
  for(const sheet of pool){
    if(remaining.length===0)break;
    const iW=Math.max(0,sheet.width-2*edge),iH=Math.max(0,sheet.height-2*edge);
    if(iW<=0||iH<=0)continue;
    const placements=[];let y=edge;const leftover=[...remaining];
    while(y<edge+iH-EPS&&leftover.length>0){
      let stripH=0;const remH=edge+iH-y;
      for(const it of leftover){const h1=it.height,w1=it.width;if(h1<=remH+EPS){stripH=Math.max(stripH,h1);break;}if(rotate&&w1<=remH+EPS){stripH=Math.max(stripH,w1);break;}}
      if(stripH<EPS)break;
      let x=edge;const used=new Set();
      for(let idx=0;idx<leftover.length;idx++){
        if(used.has(idx))continue;const it=leftover[idx];let pw=it.width,ph=it.height,rotated=false;
        if(ph<=stripH+EPS&&pw<=(edge+iW-x)+EPS){}
        else if(rotate&&it.width<=stripH+EPS&&it.height<=(edge+iW-x)+EPS){pw=it.height;ph=it.width;rotated=true;}
        else continue;
        if(x+pw>edge+iW+EPS)continue;
        placements.push({x,y,w:rotated?it.height:it.width,h:rotated?it.width:it.height,label:it.label,base:it.base,rotated,stripH});
        x+=pw+kerf;used.add(idx);
      }
      const usedArr=[...used].sort((a,b)=>b-a);usedArr.forEach(i=>leftover.splice(i,1));
      if(used.size===0)break;
      y+=stripH+kerf;
    }
    if(placements.length>0){
      sheets.push({id:sheetId++,width:sheet.width,height:sheet.height,placements,mode:'linear'});
      const placedLabels=new Set(placements.map(p=>p.label));
      for(let i=remaining.length-1;i>=0;i--){if(placedLabels.has(remaining[i].label))remaining.splice(i,1);}
    }
  }
  return{sheets,unplaced:remaining};
}

function solveGuillotine(available,items,kerf,edge,rotate){
  const pool=[];available.forEach(s=>{for(let i=0;i<s.quantity;i++)pool.push({width:s.width,height:s.height});});
  let remaining=items.flatMap(it=>{const arr=[];for(let i=0;i<it.quantity;i++)arr.push({...it,label:it.quantity>1?`${it.label} #${i+1}`:it.label,base:it.label});return arr;});
  remaining.sort((a,b)=>b.width*b.height-a.width*a.height);
  class GuillotineBin{
    constructor(sw,sh){
      this.sw=sw;this.sh=sh;
      const iW=Math.max(0,sw-2*edge),iH=Math.max(0,sh-2*edge);
      this.free=iW>0&&iH>0?[{x:edge,y:edge,w:iW,h:iH}]:[];
      this.used=[];
    }
    insert(iw,ih,label,base,origW,origH){
      for(let ri=0;ri<(rotate?2:1);ri++){
        const fw=ri===0?iw:ih,fh=ri===0?ih:iw,rotated=ri===1;
        let bestFi=-1,bestScore=Infinity;
        for(let fi=0;fi<this.free.length;fi++){
          const fr=this.free[fi];
          if(fw<=fr.w+EPS&&fh<=fr.h+EPS){const score=fr.w*fr.h-fw*fh;if(score<bestScore){bestScore=score;bestFi=fi;}}
        }
        if(bestFi<0)continue;
        const fr=this.free[bestFi],px=fr.x,py=fr.y;
        this.used.push({x:px,y:py,w:rotated?origH:origW,h:rotated?origW:origH,label,base,rotated});
        const rightW=fr.w-fw-kerf,topH=fr.h-fh-kerf;
        this.free.splice(bestFi,1);
        if(fr.w>=fr.h){if(rightW>EPS)this.free.push({x:px+fw+kerf,y:fr.y,w:rightW,h:fr.h});if(topH>EPS)this.free.push({x:fr.x,y:py+fh+kerf,w:fw,h:topH});}
        else{if(topH>EPS)this.free.push({x:fr.x,y:py+fh+kerf,w:fr.w,h:topH});if(rightW>EPS)this.free.push({x:px+fw+kerf,y:fr.y,w:rightW,h:fh});}
        this.free=this.free.filter(r=>r.w>EPS&&r.h>EPS);
        return true;
      }
      return false;
    }
  }
  const bins=pool.map(s=>new GuillotineBin(s.width,s.height));const unplaced=[];
  for(const item of remaining){let placed=false;for(const bin of bins){if(bin.insert(item.width,item.height,item.label,item.base,item.width,item.height)){placed=true;break;}}if(!placed)unplaced.push(item);}
  let id=1;const sheets=bins.map((b,i)=>({id:id++,width:pool[i].width,height:pool[i].height,placements:b.used,mode:'guillotine'})).filter(s=>s.placements.length>0);
  return{sheets,unplaced};
}

function solve2D(available, required, kerf, edge, rotate) {
  const pool = [];
  available.forEach(s => { for (let i = 0; i < s.quantity; i++) pool.push({...s}); });

  const items = [];
  required.forEach(r => {
    for (let i = 0; i < r.quantity; i++) {
      const label = r.quantity > 1 ? `${r.label} #${i+1}` : r.label;
      items.push({ w:r.width, h:r.height, origW:r.width, origH:r.height, base:r.label, label });
    }
  });

  const strategies = [
    (a,b) => b.w*b.h - a.w*a.h,
    (a,b) => (b.w+b.h) - (a.w+a.h),
    (a,b) => b.w - a.w,
    (a,b) => Math.max(b.w,b.h) - Math.max(a.w,a.h)
  ];

  function bestOrientationForBin(binW, binH, allItems, kerf, edge) {
    const {W, H} = innerDims({width:binW, height:binH}, edge);
    const first = allItems[0];
    if (first && rotate && first.origW !== first.origH) {
      const countN = Math.floor((W + kerf) / (first.origW + kerf));
      const countR = Math.floor((W + kerf) / (first.origH + kerf));
      const rowsN  = Math.floor((H + kerf) / (first.origH + kerf));
      const rowsR  = Math.floor((H + kerf) / (first.origW + kerf));
      if (countR * rowsR > countN * rowsN) return 'rotated';
    }
    return 'normal';
  }

  const chooseSheet = (myPool, bins, w, h) => {
    let best=-1, bestArea=Infinity;
    for (let i=0; i<myPool.length; i++) {
      const s=myPool[i], {W,H}=innerDims(s,edge);
      const fitsN = w<=W && h<=H;
      const fitsR = rotate && h<=W && w<=H;
      if (fitsN || fitsR) {
        const a = W*H + bins.filter(b=>b.W===s.width&&b.H===s.height).length*1e6;
        if (a<bestArea) { bestArea=a; best=i; }
      }
    }
    return best;
  };

  function insertIntoBin(bin, it) {
    const useRotated = bin._preferRotated && it.origW !== it.origH;
    if (useRotated) {
      if (bin.insertForced(it.origH, it.origW, it.label, it.base, it.origH, it.origW, true))
        return true;
      if (bin.insertForced(it.origW, it.origH, it.label, it.base, it.origW, it.origH, false))
        return true;
    } else {
      if (bin.insertForced(it.origW, it.origH, it.label, it.base, it.origW, it.origH, false))
        return true;
      if (rotate && it.origW !== it.origH &&
          bin.insertForced(it.origH, it.origW, it.label, it.base, it.origH, it.origW, true))
        return true;
    }
    return false;
  }

  let bestResult = null;

  for (const sortFn of strategies) {
    const sorted = [...items].sort(sortFn);
    const bins = [], myPool = [...pool], unplaced = [];

    for (let ii = 0; ii < sorted.length; ii++) {
      const it = sorted[ii];
      let didPlace = false;

      for (const bin of bins) {
        if (insertIntoBin(bin, it)) { didPlace = true; break; }
      }

      if (!didPlace) {
        const idx = chooseSheet(myPool, bins, it.origW, it.origH);
        if (idx >= 0) {
          const s = myPool.splice(idx, 1)[0];
          const bin = new MaxRectsBin(s.width, s.height, kerf, edge);
          const remaining = sorted.slice(ii);
          const orient = rotate ? bestOrientationForBin(s.width, s.height, remaining, kerf, edge) : 'normal';
          bin._preferRotated = (orient === 'rotated');

          let placed = false;
          if (orient === 'rotated' && it.origW !== it.origH) {
            placed = bin.insertForced(it.origH, it.origW, it.label, it.base, it.origH, it.origW, true);
            if (!placed) placed = bin.insertForced(it.origW, it.origH, it.label, it.base, it.origW, it.origH, false);
          } else {
            placed = bin.insertForced(it.origW, it.origH, it.label, it.base, it.origW, it.origH, false);
            if (!placed && rotate && it.origW !== it.origH) {
              placed = bin.insertForced(it.origH, it.origW, it.label, it.base, it.origH, it.origW, true);
            }
          }

          if (placed) {
            bins.push(bin); didPlace = true;
          } else {
            myPool.splice(idx, 0, s);
          }
        }
        if (!didPlace) unplaced.push(it);
      }
    }

    if (!bestResult || unplaced.length < bestResult.unplaced.length) {
      let id = 1;
      bestResult = {
        sheets: bins.filter(b=>b.used.length).map(b=>({
          id:id++, width:b.W, height:b.H, placements:b.used
        })),
        unplaced
      };
    }
    if (bestResult.unplaced.length === 0) break;
  }

  return bestResult;
}

function solve(available,required){
  const kerf=getKerf(),edge=getEdge(),rotate=getAllowRotate();const warnings=[];
  const valid=required.filter(r=>{
    let fits=false;
    for(const s of available){const{W,H}=innerDims(s,edge);if((r.width<=W&&r.height<=H)||(rotate&&r.height<=W&&r.width<=H)){fits=true;break;}}
    if(!fits)warnings.push(`⚠️ ${fmtLen(r.width)} × ${fmtLen(r.height)} is too large for the available sheet size and has been excluded.`);
    return fits;
  });
  let result;
  if(cuttingMode==='linear')result=solveLinear(available,valid,kerf,edge,rotate);
  else if(cuttingMode==='guillotine')result=solveGuillotine(available,valid,kerf,edge,rotate);
  else result=solve2D(available,valid,kerf,edge,rotate);
  const pool=[];available.forEach(s=>{for(let i=0;i<s.quantity;i++)pool.push({width:s.width,height:s.height});});
  let id=1;
  const allSheets=pool.map(p=>{const match=result.sheets.find(s=>s.width===p.width&&s.height===p.height&&!s._claimed);if(match){match._claimed=true;return{...match,id:id++};}return{id:id++,width:p.width,height:p.height,placements:[]};});
  result.sheets.filter(s=>!s._claimed).forEach(s=>allSheets.push({...s,id:id++}));
  allSheets.sort((a,b)=>(b.placements.length>0)-(a.placements.length>0)||a.id-b.id);
  return{sheets:allSheets,unplaced:result.unplaced||[],warnings};
}

function countCuts(sheet){
  const ps=sheet.placements;if(!ps.length)return{h:0,v:0,total:0};
  const edge=getEdge(),kerf=getKerf();
  const x0=edge,y0=edge,x1=sheet.width-edge,y1=sheet.height-edge;
  const interiorX=v=>v>x0+EPS&&v<x1-EPS;const interiorY=v=>v>y0+EPS&&v<y1-EPS;
  const hCoords=[],vCoords=[];
  for(const p of ps){if(interiorY(p.y))hCoords.push(p.y);if(interiorY(p.y+p.h))hCoords.push(p.y+p.h);if(interiorX(p.x))vCoords.push(p.x);if(interiorX(p.x+p.w))vCoords.push(p.x+p.w);}
  function countUniquePositions(coords){if(!coords.length)return 0;const sorted=[...new Set(coords.map(v=>Math.round(v*1000)/1000))].sort((a,b)=>a-b);let cuts=1;for(let i=1;i<sorted.length;i++){if(sorted[i]-sorted[i-1]>kerf+EPS)cuts++;}return cuts;}
  const h=countUniquePositions(hCoords),v=countUniquePositions(vCoords);
  return{h,v,total:h+v};
}

function mergeRects(rects){
  let merged=true;rects=rects.filter(r=>r.w>EPS&&r.h>EPS);
  while(merged){merged=false;outer:for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
    const a=rects[i],b=rects[j];
    if(Math.abs(a.y-b.y)<EPS&&Math.abs(a.h-b.h)<EPS){if(Math.abs(a.x+a.w-b.x)<EPS){rects[i]={x:a.x,y:a.y,w:a.w+b.w,h:a.h};rects.splice(j,1);merged=true;break outer;}if(Math.abs(b.x+b.w-a.x)<EPS){rects[i]={x:b.x,y:b.y,w:b.w+a.w,h:a.h};rects.splice(j,1);merged=true;break outer;}}
    if(Math.abs(a.x-b.x)<EPS&&Math.abs(a.w-b.w)<EPS){if(Math.abs(a.y+a.h-b.y)<EPS){rects[i]={x:a.x,y:a.y,w:a.w,h:a.h+b.h};rects.splice(j,1);merged=true;break outer;}if(Math.abs(b.y+b.h-a.y)<EPS){rects[i]={x:b.x,y:b.y,w:a.w,h:b.h+a.h};rects.splice(j,1);merged=true;break outer;}}
  }}
  return rects;
}

function computeOffcuts2D(sheet,edge,kerf){
  const bin=new MaxRectsBin(sheet.width,sheet.height,kerf,edge);
  for(const p of sheet.placements)bin.insert(p.w,p.h,p.label,p.base||p.label,p.w,p.h,false);
  const minArea=50*50;
  let rects=bin.free.filter(r=>r.w>kerf+EPS&&r.h>kerf+EPS).map(r=>({x:r.x+kerf/2,y:r.y+kerf/2,w:r.w-kerf,h:r.h-kerf})).filter(r=>r.w>EPS&&r.h>EPS&&r.w*r.h>=minArea);
  return mergeRects(rects);
}

function computeOffcutsLinear(sheet,edge,kerf){
  const ps=sheet.placements;if(!ps.length)return[];
  const x0=edge,y0=edge,x1=sheet.width-edge,y1=sheet.height-edge,iW=x1-x0;
  const strips=new Map();for(const p of ps){const key=Math.round(p.y*1000);if(!strips.has(key))strips.set(key,[]);strips.get(key).push(p);}
  const offcuts=[];let stripsArr=[...strips.values()].sort((a,b)=>a[0].y-b[0].y);
  for(const strip of stripsArr){const stripY=strip[0].y,stripH=strip[0].stripH||strip.reduce((m,p)=>Math.max(m,p.h),0),rightX=strip.reduce((m,p)=>Math.max(m,p.x+p.w),x0),remainW=x1-rightX-kerf;if(remainW>EPS&&stripH>EPS)offcuts.push({x:rightX+kerf,y:stripY,w:remainW,h:stripH});}
  const lastStrip=stripsArr[stripsArr.length-1];
  if(lastStrip){const lastY=lastStrip[0].y,lastH=lastStrip[0].stripH||lastStrip.reduce((m,p)=>Math.max(m,p.h),0),belowY=lastY+lastH+kerf,belowH=y1-belowY;if(belowH>EPS&&iW>EPS)offcuts.push({x:x0,y:belowY,w:iW,h:belowH});}
  const minArea=50*50;return mergeRects(offcuts.filter(r=>r.w>EPS&&r.h>EPS&&r.w*r.h>=minArea));
}

function computeOffcutsGuillotine(sheet,edge,kerf){
  const iW=Math.max(0,sheet.width-2*edge),iH=Math.max(0,sheet.height-2*edge);if(iW<=0||iH<=0)return[];
  let free=[{x:edge,y:edge,w:iW,h:iH}];
  for(const p of sheet.placements){
    const fw=p.w+kerf,fh=p.h+kerf;let bestFi=-1,bestScore=Infinity;
    for(let fi=0;fi<free.length;fi++){const fr=free[fi];if(fw<=fr.w+EPS&&fh<=fr.h+EPS){const score=fr.w*fr.h-fw*fh;if(score<bestScore){bestScore=score;bestFi=fi;}}if(fh<=fr.w+EPS&&fw<=fr.h+EPS){const score=fr.w*fr.h-fw*fh;if(score<bestScore){bestScore=score;bestFi=fi;}}}
    if(bestFi<0)continue;
    const fr=free[bestFi],usedW=Math.min(fw,fr.w),usedH=Math.min(fh,fr.h);free.splice(bestFi,1);
    const rightW=fr.w-usedW-kerf,topH=fr.h-usedH-kerf;
    if(fr.w>=fr.h){if(rightW>EPS)free.push({x:fr.x+usedW+kerf,y:fr.y,w:rightW,h:fr.h});if(topH>EPS)free.push({x:fr.x,y:fr.y+usedH+kerf,w:usedW,h:topH});}
    else{if(topH>EPS)free.push({x:fr.x,y:fr.y+usedH+kerf,w:fr.w,h:topH});if(rightW>EPS)free.push({x:fr.x+usedW+kerf,y:fr.y,w:rightW,h:usedH});}
    free=free.filter(r=>r.w>EPS&&r.h>EPS);
  }
  const minArea=50*50;return mergeRects(free.filter(r=>r.w>EPS&&r.h>EPS&&r.w*r.h>=minArea));
}

function computeOffcuts(sheet){
  const edge=getEdge(),kerf=getKerf();const iW=sheet.width-2*edge,iH=sheet.height-2*edge;
  if(iW<=0||iH<=0||!sheet.placements.length)return[];
  if(cuttingMode==='linear')return computeOffcutsLinear(sheet,edge,kerf);
  if(cuttingMode==='guillotine')return computeOffcutsGuillotine(sheet,edge,kerf);
  return computeOffcuts2D(sheet,edge,kerf);
}

function computeStats(solution,available,required){
  const edge=getEdge();const innerArea=(w,h)=>Math.max(0,w-2*edge)*Math.max(0,h-2*edge);
  let totSheetArea=0,totInnerArea=0,totUsed=0,totPlaced=0,totCutsH=0,totCutsV=0;
  const perSheet=solution.sheets.map(s=>{
    const ia=innerArea(s.width,s.height),ua=s.placements.reduce((a,p)=>a+p.w*p.h,0),cuts=countCuts(s);
    totSheetArea+=s.width*s.height;totInnerArea+=ia;totUsed+=ua;totPlaced+=s.placements.length;totCutsH+=cuts.h;totCutsV+=cuts.v;
    return{id:s.id,width:s.width,height:s.height,innerArea:ia,usedArea:ua,wasteArea:Math.max(0,ia-ua),util:ia>0?(ua/ia)*100:0,placements:s.placements.length,cutsH:cuts.h,cutsV:cuts.v,cutsTotal:cuts.total};
  });
  const totalRequired=required.reduce((a,r)=>a+r.quantity,0);
  return{perSheet,kerf:getKerf(),edge,mode:cuttingMode,sheetsUsed:solution.sheets.filter(s=>s.placements.length>0).length,sheetsTotal:solution.sheets.length,piecesRequired:totalRequired,piecesPlaced:totPlaced,piecesUnplaced:Math.max(0,totalRequired-totPlaced),totalSheetArea:totSheetArea,totalInnerArea:totInnerArea,totalUsedArea:totUsed,totalWaste:Math.max(0,totInnerArea-totUsed),utilisation:totInnerArea>0?(totUsed/totInnerArea)*100:0,totalCutsH:totCutsH,totalCutsV:totCutsV,totalCuts:totCutsH+totCutsV};
}

function renderResults(stats,required,warnings){
  const el=document.getElementById('results');el.innerHTML='';
  const wb=document.getElementById('warning-banner');const allWarns=[...(warnings||[])];
  if(stats.piecesUnplaced>0)allWarns.push(`⚠️ ${stats.piecesUnplaced} piece${stats.piecesUnplaced===1?'':'s'} could not be placed. More available sheets are required.`);
  if(allWarns.length){wb.style.display='block';wb.innerHTML=allWarns.map(w=>`<div>${w}</div>`).join('');}
  else{wb.style.display='none';wb.innerHTML='';}
  const sel=lastSolution?.sheets.find(s=>s.id===selectedSheetId);
  function card(title,rows,extraBottomPad=false){
    const c=document.createElement('div');c.className='stat-card';if(extraBottomPad)c.style.marginBottom='8px';
    const h=document.createElement('div');h.className='stat-card-header';h.textContent=title;c.appendChild(h);
    const body=document.createElement('div');body.className='stat-rows';
    rows.forEach(([k,v,cls=''])=>{const row=document.createElement('div');row.className='stat-row';const key=document.createElement('span');key.className='stat-key';key.textContent=k;const val=document.createElement('span');val.className=`stat-val${cls?' '+cls:''}`;val.textContent=v;row.appendChild(key);row.appendChild(val);body.appendChild(row);});
    c.appendChild(body);return c;
  }
  const utilClass=stats.utilisation>=80?'good':stats.utilisation>=50?'':'warn';
  const modeLabel={'2d':'2D Optimised','linear':'Linear / Strip','guillotine':'Guillotine'}[stats.mode]||stats.mode;
  const summaryCard=card('Summary',[['Method',modeLabel],['Sheets used',`${stats.sheetsUsed} / ${stats.sheetsTotal}`],['Pieces placed',`${stats.piecesPlaced} / ${stats.piecesRequired}`,stats.piecesUnplaced>0?'bad':'good'],['Total cuts',String(stats.totalCuts)],['↳ Horizontal',String(stats.totalCutsH)],['↳ Vertical',String(stats.totalCutsV)],['Material utilisation',fmtPct(stats.utilisation),utilClass],['Total waste',fmtArea(stats.totalWaste)],['Usable area',fmtArea(stats.totalInnerArea)],['Kerf / Edge',`${fmtLen(stats.kerf)} / ${fmtLen(stats.edge)}`]],true);
  summaryCard.querySelector('.stat-rows').style.paddingBottom='4px';
  const utilBar=document.createElement('div');utilBar.innerHTML=`<div class="util-bar"><div class="util-fill" style="width:${Math.min(100,stats.utilisation)}%"></div></div>`;summaryCard.appendChild(utilBar);el.appendChild(summaryCard);
  if(sel){const sh=stats.perSheet.find(s=>s.id===sel.id);if(sh){const shCard=card(`Sheet ${sh.id} (${fmtLen(sh.width)} × ${fmtLen(sh.height)})`,[['Pieces',String(sh.placements)],['Cuts (total)',String(sh.cutsTotal)],['↳ Horizontal',String(sh.cutsH)],['↳ Vertical',String(sh.cutsV)],['Utilisation',fmtPct(sh.util),sh.util>=80?'good':sh.util>=50?'':'warn'],['Usable area',fmtArea(sh.innerArea)],['Used area',fmtArea(sh.usedArea)],['Waste',fmtArea(sh.wasteArea)]],true);shCard.querySelector('.stat-rows').style.paddingBottom='4px';el.appendChild(shCard);}}
  if(required.length>0){
    const baseMap=new Map();
    if(lastSolution){for(const sh of lastSolution.sheets)for(const p of sh.placements){const base=p.base||(p.label||'').split(' #')[0];if(!baseMap.has(base))baseMap.set(base,{label:base,placed:0,rotated:0,colour:getColor(base)});baseMap.get(base).placed++;if(p.rotated)baseMap.get(base).rotated++;}}
    required.forEach(r=>{if(!baseMap.has(r.label))baseMap.set(r.label,{label:r.label,placed:0,rotated:0,colour:getColor(r.label)});});
    const cutCard=document.createElement('div');cutCard.className='stat-card';cutCard.style.minWidth='300px';cutCard.style.marginBottom='4px';
    const cutHead=document.createElement('div');cutHead.className='stat-card-header';cutHead.textContent='Cut List';cutCard.appendChild(cutHead);
    const header=document.createElement('div');header.className='cut-list-row cut-list-head';header.innerHTML='<span></span><span>Size</span><span>Placed</span><span>Rotated</span>';cutCard.appendChild(header);
    for(const r of required){const d=baseMap.get(r.label)||{placed:0,rotated:0,colour:'#777'};const row=document.createElement('div');row.className='cut-list-row';row.innerHTML=`<span style="width:12px;height:12px;border-radius:2px;background:${d.colour};display:inline-block;flex-shrink:0;"></span><span style="color:var(--text)">${r.label}</span><span style="color:${d.placed>=r.quantity?'var(--accent)':'var(--error)'}">${d.placed}/${r.quantity}</span><span>${d.rotated>0?'✓':'–'}</span>`;cutCard.appendChild(row);}
    const pad=document.createElement('div');pad.style.height='6px';cutCard.appendChild(pad);el.appendChild(cutCard);
  }
}

function ensureHiDPI(cnv){
  const rect=cnv.getBoundingClientRect();const dpr=Math.max(1,window.devicePixelRatio||1);
  const dw=Math.floor(rect.width*dpr),dh=Math.floor(rect.height*dpr);
  if(cnv.width!==dw||cnv.height!==dh){cnv.width=dw;cnv.height=dh;}
  const ctx=cnv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  return{ctx,cssW:Math.floor(rect.width),cssH:Math.floor(rect.height)};
}

function drawSheet(ctx,cssW,cssH,sheet,opts={}){
  const margin=opts.margin??30;const drawW=cssW-2*margin,drawH=cssH-2*margin;
  const sx=drawW/sheet.width,sy=drawH/sheet.height,scale=Math.min(sx,sy);
  const shW=sheet.width*scale,shH=sheet.height*scale;
  const ox=margin+(drawW-shW)/2,oy=margin+(drawH-shH)/2;
  ctx.save();ctx.shadowColor='rgba(0,0,0,.12)';ctx.shadowBlur=10;ctx.shadowOffsetY=2;ctx.fillStyle='#f8f8f8';ctx.fillRect(ox,oy,shW,shH);ctx.restore();
  const edge=getEdge(),kerf=getKerf();
  if(edge>0){ctx.save();ctx.strokeStyle='rgba(180,83,9,.45)';ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.strokeRect(ox+edge*scale,oy+edge*scale,shW-2*edge*scale,shH-2*edge*scale);ctx.restore();}
  ctx.save();ctx.strokeStyle='#999';ctx.lineWidth=1.5;ctx.strokeRect(ox,oy,shW,shH);ctx.restore();
  ctx.save();ctx.beginPath();ctx.rect(ox,oy,shW,shH);ctx.clip();
  const offcuts=computeOffcuts(sheet);
  for(const oc of offcuts){
    const px=ox+oc.x*scale,py=oy+oc.y*scale,pw=oc.w*scale,ph=oc.h*scale;
    if(pw<4||ph<4)continue;
    ctx.save();ctx.beginPath();ctx.rect(px,py,pw,ph);ctx.clip();ctx.strokeStyle='rgba(160,160,160,.25)';ctx.lineWidth=0.7;
    for(let d=-ph;d<pw+ph;d+=8){ctx.beginPath();ctx.moveTo(px+d,py);ctx.lineTo(px+d+ph,py+ph);ctx.stroke();}
    ctx.restore();
    if(pw>40&&ph>20){ctx.save();const fs=Math.max(7,Math.min(9,Math.floor(Math.min(pw,ph)/7)));ctx.font=`400 ${fs}px monospace`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='rgba(120,120,120,.7)';ctx.fillText(`${fmtLen(oc.w)} × ${fmtLen(oc.h)}`,px+pw/2,py+ph/2);ctx.restore();}
  }
  if(sheet.placements.length>0){
    const allXCoords=new Set(),allYCoords=new Set();const x0=edge,y0=edge,x1=sheet.width-edge,y1=sheet.height-edge;
    for(const p of sheet.placements){if(p.x>x0+EPS&&p.x<x1-EPS)allXCoords.add(p.x);if(p.x+p.w>x0+EPS&&p.x+p.w<x1-EPS)allXCoords.add(p.x+p.w);if(p.y>y0+EPS&&p.y<y1-EPS)allYCoords.add(p.y);if(p.y+p.h>y0+EPS&&p.y+p.h<y1-EPS)allYCoords.add(p.y+p.h);}
    ctx.save();ctx.strokeStyle='rgba(100,100,100,.35)';ctx.lineWidth=0.8;ctx.setLineDash([3,3]);
    for(const yCoord of allYCoords){const cy=oy+yCoord*scale;ctx.beginPath();ctx.moveTo(ox,cy);ctx.lineTo(ox+shW,cy);ctx.stroke();}
    for(const xCoord of allXCoords){const cx=ox+xCoord*scale;ctx.beginPath();ctx.moveTo(cx,oy);ctx.lineTo(cx,oy+shH);ctx.stroke();}
    ctx.setLineDash([]);ctx.restore();
  }
  for(const p of sheet.placements){
    const px=ox+p.x*scale,py=oy+p.y*scale,pw=p.w*scale,ph=p.h*scale;
    const base=p.base||(p.label||'').split(' #')[0],colour=getColor(base);
    ctx.fillStyle=colour+'55';ctx.fillRect(px,py,pw,ph);ctx.strokeStyle=colour;ctx.lineWidth=1.5;ctx.strokeRect(px+.75,py+.75,pw-1.5,ph-1.5);
    if(p.rotated&&pw>16&&ph>16){ctx.save();ctx.fillStyle=colour+'88';ctx.translate(px+pw-8,py+8);ctx.rotate(Math.PI/4);ctx.fillRect(-4,-1,8,2);ctx.restore();}
    if(pw>28&&ph>16){const fontSize=Math.max(7,Math.min(10,Math.floor(Math.min(pw,ph)/6)));ctx.save();ctx.font=`500 ${fontSize}px monospace`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#111';ctx.shadowColor='rgba(255,255,255,.85)';ctx.shadowBlur=3;const wLabel=fmtLen(p.w),hLabel=fmtLen(p.h);if(pw>=55&&ph>=26){ctx.fillText(wLabel,px+pw/2,py+ph/2-fontSize*.65);ctx.fillText(hLabel,px+pw/2,py+ph/2+fontSize*.65);}else{ctx.fillText(pw>ph?wLabel:hLabel,px+pw/2,py+ph/2);}ctx.restore();}
  }
  if(opts.labelSheet!==false){ctx.save();ctx.font='500 11px monospace';ctx.fillStyle='#888';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText(`${fmtLen(sheet.width)} × ${fmtLen(sheet.height)}`,ox+shW/2,oy-4);ctx.restore();}
  if(sheet.placements.length===0){ctx.save();ctx.strokeStyle='rgba(185,28,28,.3)';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(ox,oy);ctx.lineTo(ox+shW,oy+shH);ctx.moveTo(ox+shW,oy);ctx.lineTo(ox,oy+shH);ctx.stroke();ctx.restore();}
  ctx.restore();
}

const canvas=document.getElementById('canvas');

function applyZoom(factor,ax,ay){const newScale=Math.max(.1,Math.min(8,view.scale*factor));const wx=(ax-view.offsetX)/view.scale,wy=(ay-view.offsetY)/view.scale;view.scale=newScale;view.offsetX=ax-wx*newScale;view.offsetY=ay-wy*newScale;}
function resetView(){view.scale=1;view.offsetX=0;view.offsetY=0;}

canvas.addEventListener('mousedown',e=>{if(e.button!==0)return;view.mouseDown=true;view.isPanning=false;const r=canvas.getBoundingClientRect();view.startX=e.clientX-r.left-view.offsetX;view.startY=e.clientY-r.top-view.offsetY;view.downClientX=e.clientX;view.downClientY=e.clientY;canvas.style.cursor='grabbing';});
window.addEventListener('mousemove',e=>{if(!view.mouseDown)return;const dx=e.clientX-view.downClientX,dy=e.clientY-view.downClientY;if(!view.isPanning&&(Math.abs(dx)>3||Math.abs(dy)>3))view.isPanning=true;if(view.isPanning){const r=canvas.getBoundingClientRect();view.offsetX=e.clientX-r.left-view.startX;view.offsetY=e.clientY-r.top-view.startY;drawMain();}});
window.addEventListener('mouseup',()=>{view.mouseDown=false;view.isPanning=false;canvas.style.cursor='grab';});
canvas.addEventListener('wheel',e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();const r=canvas.getBoundingClientRect();applyZoom(e.deltaY<0?1.15:1/1.15,e.clientX-r.left,e.clientY-r.top);drawMain();},{passive:false});

let lastTouches = null;
canvas.addEventListener('touchstart',e=>{e.preventDefault();lastTouches=e.touches;},{passive:false});
canvas.addEventListener('touchmove',e=>{
  e.preventDefault();const t=e.touches;
  if(t.length===1&&lastTouches&&lastTouches.length===1){
    view.offsetX+=t[0].clientX-lastTouches[0].clientX;view.offsetY+=t[0].clientY-lastTouches[0].clientY;drawMain();
  }else if(t.length===2&&lastTouches&&lastTouches.length===2){
    const prevDist=Math.hypot(lastTouches[0].clientX-lastTouches[1].clientX,lastTouches[0].clientY-lastTouches[1].clientY);
    const newDist=Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
    if(prevDist>0){const r=canvas.getBoundingClientRect();const cx=(t[0].clientX+t[1].clientX)/2-r.left;const cy=(t[0].clientY+t[1].clientY)/2-r.top;applyZoom(newDist/prevDist,cx,cy);drawMain();}
  }
  lastTouches=t;
},{passive:false});
canvas.addEventListener('touchend',e=>{lastTouches=e.touches;},{passive:true});

function drawMain(){
  const{ctx,cssW,cssH}=ensureHiDPI(canvas);
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.restore();
  if(!lastSolution)return;
  const sheet=lastSolution.sheets.find(s=>s.id===selectedSheetId)||lastSolution.sheets[0];
  if(!sheet)return;
  ctx.save();ctx.translate(view.offsetX,view.offsetY);ctx.scale(view.scale,view.scale);
  drawSheet(ctx,cssW,cssH,sheet,{margin:40});
  ctx.restore();
}

function buildPreviews(solution){
  const strip=document.getElementById('sheet-previews');strip.innerHTML='';
  for(const sheet of solution.sheets){
    const wrap=document.createElement('div');wrap.className='preview-thumb';wrap.dataset.id=sheet.id;
    if(sheet.id===selectedSheetId)wrap.classList.add('selected');
    const cnv=document.createElement('canvas');wrap.appendChild(cnv);
    const lbl=document.createElement('div');lbl.className='preview-label';lbl.textContent=`Sheet ${sheet.id}`;wrap.appendChild(lbl);
    strip.appendChild(wrap);
    const{ctx,cssW,cssH}=ensureHiDPI(cnv);
    drawSheet(ctx,cssW,cssH,sheet,{margin:6,labelSheet:false});
    wrap.addEventListener('click',()=>{selectedSheetId=sheet.id;resetView();drawMain();document.querySelectorAll('.preview-thumb').forEach(el=>el.classList.toggle('selected',el.dataset.id==sheet.id));if(lastStats)renderResults(lastStats,readRequired(),[]);updateSheetLabel();});
  }
}

function updateSheetLabel(){
  const sheets=lastSolution?.sheets||[];const idx=sheets.findIndex(s=>s.id===selectedSheetId);
  document.getElementById('sheet-label').textContent=sheets.length?`Sheet ${idx+1} / ${sheets.length}`:'—';
  document.getElementById('prev-sheet').disabled=idx<=0;document.getElementById('next-sheet').disabled=idx>=sheets.length-1;
}

function navSheet(delta){
  if(!lastSolution)return;const sheets=lastSolution.sheets;const idx=sheets.findIndex(s=>s.id===selectedSheetId);
  const ni=Math.max(0,Math.min(sheets.length-1,idx+delta));selectedSheetId=sheets[ni].id;resetView();drawMain();
  document.querySelectorAll('.preview-thumb').forEach(el=>el.classList.toggle('selected',el.dataset.id==selectedSheetId));
  if(lastStats)renderResults(lastStats,readRequired(),[]);updateSheetLabel();
}

document.getElementById('prev-sheet').addEventListener('click',()=>navSheet(-1));
document.getElementById('next-sheet').addEventListener('click',()=>navSheet(+1));

function buildLegend(required){
  const el=document.getElementById('legend-area');el.innerHTML='';
  for(const r of required){
    const pill=document.createElement('div');pill.className='legend-pill';const col=getColor(r.label);
    pill.style.background=col+'18';pill.style.borderColor=col+'44';
    pill.innerHTML=`<span class="legend-swatch" style="background:${col}"></span><span style="color:var(--text)">${r.label}</span><span style="color:var(--text-dim);margin-left:4px;">×${r.quantity}</span>`;
    el.appendChild(pill);
  }
}

document.querySelectorAll('[data-act]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const act=btn.dataset.act;
    if(act==='zoom-in'){applyZoom(1.25,canvas.clientWidth/2,canvas.clientHeight/2);drawMain();}
    if(act==='zoom-out'){applyZoom(1/1.25,canvas.clientWidth/2,canvas.clientHeight/2);drawMain();}
    if(act==='reset'){resetView();drawMain();}
    if(act==='export')exportImage();
    if(act==='export-pdf')exportPDF();
  });
});

function exportImage(){
  const tmp=document.createElement('canvas');tmp.width=canvas.width;tmp.height=canvas.height;
  const tc=tmp.getContext('2d');tc.fillStyle='#f5f5f5';tc.fillRect(0,0,tmp.width,tmp.height);tc.drawImage(canvas,0,0);
  const a=document.createElement('a');a.href=tmp.toDataURL('image/jpeg',.95);a.download=`cutting-layout-sheet-${selectedSheetId||1}.jpg`;a.click();
}

function exportPDF(){
  if(!window.jspdf?.jsPDF){alert('jsPDF not loaded');return;}
  if(!lastSolution?.sheets.length){alert('No sheets to export');return;}
  const{jsPDF}=window.jspdf;const pdf=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  const pw=pdf.internal.pageSize.getWidth(),ph=pdf.internal.pageSize.getHeight();
  lastSolution.sheets.forEach((sheet,i)=>{
    if(i>0)pdf.addPage();
    const tmp=document.createElement('canvas');const sc=3;tmp.width=1200*sc;tmp.height=848*sc;
    const tc=tmp.getContext('2d');tc.scale(sc,sc);tc.fillStyle='#f5f5f5';tc.fillRect(0,0,1200,848);
    drawSheet(tc,1200,848,sheet,{margin:60});
    const img=tmp.toDataURL('image/jpeg',.95),marg=12,iw=pw-2*marg,ih=ph-marg-20;
    pdf.setFontSize(11);pdf.setFont(undefined,'bold');
    pdf.text(`Sheet ${sheet.id}  —  ${fmtLen(sheet.width)} × ${fmtLen(sheet.height)}  [${cuttingMode}]`,pw/2,marg-2,{align:'center'});
    pdf.addImage(img,'JPEG',marg,marg+4,iw,ih,undefined,'FAST');tmp.remove();
  });
  pdf.addPage();const stats=lastStats;
  if(stats){
    pdf.setFontSize(16);pdf.setFont(undefined,'bold');pdf.text('Cut Sheet Summary',pw/2,20,{align:'center'});
    pdf.setFontSize(9);pdf.setFont(undefined,'normal');pdf.setTextColor(120);pdf.text('Results are intended as a guide only.',pw/2,28,{align:'center'});pdf.setTextColor(0);
    let y=38;const lx=20,vx=140;pdf.setFontSize(10);
    const rows=[['Cutting method',{'2d':'2D Optimised','linear':'Linear / Strip','guillotine':'Guillotine'}[stats.mode]],['Sheets (used / total)',`${stats.sheetsUsed} / ${stats.sheetsTotal}`],['Pieces placed',`${stats.piecesPlaced} / ${stats.piecesRequired}`],['Total cuts',String(stats.totalCuts)],['  Horizontal cuts',String(stats.totalCutsH)],['  Vertical cuts',String(stats.totalCutsV)],['Utilisation',fmtPct(stats.utilisation)],['Total waste',fmtArea(stats.totalWaste)],['Kerf',fmtLen(stats.kerf)],['Edge offset',fmtLen(stats.edge)]];
    rows.forEach(([k,v])=>{pdf.text(k+':',lx,y);pdf.setFont(undefined,'bold');pdf.text(v,vx,y);pdf.setFont(undefined,'normal');y+=7;});
  }
  pdf.save('cutting-layout.pdf');
}

function render(){
  const available=readAvailable(),required=readRequired();lastAvailable=available;
  labelColorMap.clear();required.forEach(r=>getColor(r.label));buildLegend(required);
  if(!available.length||!required.length){
    const sheets=[];let id=1;available.forEach(s=>{for(let i=0;i<s.quantity;i++)sheets.push({id:id++,width:s.width,height:s.height,placements:[]});});
    lastSolution={sheets};
    if(!selectedSheetId||!sheets.find(s=>s.id===selectedSheetId))selectedSheetId=sheets[0]?.id??null;
    buildPreviews(lastSolution);drawMain();updateSheetLabel();
    const stats=computeStats(lastSolution,available,required);lastStats=stats;renderResults(stats,required,[]);return;
  }
  const result=solve(available,required);lastSolution={sheets:result.sheets};
  if(!selectedSheetId||!result.sheets.find(s=>s.id===selectedSheetId))selectedSheetId=result.sheets[0]?.id??null;
  buildPreviews(lastSolution);drawMain();updateSheetLabel();
  const stats=computeStats(lastSolution,available,required);lastStats=stats;renderResults(stats,required,result.warnings||[]);
}

new ResizeObserver(()=>drawMain()).observe(canvas);
window.addEventListener('resize',drawMain);

window.addEventListener('keydown',e=>{
  const tag=(e.target?.tagName||'').toLowerCase();if(tag==='input'||tag==='select')return;
  if(e.key==='='||e.key==='+'){applyZoom(1.2,canvas.clientWidth/2,canvas.clientHeight/2);drawMain();e.preventDefault();}
  if(e.key==='-'){applyZoom(1/1.2,canvas.clientWidth/2,canvas.clientHeight/2);drawMain();e.preventDefault();}
  if(e.key==='0'){resetView();drawMain();e.preventDefault();}
  if(e.key==='[')navSheet(-1);if(e.key===']')navSheet(+1);
});

initUnitConvFields();
render();

</script>

<script>

const productsMap = {
    "sheet-materials": {
        "name": "Sheet Materials",
        "img": `<svg class="category-thumb" xmlns="http://www.w3.org/2000/svg" width="75" height="75" viewBox="0 0 400 400"> <circle cx="200" cy="200" r="180" fill="white"/> <g transform="translate(200,200) scale(2.5) translate(-301,-304)"> <path fill="#009845" d="M345.98,320.47l-3.74-3.85-.99-1.1c-.61-.74-.67-1.83-.09-2.65.5-.7,1.33-1.03,2.12-.91l1.36.32,6.79,2.01s-1.16-14.5-1.39-16.27c-.23-1.78-2-2.16-2-2.16l-5.17-1.46-1.41-.46c-.9-.34-1.5-1.25-1.41-2.25.08-.86.64-1.55,1.39-1.85l1.34-.4,6.88-1.66s-8.25-11.98-9.34-13.4c-1.09-1.42-2.82-.87-2.82-.87l-5.21,1.32-1.45.3c-.95.15-1.92-.33-2.34-1.25-.36-.78-.22-1.66.28-2.29l.95-1.01,5.13-4.88s-13.13-6.25-14.79-6.93c-1.65-.69-2.87.66-2.87.66l-3.85,3.74-1.1.99c-.74.61-1.83.67-2.65.09-.7-.5-1.03-1.33-.91-2.12l.32-1.36,2.01-6.79s-14.5,1.16-16.27,1.39c-1.77.23-2.16,2.01-2.16,2.01l-1.47,5.17-.46,1.41c-.34.9-1.25,1.5-2.25,1.41-.86-.08-1.55-.64-1.84-1.39l-.4-1.33-1.66-6.88s-11.98,8.25-13.4,9.34c-1.42,1.09-.87,2.82-.87,2.82l1.31,5.21.3,1.45c.15.95-.33,1.92-1.25,2.34-.78.36-1.66.22-2.29-.28l-1.01-.96-4.88-5.13s-6.25,13.14-6.93,14.79c-.69,1.65.66,2.87.66,2.87l3.74,3.85.99,1.1c.61.74.67,1.83.09,2.65-.5.7-1.33,1.03-2.12.9l-1.36-.32-6.79-2.01s1.16,14.5,1.39,16.27c.23,1.77,2.01,2.16,2.01,2.16l5.17,1.47,1.41.46c.9.34,1.5,1.25,1.41,2.25-.08.86-.64,1.55-1.39,1.85l-1.34.4-6.88,1.66s8.25,11.98,9.34,13.4c1.09,1.42,2.82.87,2.82.87l5.21-1.31,1.45-.3c.95-.16,1.92.33,2.34,1.25.36.78.22,1.66-.28,2.29l-.95,1.02-5.13,4.88s13.14,6.25,14.79,6.94c1.65.69,2.87-.66,2.87-.66l3.85-3.74,1.1-.99c.74-.61,1.83-.67,2.65-.09.7.5,1.03,1.33.9,2.12l-.32,1.36-2.01,6.79s14.5-1.16,16.27-1.39c1.77-.23,2.16-2.01,2.16-2.01l1.46-5.17.46-1.41c.34-.9,1.25-1.5,2.25-1.41.86.08,1.55.64,1.84,1.39l.4,1.34,1.66,6.88s11.98-8.25,13.4-9.34c1.42-1.09.87-2.82.87-2.82l-1.31-5.21-.3-1.45c-.15-.95.33-1.92,1.25-2.34.78-.36,1.66-.22,2.29.28l1.02.95,4.88,5.13s6.25-13.14,6.93-14.79c.69-1.65-.66-2.87-.66-2.87ZM301.06,320.09c-8.7,0-15.76-7.05-15.76-15.76s7.06-15.76,15.76-15.76,15.76,7.06,15.76,15.76-7.05,15.76-15.76,15.76Z"/> </g> </svg>`,
        "categories": [
            { "name": "Chipboard Flooring", "img": "/media/catalog/category/import/building-materials/sheet-materials/chipboard-flooring.jpg", "href": "/building-materials/sheet-materials/chipboard-flooring" },
            { "name": "MDF Sheet", "img": "/media/catalog/category/import/building-materials/sheet-materials/mdf.jpg", "href": "/building-materials/sheet-materials/mdf" },
            { "name": "Melamine Faced Chipboard", "img": "/media/catalog/category/import/building-materials/sheet-materials/melamine-faced-chipboard.jpg", "href": "/building-materials/sheet-materials/melamine-faced-chipboard" },
            { "name": "OSB 3 Board", "img": "/media/catalog/category/osb-3-sterling-board.jpg", "href": "/building-materials/sheet-materials/osb-3-board" },
            { "name": "Plywood Sheet", "img": "/media/catalog/category/import/building-materials/sheet-materials/plywood.jpg", "href": "/building-materials/sheet-materials/plywood" },
            { "name": "Circular Cordless Saws", "img": "/media/catalog/category/import/power-tools/power-tools/powered-saws/circular-and-trim-saws-cordless.jpg", "href": "/power-tools/power-tools/powered-saws/circular-and-trim-saws-cordless" }
        ]
    }
};

function initializeApp() {
    let materials = ["sheet-materials"];
    const carousels = [];
    const prevButtons = [];
    const nextButtons = [];
    const carouselContainers = [];
    const carouselIndexMap = {};

    materials = materials.filter(material => {
        const exists = productsMap[material] && document.getElementById(`${material}-carousel`);
        if (!exists) console.warn(`Carousel for ${material} not found or missing in productsMap`);
        return exists;
    });

    materials.forEach((material, index) => {
        const section = document.getElementById(`${material}-carousel`);
        if (!section) return;

        const carousel = section.querySelector('.carousel');
        const prevBtn = section.querySelector('.prevBtn');
        const nextBtn = section.querySelector('.nextBtn');
        const container = section.querySelector('.carousel-container');

        if (!carousel || !prevBtn || !nextBtn || !container) return;

        carousels.push(carousel);
        prevButtons.push(prevBtn);
        nextButtons.push(nextBtn);
        carouselContainers.push(container);
        carouselIndexMap[material] = 0;

        carousel.innerHTML = '';

        const category = productsMap[material];
        const uniqueProducts = category.categories.filter(
            (product, idx, self) => idx === self.findIndex(p => p.href === product.href)
        );

        uniqueProducts.forEach(product => {
            const item = document.createElement('div');
            item.className = 'carousel-item';
            item.innerHTML = `
<form class="carousel-item-content w-full">
    <img src="${product.img}" alt="${product.name}" title="${product.name}" class="carousel-item-image">
    <div class="carousel-item-details w-full">
        <div class="flex flex-row items-center gap-4 justify-start" style="padding: 8px; padding-left: 0px; min-height: 50px;">
            ${category.img}
            <strong>
                <p class="md:text-lg text-base" style="border-bottom: #009845 2px solid; padding-bottom:4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4;">
                    ${product.name}
                </p>
            </strong>
        </div>
        <div class="md:mt-auto w-full pt-2 pb-2 flex z-50">
            <a href="${product.href}" class="py-2 w-full btn btn-primary justify-center text-sm rounded uppercase font-bold focus:border-primary focus:outline-none focus:ring-0 mr-auto" aria-label="SHOP NOW">
                                <svg class="w-6 h-auto flex-shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 328.8">
                                    <path style="fill:#fff" d="M387.61,142.63h-116.59l-27.11-61.22c3.52-3.46,4.83-8.84,2.9-13.69l-21.21-53.51c-5.22-11.89-17.75-17.11-26.2-12.32l-1.1-.44c-10.5-4.17-20.52,1.02-24.69,11.53l-21.21,53.5c-1.9,4.8-.64,10.1,2.77,13.55l-.26,.18-27.57,62.42H12.45c-.26,0-.52,0-.77,.02-6.5,.29-11.68,4.32-11.68,9.19v6.79c0,5.07,5.99,9.49,12.83,9.49h3.52l52.04,148.59c2.54,7.25,9.38,12.11,17.07,12.11h220.59c7.4,0,14.06-4.52,16.8-11.4l59.16-148.73h5.64c.29,0,.58,0,.86-.03,6.45-.39,11.49-5.17,11.49-10.02v-6.79c0-5.05-5.57-9.19-12.39-9.2Zm-122.93,60.13h-55.65v-34.72h61.02l-5.38,34.72Zm-7.75,50.05h-47.9v-32.17h52.88l-4.98,32.17Zm-119.42-32.17h53.04l-.06,32.17h-48.18l-4.81-32.17Zm33.86-132.76l.09-.5c5.78,1.02,11.72-2.13,13.97-7.79l13.92-35.1,14.41,36.34c2.13,5.36,7.57,8.47,13.06,7.91h0s.06,.17,.09,.28c0,.03,.02,.06,.02,.08,0,0,0,.02,0,.02l24.7,53.53h-104.82l24.55-54.76Zm19.28,80.16l-.06,34.72h-55.76l-5.2-34.72h61.01Zm-146.03,0H111.83l5.05,34.72H56.87l-12.25-34.72Zm19.4,52.6h55.46l4.69,32.17h-49.17l-10.98-32.17Zm29.87,84.25l-12.26-34.21h45.13l4.98,34.21h-37.84Zm56.22,0l-5.12-34.21h45.46l-.06,34.21h-40.28Zm58.91,0v-34.21h45.13l-5.3,34.21h-39.83Zm90.13,0h-32.17l5.39-34.21h39.54l-12.76,34.21Zm20.42-52.08h-44.38l5.08-32.17h52.59l-13.28,32.17Zm21.45-50.05h-57.94l5.47-34.72h66.76l-14.29,34.72Z"/>
                                </svg>
                                <span class="ml-2 inline text-nowrap">SHOP NOW</span></a>
        </div>
    </div>
</form>`;
            carousel.appendChild(item);
        });

        if (uniqueProducts.length <= 1) {
            prevBtn.classList.add('hidden');
            nextBtn.classList.add('hidden');
        }
    });

    function getVisibleItems() {
        if (window.innerWidth <= 500) return 1;
        if (window.innerWidth <= 1280) return 2;
        return 3;
    }

    function getMaxIndex(material) {
        const uniqueCount = productsMap[material].categories.filter(
            (product, idx, self) => idx === self.findIndex(p => p.href === product.href)
        ).length;
        return Math.max(uniqueCount - getVisibleItems(), 0);
    }

    function updateCarousel(material) {
        const idx = materials.indexOf(material);
        const carousel = carousels[idx];
        if (!carousel) return;
        const visibleItems = getVisibleItems();
        const maxIndex = getMaxIndex(material);
        carouselIndexMap[material] = Math.min(carouselIndexMap[material], maxIndex);
        const itemWidth = 100 / visibleItems;
        carousel.style.transform = `translateX(-${carouselIndexMap[material] * itemWidth}%)`;
    }

    function nextProduct(material) {
        const maxIndex = getMaxIndex(material);
        if (carouselIndexMap[material] < maxIndex) {
            carouselIndexMap[material]++;
            updateCarousel(material);
        }
    }

    function prevProduct(material) {
        if (carouselIndexMap[material] > 0) {
            carouselIndexMap[material]--;
            updateCarousel(material);
        }
    }

    materials.forEach((material, index) => {
        const prevBtn = prevButtons[index];
        const nextBtn = nextButtons[index];
        const carouselContainer = carouselContainers[index];

        if (prevBtn && nextBtn) {
            prevBtn.addEventListener('click', () => prevProduct(material));
            nextBtn.addEventListener('click', () => nextProduct(material));
        }

        if (carouselContainer) {
            let touchStartX = 0;
            let isSwiping = false;

            carouselContainer.addEventListener('touchstart', e => {
                touchStartX = e.touches[0].clientX;
                isSwiping = false;
            });
            carouselContainer.addEventListener('touchmove', e => {
                if (isSwiping) return;
                const touchMoveX = e.touches[0].clientX;
                const swipeDistance = touchStartX - touchMoveX;
                const swipeThreshold = window.innerWidth * 0.25;
                if (Math.abs(swipeDistance) > swipeThreshold) {
                    isSwiping = true;
                    swipeDistance > 0 ? nextProduct(material) : prevProduct(material);
                }
            });
            carouselContainer.addEventListener('touchend', () => { isSwiping = false; });
        }
    });

    function updateCarousels() {
        materials.forEach(material => updateCarousel(material));
    }

    window.addEventListener('resize', updateCarousels);
    updateCarousels();
}

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

document.addEventListener("DOMContentLoaded", () => {
  const container = document.querySelector(".intro-container");
  const btn = document.getElementById("readMoreBtn");
  if (!container || !btn) return;
  btn.setAttribute("aria-expanded", "false");
  btn.addEventListener("click", () => {
    const isExpanded = container.classList.toggle("expanded");
    btn.textContent = isExpanded ? "Read Less" : "Read More";
    btn.setAttribute("aria-expanded", isExpanded);
    if (isExpanded) {
      setTimeout(() => {
        container.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 300);
    } else {
      container.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

</script>
