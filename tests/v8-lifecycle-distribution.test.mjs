import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AGVFleetRuntime} from '../public/preview/AGVFleetRuntime.mjs';
const json=path=>JSON.parse(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'));
const defs=json('public/data/simulation/yangshan_phase4/agv_fleet.json').vehicles;
const routes=json('public/data/simulation/yangshan_phase4/agv_routes_gis.json').routes;
const layout=json('public/data/simulation/yangshan_phase4/port_layout.json');
function makeFleet(){
 const fleet=new AGVFleetRuntime({localToGeo:p=>({longitude:p.x,latitude:p.y})});
 const slots=defs.map((_,i)=>{const yard=layout.yards[i%layout.yards.length];return yard.containers[Math.floor(i/layout.yards.length)%yard.containers.length]?.center??yard.center;});
 fleet.load(defs,new Map(routes.map(route=>[route.agvId,route])),slots,layout.yards.map(y=>y.boundary));return fleet;
}
function footprintConflict(a,b){
 const fa={x:Math.cos(a.heading),y:Math.sin(a.heading)}, sa={x:-fa.y,y:fa.x};
 const fb={x:Math.cos(b.heading),y:Math.sin(b.heading)}, sb={x:-fb.y,y:fb.x};
 const delta={x:b.x-a.x,y:b.y-a.y},dot=(u,v)=>u.x*v.x+u.y*v.y;
 for(const axis of [fa,sa,fb,sb]){
  const ra=3.6*Math.abs(dot(fa,axis))+1.5*Math.abs(dot(sa,axis));
  const rb=3.6*Math.abs(dot(fb,axis))+1.5*Math.abs(dot(sb,axis));
  if(Math.abs(dot(delta,axis))>ra+rb+.65)return false;
 }return true;
}
function noOverlaps(fleet){
 const states=fleet.vehicles.map(v=>v.state);
 for(let i=0;i<states.length;i++)for(let j=i+1;j<states.length;j++){
  assert.equal(footprintConflict(states[i],states[j]),false,`Vehicles ${i} and ${j} overlap`);
 }
}
test('V8 distribution is 25% Gantry, 30% Gantry-side/buffer, 45% quay for 155 AGVs',()=>{
 const fleet=makeFleet();
 const data=fleet.seedLifecycleScene();
 assert.deepEqual(data.target,{GANTRY_END:39,GANTRY_SIDE_BUFFER:46,QUAY_SIDE:70});
 assert.deepEqual(data.actual,data.target);
 assert.equal(data.unplaced,0);
 assert.equal(fleet.vehicles.length,155);
 assert.ok(data.parked>0,'real GIS buffer slots retain idle vehicles');
 assert.deepEqual(fleet.getInitialSceneDistribution(),data.actual);
});
test('V8 positions are on the entire validated synthetic mission, no teleports or overlapping vehicle footprints',()=>{
 const fleet=makeFleet();fleet.seedLifecycleScene();noOverlaps(fleet);
 for(const v of fleet.vehicles){
  const state=v.state;
  if(!v.active){assert.equal(state.phase,'PARKING');continue;}
  const seg=v.segments[v.phaseIndex];const p=seg.points;
  assert.ok(p.length>=2);
  assert.ok(v.distance>=0&&v.distance<=v.phaseDistances[v.phaseIndex]);
  assert.ok(state.x>=Math.min(...p.map(q=>q.x))-1&&state.x<=Math.max(...p.map(q=>q.x))+1);
  assert.ok(state.y>=Math.min(...p.map(q=>q.y))-1&&state.y<=Math.max(...p.map(q=>q.y))+1);
 }
 // Each cohort spans a large share of the real GIS buffer longitudinal range.
 for(const zone of ['GANTRY_END','GANTRY_SIDE_BUFFER','QUAY_SIDE']){
  const xs=fleet.vehicles.filter(v=>v.initialSceneZone===zone).map(v=>v.state.x);
  assert.ok(Math.max(...xs)-Math.min(...xs)>1500,`${zone} is clustered instead of spread`);
 }
});
test('V8 keeps full four-phase task trajectories and collision checks during simulated running',()=>{
 const fleet=makeFleet();fleet.seedLifecycleScene();fleet.setContinuousWorkload(true);
 for(const v of fleet.vehicles){
  assert.deepEqual(fleet.getLifecycleLegs(fleet.vehicles.indexOf(v)).map(leg=>leg.phase),[
   'QUAY_PICKUP','YARD_STACK','RETURN_QUAY','RETURN_BUFFER'
  ]);
 }
 for(let i=0;i<240;i++){fleet.update(.1);if(i%80===0)noOverlaps(fleet);}
 noOverlaps(fleet);
 assert.ok(fleet.getStats().moving>50,'vehicles should move instead of remaining in staged screenshot positions');
 assert.throws(()=>fleet.seedLifecycleScene(),/only once/);
});
test('V8 primary and offline preview use one shared scenario seeding method',()=>{
 const main=readFileSync(new URL('../src/renderer/webgl/AGVWorldOverlay.ts',import.meta.url),'utf8');
 const preview=readFileSync(new URL('../public/preview/port-preview.mjs',import.meta.url),'utf8');
 for(const code of [main,preview])assert.ok(code.includes('.seedLifecycleScene()'));
 assert.ok(!main.includes('for(let step=0;step<144;step++)'));
 assert.ok(!preview.includes('for(let step=0;step<144;step++)'));
});
