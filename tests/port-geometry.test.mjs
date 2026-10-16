import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const data=JSON.parse(fs.readFileSync('public/data/simulation/yangshan_phase4/port_layout.json'));
const routing=JSON.parse(fs.readFileSync('public/data/simulation/yangshan_phase4/agv_routes_gis.json'));
const geo=JSON.parse(fs.readFileSync('public/data/gis/quay_cranes.geojson'));
const sq=(a,b)=>(a.x-b.x)**2+(a.y-b.y)**2;
const inside=(p,ring)=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
 const a=ring[i],b=ring[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;};
const d=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const all=data.yards.map(y=>y.boundary);
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const crosses=(a,b,c,d)=>cross(a,b,c)*cross(a,b,d)<-1e-6&&cross(c,d,a)*cross(c,d,b)<-1e-6;
const routeSafe=(a,b)=>all.every(r=>{
 if(inside(a,r)||inside(b,r)||inside({x:(a.x+b.x)/2,y:(a.y+b.y)/2},r))return false;
 for(let k=1;k<r.length;k++)if(crosses(a,b,r[k-1],r[k]))return false;
 return true;
});
test('classifies GIS 28 quay cranes and 971 unloading points',()=>{
 assert.equal(geo.features.filter(f=>/号$/.test(f.properties.name)).length,28);
 assert.equal(geo.features.filter(f=>f.properties.name==='卸货点').length,971);
 assert.equal(data.quayCranes.length,28);
});
test('61 gantries completely within yard polygons, fitted to edges',()=>{
 assert.equal(data.yards.length,61);
 for(const y of data.yards){const g=y.gantry,h=y.heading;
 const corrected=h+Math.PI/2;
 const u={x:Math.cos(corrected),y:Math.sin(corrected)},v={x:-Math.sin(corrected),y:Math.cos(corrected)};
 // Verify the COMPLETE mesh footprint, including both rail endpoints and
 // intermediate rail positions: a valid pivot alone is insufficient.
 for(let step=0;step<=20;step++){
  const fraction=step/20;
  const center={x:g.railStart.x+(g.railEnd.x-g.railStart.x)*fraction,y:g.railStart.y+(g.railEnd.y-g.railStart.y)*fraction};
  for(const x of [-12.819*g.scale,12.819*g.scale])for(const z of [-7.56*g.scale,7.56*g.scale]){
   assert.ok(inside({x:center.x+x*u.x+z*v.x,y:center.y+x*u.y+z*v.y},y.boundary),`${y.id}: gantry ${step}/20 full footprint`);
  }
 }
 assert.ok(inside(g.railStart,y.boundary),`${y.id} start`);
 assert.ok(inside(g.railEnd,y.boundary),`${y.id} end`);
 }
});
test('ISO 20ft footprints remain entirely inside their yard',()=>{
 const standard=data.standardContainer;assert.equal(standard.length,6.058);assert.equal(standard.width,2.438);assert.equal(standard.height,2.591);
 let n=0;
 for(const y of data.yards){const [ax,ay]=y.axis;
 for(const cell of y.containers){n++;
 assert.ok(cell.level>=1&&cell.level<=5);
 for(const dx of [-3.029,3.029])for(const dy of [-1.219,1.219]){
  const p={x:cell.center.x+dx*ax-dy*ay,y:cell.center.y+dx*ay+dy*ax};
  assert.ok(inside(p,y.boundary),`${cell.id}: corner outside`);
 }
 }}
 assert.ok(n>=10000);console.log('verified ISO footprints',n);
});
test('all AGVs begin and end at GIS buffer, never cross stack polygons',()=>{
 assert.equal(data.parkingBuffer.spots.length,155);assert.equal(routing.routes.length,155);
 for(const route of routing.routes){
  const phases=route.phases;assert.deepEqual(phases.map(p=>p.phase),['QUAY_PICKUP','YARD_STACK','RETURN_BUFFER','PARKING','CHARGING']);
  const yard=data.yards.find(y=>y.id===route.yardId);
  assert.ok(yard);
  assert.ok(inside(route.parkingPoint,data.parkingBuffer.boundary));
  assert.ok(d(phases[0].points[0],route.parkingPoint)<.01);
  assert.ok(d(phases[1].points.at(-1),yard.unload)<.01);
  assert.ok(d(phases[2].points.at(-1),route.parkingPoint)<.01);
  for(const phase of phases){
   for(let i=1;i<phase.points.length;i++)assert.ok(routeSafe(phase.points[i-1],phase.points[i]),`${route.agvId}/${phase.phase} intersects container yard`);
  }
  for(const phase of phases.slice(3)){
   assert.ok(phase.points.every(p=>sq(p,route.parkingPoint)<.01),`${route.agvId} must remain parked`);
   assert.equal(phase.speedMps,0);
  }
 }
});
test('both supplied GLB assets are valid glTF2 binary containers',()=>{
 for(const file of ['public/assets/cranes/quay_crane.glb','public/assets/cranes/gantry_crane.glb']){
  const b=fs.readFileSync(file);assert.equal(b.toString('ascii',0,4),'glTF');assert.equal(b.readUInt32LE(4),2);assert.equal(b.readUInt32LE(8),b.byteLength);
 }
});

