const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = mkdtempSync(path.join(tmpdir(), 'yangshan-import-'));
const realFetch = global.fetch;
const realInterval = global.setInterval;
const realClear = global.clearInterval;
const realWindow = global.window;
(async () => {
 try {
  execFileSync('tsc', [
    '--target','ES2022','--module','CommonJS','--moduleResolution','node',
    '--strict','--skipLibCheck','--outDir',output,
    'src/application/port/PortOperationsService.ts',
    'src/infrastructure/tos/SimulatedTOSAdapter.ts',
    'src/infrastructure/tos/RemotePortOperationsAdapter.ts'
  ], {stdio:'pipe'});
  const { PortOperationsService }=require(path.join(output,'application/port/PortOperationsService.js'));
  const { SimulatedTOSAdapter }=require(path.join(output,'infrastructure/tos/SimulatedTOSAdapter.js'));
  const { RemotePortOperationsAdapter }=require(path.join(output,'infrastructure/tos/RemotePortOperationsAdapter.js'));
  const source = JSON.parse(readFileSync('public/data/simulation/yangshan_phase4/TOS_STA_AGV_CNTR_INFOS.json', 'utf8'));
  global.fetch = async url => {
    assert.match(String(url),/TOS_STA_AGV_CNTR_INFOS.json/);
    return new Response(JSON.stringify(source),{status:200,headers:{'content-type':'application/json'}});
  };
  let callback, intervalDelay;
  global.setInterval = (cb,ms) => {callback=cb;intervalDelay=ms;return 123;};
  global.clearInterval = () => {};
  const simulated = new SimulatedTOSAdapter();
  const service = new PortOperationsService(simulated);
  let notified=0;const unsubscribe=service.subscribe(()=>notified++);
  await service.initialize();
  assert.equal(service.snapshot().jobs.length,24);
  assert.equal(service.snapshot().mode,'simulation');
  simulated.setSpeed(4);assert.equal(intervalDelay,225);
  for(let n=0;n<650;n++) callback();
  assert.equal(service.snapshot().jobs.filter(j=>j.stage==='GATE_OUT').length,24);
  assert.equal(service.snapshot().recent.length,40,'UI event history is bounded');
  assert.ok(notified>100);
  unsubscribe();service.destroy();
  // No real endpoint is silently treated as simulation.
  global.window={location:{origin:'https://example.test'}};
  const eventJob={id:'remote-1',containerNo:'CNTR-1',agvId:'AGV-001',craneId:'QC-01',yardId:'YARD-01',vesselId:'V-1',synthetic:false};
  const event={id:'remote-1:1',jobId:'remote-1',type:'QC_PICKED',sequence:1,occurredAt:'2026-10-12T12:00:00Z',equipmentId:'QC-01',synthetic:false};
  global.fetch=async url=>{
    assert.match(String(url),/\/api\/port\/events/);
    return new Response(JSON.stringify({jobs:[eventJob],events:[event],cursor:'1'}),{status:200,headers:{'content-type':'application/json'}});
  };
  const remote = new PortOperationsService(new RemotePortOperationsAdapter('/api/port/events',60000));
  await remote.initialize();
  assert.equal(remote.snapshot().mode,'remote');
  assert.equal(remote.snapshot().jobs[0].stage,'QC_PICKED');
  assert.equal(remote.snapshot().jobs[0].job.synthetic,false);
  remote.destroy();
  console.log('PASS: synthetic TOS dataset -> adapter -> dispatcher -> 24 gate-outs -> state panel; remote source -> validated event -> domain');
 } finally {
  global.fetch=realFetch;
  global.setInterval=realInterval;
  global.clearInterval=realClear;
  global.window=realWindow;
  rmSync(output,{recursive:true,force:true});
 }
})().catch(err=>{console.error(err);process.exitCode=1});
