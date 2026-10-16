import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SpatialRecordDecoder} from '../lab/stream-codec.mjs';
import {pointFor} from '../lab/dataset.mjs';
import {AGVFleetRuntime} from '../public/preview/AGVFleetRuntime.mjs';
const json=p=>JSON.parse(readFileSync(new URL(`../${p}`,import.meta.url),'utf8'));
const defs=json('public/data/simulation/yangshan_phase4/agv_fleet.json').vehicles;
const routes=json('public/data/simulation/yangshan_phase4/agv_routes_gis.json').routes;
const layout=json('public/data/simulation/yangshan_phase4/port_layout.json');
function fleet(){const r=new AGVFleetRuntime({localToGeo:p=>({longitude:p.x,latitude:p.y})});
 const slots=defs.map((_,i)=>{const y=layout.yards[i%layout.yards.length];return y.containers[Math.floor(i/layout.yards.length)%y.containers.length]?.center??y.center;});
 r.load(defs,new Map(routes.map(x=>[x.agvId,x])),slots,layout.yards.map(y=>y.boundary));return r;
}
test('V6 history is at least 600 simulated points including different yard assignments',()=>{
 const r=fleet();assert.equal(r.vehicles.length,155);
 const diversified=r.vehicles.filter(v=>new Set(v.history.map(p=>p.taskId)).size===3);
 assert.equal(diversified.length,155);
 for(let i=0;i<155;i++){
  const h=r.getHistoryRecords(i);assert.equal(h.length,600);assert.equal(h.at(-1).sample,599);
  assert.equal(r.getTravelledPath(i).length,0,'synthetic history must NOT be misreported as actually travelled');
 }
 r.dispatchBatch(50);for(let step=0;step<20;step++)r.update(.35);
 assert.ok(r.vehicles.some((_,i)=>r.getTravelledPath(i).length>2));
});
test('route diversity is stable, permuted and nonrepeat over available yard choices',()=>{
 const a=fleet(),b=fleet();const va=a.vehicles.find(v=>v.variants.length>=4);
 const vb=b.vehicles.find(v=>v.definition.id===va.definition.id);
 const choices=[];
 for(let step=1;step<=va.variants.length;step++){
  va.taskNumber=step;vb.taskNumber=step;a.chooseVariant(va);b.chooseVariant(vb);
  choices.push(va.assignedYardId);assert.equal(va.assignedYardId,vb.assignedYardId);
 }
 assert.equal(new Set(choices).size,va.variants.length);
});
test('YSL1 decoder accepts fragmented headers and torn nine-byte records without loss',()=>{
 const all=readFileSync(new URL('../public/data/lab/abstract_mixed_1m.ysl',import.meta.url));
 const decoder=new SpatialRecordDecoder(13),outputs=[];
 // Cut at arbitrary locations, including inside header and inside records.
 let end=0;const prefixSize=3012;
 while(end<prefixSize){const n=Math.min(prefixSize-end,1+(end%37)),next=end+n;
  outputs.push(...decoder.push(all.subarray(end,next)));end=next;}
 let total=0;
 for(const chunk of outputs){assert.equal(chunk.start,total);total+=chunk.count;
  for(let i=0;i<chunk.count;i++){
   const [x,y,kind]=pointFor(chunk.start+i);assert.ok(Math.abs(chunk.positions[i*2]-x)<.0003);
   assert.ok(Math.abs(chunk.positions[i*2+1]-y)<.0003);assert.equal(chunk.types[i],kind);
  }
 }
 assert.equal(total,Math.floor((prefixSize-12)/9));
 assert.equal(decoder.total,1000000);
});
test('YSL1 decoder rejects corrupt header and detects short complete stream',()=>{
 const bad=new Uint8Array(12);assert.throws(()=>new SpatialRecordDecoder().push(bad),/magic/);
 const all=readFileSync(new URL('../public/data/lab/abstract_mixed_1m.ysl',import.meta.url));
 const d=new SpatialRecordDecoder();d.push(all.subarray(0,200));assert.throws(()=>d.finish(),/Truncated/);
});
test('network stream data file contains precisely one million records',()=>{
 const all=readFileSync(new URL('../public/data/lab/abstract_mixed_1m.ysl',import.meta.url));
 assert.equal(all.length,12+1_000_000*9);
 const d=new SpatialRecordDecoder(8192);let count=0;
 for(let i=0;i<all.length;i+=65536)for(const chunk of d.push(all.subarray(i,i+65536)))count+=chunk.count;
 d.finish();assert.equal(count,1_000_000);
});
