import {GLBAGVLayer} from './renderer/webgl/GLBAGVLayer.js';
import {AGVFleetRuntime} from './AGVFleetRuntime.mjs';
const $=id=>document.getElementById(id);
const [layout,routes]=await Promise.all(['data/simulation/yangshan_phase4/port_layout.json','data/simulation/yangshan_phase4/agv_routes_gis.json'].map(async p=>{const r=await fetch('/'+p);if(!r.ok)throw Error(`Cannot fetch ${p}`);return r.json();}));
const defs=await fetch('/data/simulation/yangshan_phase4/agv_fleet.json').then(r=>r.json());
const availableYards=new Set(layout.yards.filter(y=>y.handoffReachable).map(y=>y.id));
const verifiedRoutes=new Set(routes.routes.filter(r=>r.trafficVerified&&availableYards.has(r.yardId)).map(r=>r.agvId));
const routeMap=new Map(routes.routes.map(r=>[r.agvId,r]));
const yardSlots=defs.vehicles.map((_,i)=>{const yard=layout.yards[i%layout.yards.length];return yard.containers[Math.floor(i/layout.yards.length)%yard.containers.length]?.center??yard.center;});
const coordinateSystem={localToGeo:p=>({longitude:layout.origin[0]+p.x/(6378137*Math.PI/180*Math.cos(layout.origin[1]*Math.PI/180)),latitude:layout.origin[1]+p.y/(6378137*Math.PI/180)})};
let fleet;
let autoWorkload=true;
let selectedTrackIndex=null;
let selectedEntity=null; // A single AGV, QC, Gantry or container highlighted on the canvas
function refillWorkload(initial=false){
 if(!autoWorkload)return 0;
 const target=Math.ceil(defs.vehicles.length*.8),active=fleet.vehicles.filter(v=>v.active).length;
 const moving=fleet.getStats().moving;
 const desired=Math.max(0,Math.min(defs.vehicles.length,Math.max(target,active+target-moving))-active);
 // Balanced departure waves, never a sudden 124-vehicle release.
 return fleet.dispatchDistributed(Math.min(desired,initial?10:7));
}
function initializeFleet(){
 fleet=new AGVFleetRuntime(coordinateSystem);
 fleet.load(defs.vehicles,routeMap,yardSlots,layout.yards.map(y=>y.boundary));
 fleet.setContinuousWorkload(autoWorkload);
 // One-time synthetic scene snapshot: approximately 25% Gantry end,
 // 30% Gantry-side approach or surveyed buffer, 45% quay side.
 // Subsequent frames still obey the original AGV vehicle kinematics.
 const snapshot=fleet.seedLifecycleScene();
 console.info('[Yangshan preview] initial lifecycle distribution',snapshot);
 return Object.values(snapshot.actual).reduce((sum,value)=>sum+value,0);
}
const activeTasks=initializeFleet();
const canvas=$('world'),modelCanvas=$('glCanvas'),ctx=canvas.getContext('2d');
const gl=modelCanvas.getContext('webgl',{alpha:true,premultipliedAlpha:false,antialias:true});
let shore=null,gantry=null,agv=null;
if(gl){shore=new GLBAGVLayer(gl);gantry=new GLBAGVLayer(gl);agv=new GLBAGVLayer(gl);shore.setModelScale(5.2);gantry.setModelScale(1);
 await Promise.all([
  shore.load('/assets/cranes/quay_crane.glb'),gantry.load('/assets/cranes/gantry_crane.glb'),fetch('/assets/agv/agv.glb',{method:'HEAD'}).then(r=>r.ok?agv.load('/assets/agv/agv.glb'):null).catch(()=>null)
 ]);
 $('modelStatus').textContent=`岸桥 ${shore.isLoaded()?'✓':'×'} · Gantry ${gantry.isLoaded()?'✓':'×'} · AGV ${agv.isLoaded()?'✓':'轻量符号'}`;
}else $('modelStatus').textContent='WebGL 不可用；启用矢量降级图层';
$('qcCount').textContent=layout.quayCranes.length;
$('gantryCount').textContent=layout.yards.length;
$('containerCount').textContent=layout.yards.reduce((s,y)=>s+y.containers.reduce((sum,c)=>sum+c.level,0),0).toLocaleString();
const all=layout.yards.flatMap(y=>y.boundary),minX=Math.min(...all.map(p=>p.x)),maxX=Math.max(...all.map(p=>p.x)),minY=Math.min(...all.map(p=>p.y)),maxY=Math.max(...all.map(p=>p.y));
let center={x:(minX+maxX)/2,y:(minY+maxY)/2},zoom=1,baseScale=1,playing=true,seconds=0,last=performance.now(),drag=null;
let gantryTime=0,refillTime=0;
const gantryPositions=layout.yards.map(y=>({...y.gantry.position}));
function updateGantries(dt){gantryTime+=dt;
 for(let i=0;i<layout.yards.length;i++){
  const y=layout.yards[i],a=y.gantry.railStart,b=y.gantry.railEnd,dx=b.x-a.x,dy=b.y-a.y,denom=dx*dx+dy*dy||1;
  const proj=p=>Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/denom));
  const active=fleet.vehicles.find(v=>v.state.yardId===y.id&&v.state.cargoTransferKind==='AGV_TO_YARD'&&y.handoffReachable);
  const t=active?proj(y.unload)+(proj({x:active.state.yardX,y:active.state.yardY})-proj(y.unload))*active.state.cargoTransferProgress : .5+.38*Math.sin(gantryTime*2*Math.PI/120+i*.15);
  const target={x:a.x+dx*t,y:a.y+dy*t},previous=gantryPositions[i];
  const distance=Math.hypot(target.x-previous.x,target.y-previous.y);
  const portion=distance>0?Math.min(1,2*dt/distance):1;
  gantryPositions[i]={x:previous.x+(target.x-previous.x)*portion,y:previous.y+(target.y-previous.y)*portion};
 }
}

