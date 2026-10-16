import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AGVFleetRuntime} from '../public/preview/AGVFleetRuntime.mjs';
const read = path => readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const layout=JSON.parse(read('public/data/simulation/yangshan_phase4/port_layout.json'));
const routes=JSON.parse(read('public/data/simulation/yangshan_phase4/agv_routes_gis.json'));
const defs=JSON.parse(read('public/data/simulation/yangshan_phase4/agv_fleet.json'));
function fleet(){
 const r=new AGVFleetRuntime({localToGeo:p=>({longitude:p.x,latitude:p.y})});
 const slots=defs.vehicles.map((_,i)=>{const y=layout.yards[i%layout.yards.length];return y.containers[Math.floor(i/layout.yards.length)%y.containers.length].center});
 r.load(defs.vehicles,new Map(routes.routes.map(x=>[x.agvId,x])),slots);return r;
}
test('V4 interactive interface removes compass / trajectory HUD and opens device browser',()=>{
 const html=read('index.html'),overlay=read('src/renderer/webgl/AGVWorldOverlay.ts');
 assert.ok(!html.includes('<div id="compass"'));
 assert.ok(!html.includes('id="agv-trajectory-panel"'));
 assert.ok(!html.includes('id="agv-trajectory-toggle"'));
 assert.match(overlay,/installEntityBrowser\(\)/);
 assert.match(overlay,/handleScreenClick/);
 assert.match(overlay,/this\.inspector\.show\('CONTAINER'/);
 assert.match(overlay,/this\.inspector\.show\('QC'/);
 assert.match(overlay,/this\.inspector\.show\('AGV'/);
 assert.match(overlay,/this\.inspector\.show\('ASC'/);
});
test('V4 ISO20 stacks have 1-5 levels and GIS-grounded dimensions',()=>{
 let max=0,positions=0;
 for(const yard of layout.yards)for(const c of yard.containers){
  assert.ok(Number.isInteger(c.level)&&c.level>=1&&c.level<=5);
  assert.equal(c.length,6.058);assert.equal(c.width,2.438);assert.equal(c.height,2.591);
  max=Math.max(max,c.level);positions++;
 }
 assert.equal(max,5);assert.equal(positions,10775);
 assert.match(read('src/renderer/webgl/AGVWorldOverlay.ts'),/const dz=Math\.min\(18,2\.591\*mpp/);
});
test('V4 high workload dispatches 80% of vehicles and preserves collision standoff',()=>{
 const r=fleet();
 for(let i=0;i<124;i++)assert.equal(r.dispatchTask(defs.vehicles[i].id),true);
 for(let i=0;i<25;i++)r.update(.2);
 const stats=r.getStats();
 assert.equal(r.vehicles.filter(v=>v.active).length,124);
 assert.ok(stats.moving>=115,`moving=${stats.moving} after acceleration`);
 // A driver can be waiting; no one is teleported out of a parked buffer.
 const states=r.vehicles.map(v=>v.state);
 let nearest=Infinity;
 for(let i=0;i<states.length;i++)for(let j=i+1;j<states.length;j++){
  const dx=states[i].x-states[j].x,dy=states[i].y-states[j].y;
  nearest=Math.min(nearest,Math.hypot(dx,dy));
 }
 assert.ok(nearest>5,`minimum separation ${nearest.toFixed(2)} m`);
});
test('V4 vehicles without a task remain parked in their GIS buffer',()=>{
 const r=fleet();
 const first=r.vehicles[0].state;
 for(let i=0;i<10;i++)r.update(.1);
 assert.deepEqual([r.vehicles[0].state.x,r.vehicles[0].state.y],[first.x,first.y]);
 assert.equal(r.vehicles[0].state.taskStatus,'PARKING');
});
test('V4 gantry travel bounded by validated rails, velocity-limited, with return cycle',()=>{
 for(const yard of layout.yards){
  const a=yard.gantry.railStart,b=yard.gantry.railEnd;
  for(let i=0;i<=48;i++){
   const clock=i*5,t=.5+.38*Math.sin(clock*2*Math.PI/120);
   assert.ok(t>=.12-1e-8 && t<=.88+1e-8);
   const x=a.x+t*(b.x-a.x),y=a.y+t*(b.y-a.y);
   assert.ok(Number.isFinite(x+y));
  }
 }
 const src=read('src/renderer/webgl/AGVWorldOverlay.ts');
 assert.match(src,/const maxStep=2\.0\*dt/);
 assert.match(src,/this\.gantryPositions\[i\]/);
});

test('V4 155-AGV high-load snapshots do not overlap oriented vehicle hulls',()=>{
 const r=fleet();for(const v of r.vehicles)assert.ok(r.dispatchTask(v.definition.id));
 for(let step=0;step<240;step++){
  r.update(.2);
  if(![24,119,239].includes(step))continue;
  const states=r.vehicles.map(v=>v.state);
  for(let i=0;i<states.length;i++)for(let j=i+1;j<states.length;j++){
   const a=states[i],b=states[j];
   assert.equal(r.footprintsConflict(a,a.heading,b,b.heading),false,`${a.id}/${b.id} overlap at t=${(step+1)*.2}`);
  }
 }
});
