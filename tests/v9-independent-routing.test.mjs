import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AGVFleetRuntime} from '../public/preview/AGVFleetRuntime.mjs';
const read=p=>JSON.parse(readFileSync(new URL(`../${p}`,import.meta.url),'utf8'));
const defs=read('public/data/simulation/yangshan_phase4/agv_fleet.json').vehicles;
const routes=read('public/data/simulation/yangshan_phase4/agv_routes_gis.json').routes;
const layout=read('public/data/simulation/yangshan_phase4/port_layout.json');
const length=(p,q)=>Math.hypot(p.x-q.x,p.y-q.y);
function fleet(){
  const f=new AGVFleetRuntime({localToGeo:p=>({longitude:p.x,latitude:p.y})});
  const slots=defs.map((_,i)=>{const y=layout.yards[i%layout.yards.length];return y.containers[Math.floor(i/layout.yards.length)%y.containers.length]?.center??y.center});
  f.load(defs,new Map(routes.map(r=>[r.agvId,r])),slots,layout.yards.map(y=>y.boundary));return f;
}
function continuous(v){
  for(let i=0;i<3;i++)assert.ok(length(v.segments[i].points.at(-1),v.segments[i+1].points[0])<.05,
   `${v.definition.id} has a disconnected phase ${i}`);
  assert.ok(length(v.segments[3].points.at(-1),v.homePickup.points[0])<.05);
}
test('V9: each of 155 AGVs has its own pickup origin, unique plan ID, complete continuous task path',()=>{
  const f=fleet();const ids=new Set(),starts=new Set();
  f.vehicles.forEach((v,i)=>{
    assert.ok(f.dispatchTask(v.definition.id));
    continuous(v);
    assert.deepEqual(f.getLifecycleLegs(i).map(x=>x.phase),['QUAY_PICKUP','YARD_STACK','RETURN_QUAY','RETURN_BUFFER']);
    assert.ok(v.assignedRouteId.startsWith(`PLAN-${v.definition.id}-1-`));
    ids.add(v.assignedRouteId); starts.add(`${v.segments[0].points[0].x},${v.segments[0].points[0].y}`);
    assert.ok(v.segments[0].points.length>=2);
    assert.ok(f.getCurrentRoute(i).length>=6);
  });
  assert.equal(ids.size,155);
  assert.equal(starts.size,155);
});
test('V9: each AGV replans multiple different assignments without disconnected QC/Gantry handoffs',()=>{
  const f=fleet();let changed=0,quaysChanged=0;
  for(const v of f.vehicles){
    const yards=new Set(),qcs=new Set();
    for(let n=1;n<=Math.min(5,v.variants.length);n++){
      v.taskNumber=n;f.chooseVariant(v);continuous(v);
      yards.add(v.assignedYardId);qcs.add(v.quayCraneId);
      assert.ok(v.segments[2].points.length===v.segments[1].points.length);
      assert.deepEqual(v.segments[2].points,[...v.segments[1].points].reverse());
    }
    if(yards.size>1)changed++;
    if(qcs.size>1)quaysChanged++;
  }
  assert.ok(changed>=145,`Only ${changed} vehicles changed yard`);
  assert.ok(quaysChanged>0,'some tasks should also change pickup QC');
});
test('V9: when a continuous job finishes at a QC, replanning starts from exactly that QC without teleporting',()=>{
  const f=fleet();f.setContinuousWorkload(true);
  let checked=0;
  for(const v of f.vehicles.slice(0,50)){
    v.taskNumber=1;f.chooseVariant(v);v.active=true;v.phaseIndex=2;
    v.distance=v.phaseDistances[2];v.speed=0;v.dwell=0;
    const position=v.segments[2].points.at(-1);
    v.state=f.makeState(v,position,1);
    f.stepVehicle(v,.02);
    assert.equal(v.phaseIndex,0,'next task must begin with an individual pickup path');
    assert.ok(length(position,v.segments[0].points[0])<.05,'AGV must not jump to another QC');
    assert.equal(v.taskCompleted,1);
    assert.equal(v.taskNumber,2);
    continuous(v);
    checked++;
  }
  assert.equal(checked,50);
});
test('V9: independent route planner is mirrored in the offline preview',()=>{
 const source=readFileSync(new URL('../src/data/runtime/AGVFleetRuntime.ts',import.meta.url),'utf8');
 const preview=readFileSync(new URL('../public/preview/AGVFleetRuntime.mjs',import.meta.url),'utf8');
 for(const s of [source,preview]){
  assert.ok(s.includes('findQuayPath('));assert.ok(s.includes('corridorCost('));
  assert.ok(s.includes('PLAN-'));
 }
});
