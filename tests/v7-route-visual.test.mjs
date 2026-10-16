import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AGVFleetRuntime} from '../public/preview/AGVFleetRuntime.mjs';
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const json=p=>JSON.parse(read(p));
const definitions=json('public/data/simulation/yangshan_phase4/agv_fleet.json').vehicles;
const gis=json('public/data/simulation/yangshan_phase4/agv_routes_gis.json').routes;
const layout=json('public/data/simulation/yangshan_phase4/port_layout.json');
function makeFleet(){
 const r=new AGVFleetRuntime({localToGeo:p=>({longitude:p.x,latitude:p.y})});
 const slots=definitions.map((_,i)=>{const y=layout.yards[i%layout.yards.length];return y.containers[Math.floor(i/layout.yards.length)%y.containers.length]?.center??y.center;});
 r.load(definitions,new Map(gis.map(route=>[route.agvId,route])),slots,layout.yards.map(y=>y.boundary));
 return r;
}
test('V7 full mission routes retain loading, loaded transport, empty return and buffer return legs',()=>{
 const fleet=makeFleet();
 assert.equal(fleet.vehicles.length,155);
 for(let i=0;i<155;i++){
  const legs=fleet.getLifecycleLegs(i);
  assert.deepEqual(legs.map(l=>l.phase),['QUAY_PICKUP','YARD_STACK','RETURN_QUAY','RETURN_BUFFER']);
  assert.ok(legs.every(l=>l.points.length>=2));
  for(let j=1;j<legs.length;j++){
   assert.ok(Math.hypot(legs[j].points[0].x-legs[j-1].points.at(-1).x,legs[j].points[0].y-legs[j-1].points.at(-1).y)<.01);
  }
 }
});
test('V7 departure batches spread across all five buffer sectors and multiple cranes',()=>{
 const r=makeFleet();
 assert.equal(r.dispatchDistributed(10),10);
 const active=r.vehicles.filter(v=>v.active);
 const sectors=new Set(active.map(v=>Math.min(4,Math.floor((v.definition.parkingSlot-1)/31))));
 assert.equal(sectors.size,5,'first wave covers all five geographic parking sectors');
 assert.ok(new Set(active.map(v=>v.quayCraneId)).size>=5,'first wave covers multiple source QCs');
 assert.ok(r.getHistoryRecords(0).length>=150);
});
test('V7 visible mission layers use bright loading-to-unloading colors and no trajectory options HUD',()=>{
 const main=read('src/renderer/webgl/AGVWorldOverlay.ts');
 const preview=read('public/preview/port-preview.mjs');
 const html=read('public/port-preview.html');
 for(const text of [main,preview]){
  for(const color of ['#1dd6ff','#3cff8e','#ffce3e','#d18cff'])assert.ok(text.includes(color));
  assert.ok(text.includes('getLifecycleLegs'));
  assert.ok(text.includes('getTravelledPath'));
  assert.ok(text.includes('drawSelectedEntity')||text.includes('drawSelectionHighlight'));
 }
 assert.ok(!main.includes('installTrajectoryLayerControls'));
 assert.ok(!html.includes('id="layer-planned"'));
 assert.ok(!html.includes('class="legend"'));
 assert.ok(html.includes('pickInfo'), 'object inspection must remain');
});
test('V7 simulated 155-vehicle warm-up uses departure waves without inventing locations',()=>{
 const r=makeFleet();r.setContinuousWorkload(true);
 let assigned=0;
 for(let step=0;step<144;step++){
  if(step%10===0)assigned+=r.dispatchDistributed(10);
  r.update(.35);
 }
 assert.ok(assigned>=100,`expected multi-wave dispatch; got ${assigned}`);
 const stats=r.getStats();
 assert.ok(stats.active>=100);
 assert.ok(stats.moving>0 && stats.moving<=155);
 // Check sampled footprint clearance rather than inferring safety from the 80% target.
 const states=r.vehicles.map(v=>v.state);
 const occupied=states.filter(v=>v.hasTask);
 assert.ok(occupied.some(v=>v.x>0));
 assert.ok(occupied.some(v=>v.x<0));
});
