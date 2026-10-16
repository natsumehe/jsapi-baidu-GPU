import {Worker} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import {writeFileSync,mkdirSync} from 'node:fs';
import os from 'node:os';
import {generateChunk,percentile} from '../lab/dataset.mjs';

async function measure(mode,size,chunkSize,seed,geometry,profile){
 let worker;
 if(mode==='worker-stream')worker=new Worker(new URL('../lab/dataset.node-worker.mjs',import.meta.url));
 let chunks=0,bytes=0,checksum=0,firstChunkMs=null;
 const delays=[],t0=performance.now();
 let lastTick=performance.now();const timer=setInterval(()=>{const now=performance.now();delays.push(Math.max(0,now-lastTick-10));lastTick=now;},10);
 const workerNext=(start,count)=>new Promise((resolve,reject)=>{
  const onMessage=value=>{worker.off('error',onError);resolve(value);};
  const onError=error=>{worker.off('message',onMessage);reject(error);};
  worker.once('message',onMessage);worker.once('error',onError);
  worker.postMessage({start,count,seed,geometry,profile});
 });
 const latencies=[];
 try{
  for(let start=0;start<size;start+=chunkSize){
   const count=Math.min(chunkSize,size-start),before=performance.now();
   const ch=worker?await workerNext(start,count):generateChunk(start,count,seed,profile,geometry);
   const dt=performance.now()-before;latencies.push(dt);
   bytes+=ch.positions.byteLength+ch.colors.byteLength+ch.types.byteLength;
   // Lightweight deterministic consumption prevents the compiler from eliminating generation.
   checksum+=ch.positions[0]+ch.colors[0]+ch.types[0];
   chunks++;
   if(firstChunkMs===null)firstChunkMs=performance.now()-t0;
  }
 }finally{clearInterval(timer);if(worker)await worker.terminate();}
 const totalMs=performance.now()-t0;
 return {mode,size,chunkSize,seed,geometry,profile,chunks,bytes,checksum:+checksum.toFixed(3),firstChunkMs:+firstChunkMs.toFixed(3),
  totalMs:+totalMs.toFixed(3),objectsPerSecond:Math.round(size/(totalMs/1000)),chunkP95Ms:percentile(latencies,.95),
  eventLoopDelayP95Ms:percentile(delays,.95),delaySamples:delays.length};
}
const sizes=(process.env.BENCH_SIZES??'10000,100000,500000,1000000').split(',').map(Number);
const chunkSize=Number(process.env.BENCH_CHUNK??8192),seed=20261016;
const rounds=Number(process.env.BENCH_ROUNDS??3);
const geometries=(process.env.BENCH_GEOMETRIES??'mixed').split(',');
const profile=process.env.BENCH_PROFILE??'uniform';
const rows=[];
for(const geometry of geometries)for(const size of sizes){
 for(let i=0;i<rounds;i++)for(const mode of i%2?['worker-stream','main-bulk']:['main-bulk','worker-stream']){
  const r=await measure(mode,size,chunkSize,seed,geometry,profile);rows.push({round:i+1,...r});
  console.log(JSON.stringify({round:i+1,mode,size,geometry,totalMs:r.totalMs,throughput:r.objectsPerSecond,firstChunkMs:r.firstChunkMs}));
 }
}
const out={timestamp:new Date().toISOString(),environment:{node:process.version,platform:process.platform,arch:process.arch,
 cpuModel:os.cpus()[0]?.model,cpuCount:os.cpus().length,totalMemoryBytes:os.totalmem(),
 notes:'Node-only generation throughput and scheduling latency; NOT browser FPS, GPU speed, or JSAPI fusion.'},rounds,geometries,profile,rows};
mkdirSync('reports',{recursive:true});const output=process.env.BENCH_OUTPUT??'reports/node-data-benchmark-v5.json';
writeFileSync(output,JSON.stringify(out,null,2));
console.log('Saved '+output);