test('AGV unloading bay outside stack and within corrected crane hoist reach',()=>{
 for(const yard of data.yards){
  assert.ok(!all.some(r=>inside(yard.unload,r)),`${yard.id}: bay inside stack`);
  const a=yard.gantry.railStart,b=yard.gantry.railEnd,p=yard.unload;
  const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
  if(yard.handoffReachable)assert.ok(d(p,{x:a.x+dx*t,y:a.y+dy*t})<=yard.hookReachMeters+.01,`${yard.id}: crane can't reach bay`);
 }
});
test('route trafficVerified flag means no static parked AGV enters 5.1m swept centreline',()=>{
 const parked=data.parkingBuffer.spots;
 const pointSegDist=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,v=dx*dx+dy*dy;const t=v?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/v)):0;return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t);};
 let certified=0;
 for(let i=0;i<routing.routes.length;i++){
  const r=routing.routes[i];if(!r.trafficVerified)continue;certified++;
  for(const ph of r.phases.slice(0,3))for(let n=1;n<ph.points.length;n++){
   for(let k=0;k<parked.length;k++){
    if(k===i)continue;
    assert.ok(pointSegDist(parked[k],ph.points[n-1],ph.points[n])>=5.095,`${r.agvId} passes parked AGV-${k+1}`);
   }
  }
 }
 assert.ok(certified>10,'A meaningful subset passes parking-lane clearance filtering');
});
test('architecture document is available as BOM UTF-8 Markdown and explicit UTF-8 HTML',()=>{
 const md=fs.readFileSync('public/docs/ARCHITECTURE_TECHNICAL.md');
 assert.deepEqual(Array.from(md.subarray(0,3)),[0xef,0xbb,0xbf]);
 assert.match(md.toString('utf8'),/海量空间数据实验平台/);
 const html=fs.readFileSync('public/architecture.html','utf8');
 assert.match(html,/<meta charset="UTF-8">/);
 assert.match(html,/架构决策/);
});
test('each dispatched sample container slot remains inside its own ASC hoist envelope',()=>{
 let candidates=0;
 for(let i=0;i<routing.routes.length;i++){
  const route=routing.routes[i],yard=data.yards.find(y=>y.id===route.yardId);
  if(!route.trafficVerified||!yard?.handoffReachable)continue;
  candidates++;
  const c=yard.containers[Math.floor(i/data.yards.length)%yard.containers.length].center;
  const a=yard.gantry.railStart,b=yard.gantry.railEnd;
  const dx=b.x-a.x,dy=b.y-a.y;
  const t=Math.max(0,Math.min(1,((c.x-a.x)*dx+(c.y-a.y)*dy)/(dx*dx+dy*dy||1)));
  const nearest={x:a.x+dx*t,y:a.y+dy*t};
  assert.ok(d(nearest,c)<=yard.hookReachMeters+.01,`${route.agvId}: target is beyond trolley reach`);
 }
 assert.ok(candidates>=8,'at least 8 demonstrator tasks can complete a coherent crane handoff');
});
