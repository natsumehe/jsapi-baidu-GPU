import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AGVFleetRuntime} from '../public/preview/AGVFleetRuntime.mjs';
const read=p=>JSON.parse(readFileSync(new URL(`../${p}`,import.meta.url),'utf8'));
const defs=read('public/data/simulation/yangshan_phase4/agv_fleet.json').vehicles;
const routes=read('public/data/simulation/yangshan_phase4/agv_routes_gis.json').routes;
const layout=read('public/data/simulation/yangshan_phase4/port_layout.json');
function fleet(){
 const r=new AGVFleetRuntime({localToGeo:p=>({longitude:p.x,latitude:p.y})});
 const slots=defs.map((_,i)=>{const y=layout.yards[i%layout.yards.length];
  return y.containers[Math.floor(i/layout.yards.length)%y.containers.length]?.center??y.center;});
 r.load(defs,new Map(routes.map(v=>[v.agvId,v])),slots,layout.yards.map(y=>y.boundary));return r;
}
test('155 vehicles have >=150 chronological, explicitly synthetic sample records before playback',()=>{
 const r=fleet();assert.equal(r.vehicles.length,155);
 r.vehicles.forEach((_,i)=>{
  const h=r.getHistoryRecords(i);assert.ok(h.length>=150);
  assert.equal(h[0].sample,0);assert.equal(h.at(-1).sample,h.length-1);
  assert.equal(h[0].source,'synthetic-history');
  assert.ok(h.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
 });
 for(let i=0;i<6;i++)r.update(.25);
 const recent=r.getHistoryRecords(0);
 assert.ok(recent.length>150);
 assert.equal(recent.at(-1).source,'live-simulation');
 assert.equal(recent.at(-1).phase,'PARKING');
 assert.deepEqual(r.getHistoryPath(0).at(-1),{x:r.vehicles[0].state.x,y:r.vehicles[0].state.y});
});
test('route choices support tested synthetic QC-to-QC connectors and many-to-many experiment pairings',()=>{
 const r=fleet();const groups=r.vehicles.filter(v=>v.variants.length>=3);
 assert.ok(groups.length>20);
 const v=groups[0],sets=new Set(v.variants.map(o=>o.yardId));assert.ok(sets.size>=3);
 const expanded=groups.filter(v=>v.variants.some(o=>o.syntheticConnector));
 assert.ok(expanded.length>0,'expected validated synthetic cross-QC connectors');
 const yardOrigins=new Map();
 for(const candidate of groups){for(const option of candidate.variants){
   if(!yardOrigins.has(option.yardId))yardOrigins.set(option.yardId,new Set());
   yardOrigins.get(option.yardId).add(candidate.quayCraneId);
 }}
 assert.ok([...yardOrigins.values()].some(s=>s.size>=2),'some gantries serve multiple QC origins');
 const seen=[];
 for(let task=1;task<=Math.min(3,v.variants.length);task++){
  v.taskNumber=task;r.chooseVariant(v);seen.push(v.assignedYardId);
  assert.deepEqual(v.segments[2].points,[...v.segments[1].points].reverse());
 }
 assert.equal(new Set(seen).size,seen.length);
 assert.equal(v.segments[2].phase,'RETURN_QUAY');
 const planned=r.getCurrentRoute(r.vehicles.indexOf(v));assert.ok(planned.length>=6);
});
test('continuous tasks preserve finite acceleration and can be disabled for quay-to-buffer parking',()=>{
 const r=fleet(),v=r.vehicles[2];r.setContinuousWorkload(true);
 assert.ok(r.dispatchTask(v.definition.id));
 assert.equal(v.phaseIndex,0);
 assert.equal(r.getContinuousWorkload(),true);
 for(let i=0;i<60;i++)r.update(.1);
 assert.ok(v.state.speed>=0&&v.state.speed<=v.definition.speedMps+2);
 r.setContinuousWorkload(false);
 let parked=false;
 for(let i=0;i<11000;i++){
  r.update(.3);
  if(v.taskCompleted>0 && !v.active){parked=true;break;}
 }
 assert.ok(parked,'after auto tasks disabled the vehicle finishes then parks');
 assert.equal(v.state.phase,'PARKING');assert.equal(v.state.speed,0);
});
