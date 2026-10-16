import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const require=createRequire(import.meta.url);
let ts;try{ts=require('typescript');}catch{ts=require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript'));}
const source=fs.readFileSync('src/data/runtime/AGVFleetRuntime.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const exports={};vm.runInNewContext(js,{exports,require:()=>{throw Error('Runtime import should be erased because it is type-only');}});
const {AGVFleetRuntime}=exports;
const definitions=JSON.parse(fs.readFileSync('public/data/simulation/yangshan_phase4/agv_fleet.json')).vehicles;
const gis=JSON.parse(fs.readFileSync('public/data/simulation/yangshan_phase4/agv_routes_gis.json')).routes;
const layout=JSON.parse(fs.readFileSync('public/data/simulation/yangshan_phase4/port_layout.json'));
const routes=new Map(gis.map(r=>[r.agvId,r]));
const yardSlots=definitions.map((d,i)=>{const y=layout.yards[i%layout.yards.length];return y.containers[Math.floor(i/layout.yards.length)%y.containers.length].center;});
const coordinateSystem={localToGeo:p=>({longitude:122+p.x/1e5,latitude:30+p.y/1e5})};
function fleet(){const f=new AGVFleetRuntime(coordinateSystem);f.load(definitions,routes,yardSlots);return f;}
test('all 155 AGVs start parked in distinct GIS buffer slots and never move without tasks',()=>{
 const f=fleet();const orig=f.vehicles.map(v=>({x:v.state.x,y:v.state.y}));
 assert.equal(f.getStats().parking,155);
 for(let i=0;i<20;i++)f.update(.3);
 f.vehicles.forEach((v,i)=>{assert.equal(v.state.phase,'PARKING');assert.equal(v.state.speed,0);assert.equal(v.state.cargoStatus,'EMPTY');assert.equal(v.state.x,orig[i].x);assert.equal(v.state.y,orig[i].y);});
});
test('dispatch starts kinematic finite task and never teleports or accelerates instantly',()=>{
 const f=fleet();assert.ok(f.dispatchTask(definitions[0].id));assert.equal(f.dispatchTask(definitions[0].id),false);
 let prev=f.vehicles[0].state;let moved=false;
 for(let i=0;i<100;i++){f.update(.05);const state=f.vehicles[0].state;
  assert.ok(Math.abs(state.speed-prev.speed)<=.12,`speed jump ${state.speed-prev.speed}`);
  assert.ok(Math.hypot(state.x-prev.x,state.y-prev.y)<=.5,`teleport`);
  if(state.speed>.05)moved=true;
  prev=state;
 }
 assert.ok(moved,'vehicle accelerates from rest after task issued');
 assert.ok(f.getPendingCount()>=154);
});
test('task has an explicit completion path that parks the AGV again',()=>{
 const f=fleet();const chosen=2;const id=definitions[chosen].id;
 f.dispatchTask(id);
 let returned=false;
 for(let i=0;i<10000;i++){
  f.update(.30);const s=f.vehicles[chosen].state;
  if(s.phase==='PARKING'&&s.taskCompleted>0){returned=true;break;}
 }
 const s=f.vehicles[chosen].state;
 assert.ok(returned,'should complete finite pickup/transport/return in simulated 3000s');
 assert.equal(s.speed,0);assert.equal(s.hasTask,false);
 assert.equal(s.cargoVisible,false);assert.equal(s.taskStatus,'PARKING');
 assert.ok(Math.hypot(s.x-gis[chosen].parkingPoint.x,s.y-gis[chosen].parkingPoint.y)<.01);
});
test('mixed fleet applies speed-independent physical separation with parked vehicles',()=>{
 const f=fleet();const eligible=gis.filter(r=>r.trafficVerified&&layout.yards.some(y=>y.id===r.yardId&&y.handoffReachable)).slice(0,7);
 for(const r of eligible)assert.ok(f.dispatchTask(r.agvId));
 let smallest=Infinity,observedMoving=false;
 for(let step=0;step<1800;step++){
  f.update(.3);
  const active=f.vehicles.filter(v=>v.active);
  for(const moving of active){if(moving.state.speed>.1)observedMoving=true;
   for(const other of f.vehicles){if(other===moving)continue;
    const d=Math.hypot(moving.state.x-other.state.x,moving.state.y-other.state.y);
    smallest=Math.min(smallest,d);
   }
  }
 }
 assert.ok(observedMoving,'at least one vehicle transports cargo');
 assert.ok(smallest>4.8,`minimum approximate vehicle centre clearance: ${smallest.toFixed(3)} m`);
 console.log('7-vehicle scenario minimum centre separation (m)',smallest.toFixed(2),'finished tasks',f.vehicles.filter(v=>v.taskCompleted>0).length);
});
