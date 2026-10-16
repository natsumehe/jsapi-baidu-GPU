const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const out = mkdtempSync(path.join(tmpdir(), 'yangshan-domain-'));
try {
  execFileSync('tsc', ['--target','ES2022','--module','CommonJS','--moduleResolution','node','--strict','--skipLibCheck','--outDir',out,'src/domain/cargo/CargoLifecycle.ts','src/application/port/EquipmentDispatcher.ts'], {stdio:'pipe'});
  const { CargoLifecycle, CargoRepository, CARGO_STAGES } = require(path.join(out,'domain/cargo/CargoLifecycle.js'));
  const { EquipmentDispatcher } = require(path.join(out,'application/port/EquipmentDispatcher.js'));
  const mkJob = i => ({id:`job-${i}`,containerNo:`BOX-${i}`,agvId:`AGV-${i}`,craneId:`QC-${i%3}`,yardId:`YARD-${i%4}`,vesselId:'VESSEL',synthetic:true});
  const mkEvent = (job, type, seq) => ({id:`${job.id}:${seq}`,jobId:job.id,type,sequence:seq,occurredAt:new Date().toISOString(),equipmentId:'TEST',synthetic:true});
  const entity = new CargoLifecycle(mkJob(1));
  assert.equal(entity.nextEvent,'QC_PICKED');
  assert.throws(() => entity.apply(mkEvent(mkJob(1),'ON_AGV',1)),/Invalid transition/);
  assert.equal(entity.apply(mkEvent(mkJob(1),'QC_PICKED',1)),true);
  assert.equal(entity.apply(mkEvent(mkJob(1),'QC_PICKED',1)),false,'duplicate must be idempotent');
  assert.throws(() => entity.apply({...mkEvent(mkJob(1),'QC_PICKED',1),id:'conflicting'}),/Out-of-order/);
  assert.throws(() => entity.apply({...mkEvent(mkJob(1),'ON_AGV',2),synthetic:false}),/provenance/);
  assert.throws(() => entity.apply(mkEvent(mkJob(1),'AT_YARD_TRANSFER',3)),/Invalid transition/);
  assert.equal(entity.snapshot.stage,'QC_PICKED');
  assert.equal(entity.snapshot.history.length,1);
  const repository=new CargoRepository();repository.register(mkJob(1));
  assert.throws(()=>repository.register(mkJob(1)),/Duplicate/);
  const seen=[];const dispatcher=new EquipmentDispatcher(event=>seen.push(event),6);
  dispatcher.load(Array.from({length:24},(_,i)=>mkJob(i+1)));
  for(let i=0;i<650;i++){
    dispatcher.tick();
    assert.ok(dispatcher.getStats().active<=6,'bounded active work');
    assert.ok(dispatcher.getStats().agvBusy<=4,'bounded AGV dispatch');
    assert.ok(dispatcher.getStats().ascBusy<=2,'bounded ASC dispatch');
    assert.ok(dispatcher.getStats().qcBusy<=2,'bounded QC dispatch');
  }
  assert.equal(dispatcher.getStats().completed,24,'all containers reach gate-out');
  for(const job of dispatcher.repository.list()){
    assert.equal(job.stage,'GATE_OUT');
    assert.deepEqual(job.history.map(e=>e.type),CARGO_STAGES.slice(1));
    assert.ok(job.history.every(e=>e.synthetic));
  }
  assert.equal(seen.length,24*(CARGO_STAGES.length-1));
  console.log(`PASS: domain transitions, duplicate replay, source integrity, equipment constraints, 24 import jobs / ${seen.length} events`);
} finally { rmSync(out,{recursive:true,force:true}); }