const resize=()=>{let w=canvas.clientWidth,h=canvas.clientHeight,dpr=Math.min(2,devicePixelRatio||1);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);modelCanvas.width=canvas.width;modelCanvas.height=canvas.height;baseScale=Math.min((w-80)/(maxX-minX),(h-160)/(maxY-minY));ctx.setTransform(dpr,0,0,dpr,0,0);};
window.addEventListener('resize',resize);resize();
const scale=()=>baseScale*zoom;
const project=p=>({x:canvas.clientWidth/2+(p.x-center.x)*scale(),y:canvas.clientHeight/2-(p.y-center.y)*scale()});
const fromScreen=p=>({x:center.x+(p.x-canvas.clientWidth/2)/scale(),y:center.y-(p.y-canvas.clientHeight/2)/scale()});
const inView=(p,r=100)=>{const q=project(p);return q.x>-r&&q.x<canvas.clientWidth+r&&q.y>-r&&q.y<canvas.clientHeight+r;};
function outline(pts,fill,stroke,width=1){ctx.beginPath();for(let i=0;i<pts.length;i++){const p=project(pts[i]);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);}ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}
function line(pts,color,width=1){ctx.beginPath();pts.forEach((v,i)=>{const p=project(v);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)});ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
function point(p,color,r=2){const q=project(p);ctx.beginPath();ctx.arc(q.x,q.y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}
// Preview and production share one real finite-task kinematic runtime.
function seek(t){initializeFleet();seconds=0;while(seconds<t){const dt=Math.min(.30,t-seconds);fleet.update(dt);seconds+=dt;}}
function drawContainers(){if(scale()<.13)return;
 const reserved=new Set(fleet.vehicles.filter(v=>v.taskCompleted===0).map(v=>`${v.state.yardX.toFixed(3)}:${v.state.yardY.toFixed(3)}`));
 const px=scale(),skip=px<.32?4:px<.48?2:1;
 const colors=['#d26e49','#438eaa','#e1b85c','#65ad91','#c78152'];
 const face=(pts,fill)=>{ctx.beginPath();pts.forEach((v,i)=>{if(i)ctx.lineTo(v.x,v.y);else ctx.moveTo(v.x,v.y)});ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle='#0d2c3a';ctx.lineWidth=.55;ctx.stroke();};
 for(const yard of layout.yards){const [ax,ay]=yard.axis;
 for(let k=0;k<yard.containers.length;k++){if(k%skip)continue;
  const box=yard.containers[k];if(reserved.has(`${box.center.x.toFixed(3)}:${box.center.y.toFixed(3)}`))continue;
  if(!inView(box.center,80))continue;
  const c=box.center,L=3.029,W=1.219;
  const base=[[L,W],[L,-W],[-L,-W],[-L,W]].map(([u,v])=>project({x:c.x+u*ax-v*ay,y:c.y+u*ay+v*ax}));
  const dz=Math.min(18,2.591*px*.52),levels=Math.min(5,Math.max(1,box.level));
  for(let level=0;level<levels;level++){
   const lo=base.map(q=>({x:q.x,y:q.y-level*dz})),hi=base.map(q=>({x:q.x,y:q.y-(level+1)*dz}));
   face([lo[1],lo[2],hi[2],hi[1]],'#254c61');face([lo[2],lo[3],hi[3],hi[2]],'#1a3c50');
   face(hi,colors[(k+level)%5]);
  }
 }
 }
}
function projectionFor(p){const q=project(p),s=scale();return {agvPixelX:q.x,agvPixelY:q.y,eastBasisX:s,eastBasisY:0,northBasisX:0,northBasisY:-s,viewportWidth:canvas.clientWidth,viewportHeight:canvas.clientHeight};}
function renderModels(positions){if(!gl)return;gl.viewport(0,0,modelCanvas.width,modelCanvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
 if(!$('models').checked||scale()<.27)return;
 if(shore?.isLoaded()){let n=0;for(const crane of layout.quayCranes){if(n>=3)break;if(!inView(crane.position))continue;shore.setState({heading:-.24+Math.PI/2});shore.render(projectionFor(crane.position));n++;}}
 if(gantry?.isLoaded()){let n=0;for(let i=0;i<layout.yards.length;i++){if(n>=8)break;const yard=layout.yards[i];if(!inView(gantryPositions[i]))continue;
  const p=gantryPositions[i];
  gantry.setModelScale(yard.gantry.scale);gantry.setState({heading:yard.heading+Math.PI/2});gantry.render(projectionFor(p));n++;}}
 if(agv?.isLoaded()){let n=0;for(let i=0;i<positions.length;i++){if(n>=1)break;const p=positions[i];if(!inView(p))continue;agv.setModelAxisScales(7.2/1667.6943,2.2/250.2114,3.0/373.0405);agv.setState({heading:p.heading});agv.render(projectionFor(p));n++;}}
}
function drawSelectedEntity(){
 if(!selectedEntity)return;
 let world,label='',rise=0;
 if(selectedEntity.kind==='AGV'){
  const vehicle=fleet.vehicles.find(v=>v.state.id===selectedEntity.id);
  if(vehicle){world=vehicle.state;label=selectedEntity.id;}
 }else if(selectedEntity.kind==='QC'){
  const crane=layout.quayCranes.find(q=>`QC-${q.id}`===selectedEntity.id);
  if(crane){world=crane.position;label=selectedEntity.id;}
 }else if(selectedEntity.kind==='ASC'){
  const idx=layout.yards.findIndex(y=>`ASC-${y.id}`===selectedEntity.id);
  if(idx>=0){world=gantryPositions[idx];label=selectedEntity.id;}
 }else if(selectedEntity.kind==='CONTAINER'){
  for(const y of layout.yards){const box=y.containers.find(c=>c.id===selectedEntity.id);
   if(box){world=box.center;label=box.id;rise=box.level*Math.min(18,2.591*scale()*.52);break;}}
 }
 if(!world)return;
 const pos=project(world),x=pos.x,y=pos.y-rise,r=selectedEntity.kind==='CONTAINER'?16:20;
 ctx.save();ctx.shadowColor='#fff176';ctx.shadowBlur=16;
 ctx.strokeStyle='#fff176';ctx.lineWidth=3;
 ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.stroke();
 ctx.shadowBlur=0;ctx.strokeStyle='#173a52';ctx.lineWidth=1.2;
 ctx.beginPath();ctx.arc(x,y,r+4,0,Math.PI*2);ctx.stroke();
 const w=ctx.measureText(label).width;ctx.font='bold 12px sans-serif';
 ctx.fillStyle='rgba(7,25,40,.94)';ctx.fillRect(x-w/2-9,y-r-30,w+18,19);
 ctx.fillStyle='#fff7a8';ctx.fillText(label,x-w/2,y-r-16);
 ctx.restore();
}
function frame(time){const dt=Math.min(.05,(time-last)/1000);last=time;if(playing){const step=dt*5;seconds+=step;fleet.update(step);updateGantries(step);
 refillTime+=step;if(autoWorkload&&refillTime>=1){refillWorkload();refillTime=0;}}

 const v=fleet.vehicles.slice(0,Number($('vehicleCount').value)).map(x=>x.state);
 ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.setTransform(canvas.width/canvas.clientWidth,0,0,canvas.height/canvas.clientHeight,0,0);
 layout.yards.forEach(y=>outline(y.boundary,'rgba(20,116,101,.23)','rgba(83,236,196,.56)',1.1));
 outline(layout.agvTransferZone.boundary,'rgba(73,162,187,.1)','rgba(90,184,235,.35)');
 outline(layout.parkingBuffer.boundary,'rgba(60,110,235,.27)','rgba(89,189,255,.83)',2);
 drawContainers();
 // Four brightly coloured legs of the full transport lifecycle, always on.
 // Synthetic intended routes and actual simulated travel are intentionally separate.
 const lifecycleColors={QUAY_PICKUP:'#1dd6ff',YARD_STACK:'#3cff8e',RETURN_QUAY:'#ffce3e',RETURN_BUFFER:'#d18cff'};
 for(let index=0;index<fleet.vehicles.length;index++){
  if(index===selectedTrackIndex)continue;
  const vehicle=fleet.vehicles[index],legs=fleet.getLifecycleLegs(index);
  ctx.globalAlpha=vehicle.active?.58:.26;
  for(const leg of legs){
   if(leg.points.length>1)line(leg.points,lifecycleColors[leg.phase]??'#b2d9f5',vehicle.active?1.65:1.15);
  }
 }
 ctx.globalAlpha=1;
 for(let index=0;index<fleet.vehicles.length;index++){
  const points=fleet.getTravelledPath(index,2400);
  if(points.length<2)continue;
  const stride=Math.max(1,Math.ceil(points.length/350));const path=points.filter((_,i)=>i%stride===0);
  if(path.at(-1)!==points.at(-1))path.push(points.at(-1));
  line(path,'rgba(255,83,240,.62)',1.5);
 }
 if(selectedTrackIndex!==null){
  for(const leg of fleet.getLifecycleLegs(selectedTrackIndex)){
   if(leg.points.length<2)continue;
   line(leg.points,'rgba(3,11,26,.97)',5.8);
   line(leg.points,lifecycleColors[leg.phase]??'#fff5a2',3.5);
  }
  const points=fleet.getHistoryPath(selectedTrackIndex);
  if(points.length>1){const stride=Math.max(1,Math.ceil(points.length/1200));
   const path=points.filter((_,i)=>i%stride===0);if(path.at(-1)!==points.at(-1))path.push(points.at(-1));
   line(path,'rgba(255,126,246,.99)',3.1);
   for(let i=0;i<points.length;i+=Math.max(1,Math.ceil(points.length/150)))point(points[i],'#f8c5f6',1.5);
  }
 }
 for(const yard of layout.yards){line([yard.gantry.railStart,yard.gantry.railEnd],'rgba(255,218,88,.75)',1.3);point(yard.unload,yard.handoffReachable?'#11ffd7':'#fa6975',2.4);point(gantryPositions[layout.yards.indexOf(yard)],'#ffe1a0',2.4);}
 for(const crane of layout.quayCranes){if(inView(crane.position)){point(crane.position,'#ff845a',3);if(scale()>.3){const q=project(crane.position);ctx.font='11px monospace';ctx.fillStyle='#ffc0a9';ctx.fillText('QC-'+crane.id,q.x+7,q.y-5);}}}
 let standby=0,moving=0;
 for(let i=0;i<v.length;i++){
  const a=v[i],idle=a.phase==='PARKING'||a.phase==='CHARGING';idle?standby++:(a.speed>.03?moving++:standby++);
  // Vehicle rectangle is 7.2m x 3m, box is 6.058m x 2.438m.
  const rotate=(L,W,heading)=>{
    const f=[Math.cos(heading),Math.sin(heading)],side=[-f[1],f[0]];
    return [[-L/2,-W/2],[L/2,-W/2],[L/2,W/2],[-L/2,W/2]].map(([along,across])=>({x:a.x+f[0]*along+side[0]*across,y:a.y+f[1]*along+side[1]*across}));
  };
  if(inView(a,20))outline(rotate(7.2,3.0,a.heading),idle?'#3587be':'#67de8d',idle?'#95d1ef':'#d5ffdb',1);
  if(a.cargoVisible){
    const yard=layout.yards.find(y=>y.id===a.yardId);
    if(a.cargoTransferKind!=='AGV_TO_YARD'||yard?.handoffReachable){
      const c={x:a.cargoX,y:a.cargoY};
      const heading=yard&&a.cargoTransferKind==='AGV_TO_YARD'?Math.atan2(yard.axis[1],yard.axis[0]):a.heading;
      const f=[Math.cos(heading),Math.sin(heading)],side=[-f[1],f[0]];
      const box=[[3.029,1.219],[3.029,-1.219],[-3.029,-1.219],[-3.029,1.219]].map(([along,across])=>({x:c.x+f[0]*along+side[0]*across,y:c.y+f[1]*along+side[1]*across}));
      if(inView(c,18)){
        if(a.cargoTransferKind==='AGV_TO_YARD'&&yard){
          const railA=yard.gantry.railStart,railB=yard.gantry.railEnd;
          const dx=railB.x-railA.x,dy=railB.y-railA.y,denom=dx*dx+dy*dy||1;
          const proj=t=>Math.max(0,Math.min(1,((t.x-railA.x)*dx+(t.y-railA.y)*dy)/denom));
          const t=proj(yard.unload)+(proj({x:a.yardX,y:a.yardY})-proj(yard.unload))*a.cargoTransferProgress;
          line([{x:railA.x+dx*t,y:railA.y+dy*t},c],'#ffe8a4',1);
        }
        outline(box,'#e6a456','#fff0c9',1);
      }
    }
  }
 }
 drawSelectedEntity();
 $('movingCount').textContent=moving;$('standbyCount').textContent=standby;const taskLabel=$('taskCount');if(taskLabel)taskLabel.textContent=fleet.vehicles.filter(v=>v.active).length;$('timeLabel').textContent=seconds.toFixed(1);
 if(playing)$('time').value=Math.min(1800,Math.floor(seconds));renderModels(v);
 requestAnimationFrame(frame);
}
canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,center:{...center}};canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(!drag)return;center={x:drag.center.x-(e.clientX-drag.x)/scale(),y:drag.center.y+(e.clientY-drag.y)/scale()};});
canvas.addEventListener('pointerup',e=>{
 const last=drag;drag=null;if(!last||Math.hypot(e.clientX-last.x,e.clientY-last.y)>5)return;
 const click={x:e.offsetX,y:e.offsetY};const entries=[];
 const add=(kind,id,p,details,threshold=17)=>{const c=project(p),d=Math.hypot(c.x-click.x,c.y-click.y);if(d<threshold)entries.push({kind,id,d,details});};
 const states=fleet.vehicles.slice(0,Number($('vehicleCount').value)).map(v=>v.state);
 states.forEach(s=>add('AGV',s.id,s,[['TAA_AGV_ID',s.id],['TAA_WI_ID',s.hasTask?s.taskId:'无任务'],['TAA_CNTRNO',s.hasTask?s.containerNo:'—'],['TAA_CSIZECD','ISO 20ft'],['速度',`${(s.speed*3.6).toFixed(1)} km/h`],['加速度',`${s.acceleration.toFixed(2)} m/s²`],['任务状态',s.taskStatus],['TAA_FREE_PB_ID',s.parkingSlotId],['避让状态',s.waitingForTraffic?'等待避让':'正常']],23));
 layout.quayCranes.forEach(q=>add('QC',`QC-${q.id}`,q.position,[['TSC_STS_ID',q.id],['TSC_CNTRNO','未接入真实作业记录'],['TSC_WK_STTIME','暂无真实时间'],['位置',`${q.position.x.toFixed(1)}, ${q.position.y.toFixed(1)} m`]]));
 layout.yards.forEach(y=>{
  add('ASC',`ASC-${y.id}`,gantryPositions[layout.yards.indexOf(y)],[['TAC_ASC_ID',`ASC-${y.id}`],['TAC_AREANO',y.id],['TAC_SIDETYPE','AGV 直取交接（非地面卸箱）'],['TAC_FROMLOC',`${y.unload.x.toFixed(1)},${y.unload.y.toFixed(1)}`],['吊具可达',y.handoffReachable?'已验证':'待真实轨道/交接 GIS']]);
  if(scale()>.25)y.containers.forEach(c=>add('CONTAINER',c.id,c.center,[['TSC_CNTRNO',c.id],['TSC_YLOCATION',y.id],['TSC_CSIZECD','ISO 20ft'],['箱体尺寸','6.058 × 2.438 × 2.591 m'],['堆叠层数',`${c.level} / 5`],['堆垛高度',`${(c.level*2.591).toFixed(3)} m`]],Math.max(6,Math.min(12,scale()*4))));
 });
 entries.sort((a,b)=>a.d-b.d);
 const hit=entries[0];if(!hit){$('pickInfo').hidden=true;return;}
 selectedEntity={kind:hit.kind,id:hit.id};
 showPick(hit.kind,hit.id,hit.details);
 if(hit.kind==='AGV')selectTrackById(hit.id);else selectedTrackIndex=null;

});
canvas.addEventListener('wheel',e=>{e.preventDefault();const p=fromScreen({x:e.offsetX,y:e.offsetY});zoom=Math.max(1,Math.min(20,zoom*(e.deltaY<0?1.2:1/1.2)));const newP=fromScreen({x:e.offsetX,y:e.offsetY});center.x+=p.x-newP.x;center.y+=p.y-newP.y;$('zoom').value=zoom;$('zoomLabel').textContent=Math.round(zoom*100)+'%';},{passive:false});
$('zoom').addEventListener('input',e=>{zoom=Number(e.target.value);$('zoomLabel').textContent=Math.round(zoom*100)+'%';});
$('vehicleCount').addEventListener('input',e=>$('vehicleLabel').textContent=e.target.value);
$('play').addEventListener('click',()=>{playing=!playing;$('play').textContent=playing?'暂停':'继续';});
$('reset').addEventListener('click',()=>{center={x:(minX+maxX)/2,y:(minY+maxY)/2};zoom=1;$('zoom').value=1;$('zoomLabel').textContent='100%';});
$('time').addEventListener('input',e=>{playing=false;$('play').textContent='继续';seek(Number(e.target.value));});
requestAnimationFrame(frame);

const toggle=$('autoWorkload');if(toggle)toggle.addEventListener('click',()=>{autoWorkload=!autoWorkload;fleet.setContinuousWorkload(autoWorkload);toggle.textContent=autoWorkload?'暂停自动派工':'开启自动派工';});

function selectTrackById(id){
 selectedTrackIndex=fleet.vehicles.findIndex(v=>v.state.id===id);
 if(selectedTrackIndex<0)return;
 const h=fleet.getHistoryRecords(selectedTrackIndex,3600);
 const container=$('previewTrackHistory');if(!container)return;
 container.hidden=false;container.replaceChildren();
 const title=document.createElement('strong');title.textContent=`模拟历史轨迹：${h.length} 条采样`;
 const button=document.createElement('button');button.textContent='导出轨迹 CSV';button.onclick=()=>{
  const rows=['sample,seconds,x,y,speedMps,phase,source',...h.map(p=>[p.sample,p.simulatedSeconds,p.x,p.y,p.speedMps,p.phase,p.source].join(','))];
  const blob=new Blob(['\uFEFF',rows.join('\r\n')],{type:'text/csv;charset=utf-8'}),link=document.createElement('a');
  link.href=URL.createObjectURL(blob);link.download=id+'-history.csv';link.click();URL.revokeObjectURL(link.href);
 };
 const table=document.createElement('table');table.style='width:100%;font-size:10px';
 for(const p of [...h].slice(-300).reverse()){
  const tr=document.createElement('tr');for(const value of [p.sample,p.phase,p.x.toFixed(1),p.y.toFixed(1)]){
   const cell=document.createElement('td');cell.textContent=String(value);cell.style.padding='3px';tr.append(cell);
  }table.append(tr);
 }
 container.append(title,button,table);
}
function showPick(kind,id,details){
 if(kind!=='AGV'){$('previewTrackHistory').hidden=true;selectedTrackIndex=null;}
 $('pickInfo').hidden=false;$('pickTitle').textContent=`${kind} · ${id}`;
 const dl=$('pickFields');dl.replaceChildren();details.forEach(([k,v])=>{
  const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=String(k);dd.textContent=String(v);dl.append(dt,dd);
 });
}
let previewTab='AGV';
function updatePreviewBrowser(){
 const rows=$('previewFleetRows');if(!rows)return;rows.replaceChildren();
 const filter=$('previewFleetSearch').value.toLowerCase();
 let entries=[];
 if(previewTab==='AGV')entries=fleet.vehicles.map(v=>({id:v.state.id,info:`${v.state.taskStatus} · ${(v.state.speed*3.6).toFixed(1)} km/h`,select:()=>{
  const s=v.state;selectedEntity={kind:'AGV',id:s.id};selectTrackById(s.id);showPick('AGV',s.id,[['TAA_AGV_ID',s.id],['TAA_WI_ID',s.hasTask?s.taskId:'无任务'],['TAA_CNTRNO',s.hasTask?s.containerNo:'—'],['TAA_FREE_PB_ID',s.parkingSlotId],['速度',`${(s.speed*3.6).toFixed(1)} km/h`],['避让状态',s.waitingForTraffic?'停车避让':'正常'],['任务状态',s.taskStatus]]);
 }}));
 else if(previewTab==='QC')entries=layout.quayCranes.map(q=>({id:`QC-${q.id}`,info:'岸桥 GIS 点位',select:()=>{selectedEntity={kind:'QC',id:`QC-${q.id}`};showPick('QC',`QC-${q.id}`,[['TSC_STS_ID',q.id],['TSC_CNTRNO','无真实 CSV'],['GIS',`${q.position.x},${q.position.y}`]]);}}));
 else if(previewTab==='ASC')entries=layout.yards.map(y=>({id:`ASC-${y.id}`,info:y.handoffReachable?'可达模拟':'待轨道标定',select:()=>{selectedEntity={kind:'ASC',id:`ASC-${y.id}`};showPick('ASC',`ASC-${y.id}`,[['TAC_ASC_ID',`ASC-${y.id}`],['TAC_AREANO',y.name],['TAC_SIDETYPE','AGV 直取交接，无地面卸箱']]);}}));
 else entries=layout.yards.flatMap(y=>y.containers.map(c=>({id:c.id,info:`${y.id} · ${c.level}/5 层`,select:()=>{selectedEntity={kind:'CONTAINER',id:c.id};showPick('CONTAINER',c.id,[['TSC_CNTRNO',c.id],['TSC_YLOCATION',y.id],['TSC_CSIZECD','20ft'],['层数',`${c.level}/5`],['堆垛高度',`${(c.level*2.591).toFixed(3)} m`]]);}})));
 let shown=0,matched=0;for(const e of entries){if(filter&&!`${e.id} ${e.info}`.toLowerCase().includes(filter))continue;matched++;if(shown++>=180)continue;
  const b=document.createElement('button');const n=document.createElement('span');n.textContent=e.id;const info=document.createElement('small');info.textContent=e.info;b.append(n,info);b.onclick=e.select;rows.append(b);
 }
 if(matched>180){const note=document.createElement('small');note.textContent=`共匹配 ${matched} 条，展示前 180 条，可搜索设备编号`;rows.append(note);}
}
const browser=$('previewFleetBrowser');
$('openPreviewFleet').addEventListener('click',()=>{browser.hidden=!browser.hidden;if(!browser.hidden)updatePreviewBrowser();});
$('openPreviewFleet').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('openPreviewFleet').click();}});
$('previewFleetClose').addEventListener('click',()=>browser.hidden=true);
$('previewFleetSearch').addEventListener('input',updatePreviewBrowser);
for(const button of browser.querySelectorAll('[data-kind]'))button.addEventListener('click',()=>{previewTab=button.dataset.kind;updatePreviewBrowser();});


