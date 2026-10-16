import test from 'node:test';
import assert from 'node:assert/strict';
import {generateChunk} from '../lab/dataset.mjs';
import {LabBenchmark} from '../lab/benchmark.mjs';

const savedWorker=globalThis.Worker;
const savedRaf=globalThis.requestAnimationFrame;
const savedCancel=globalThis.cancelAnimationFrame;
class FakeWorker {
  onmessage=null;onerror=null;
  postMessage({requestId,start,count,seed,profile}){
    queueMicrotask(()=>this.onmessage?.({data:{requestId,...generateChunk(start,count,seed,profile)}}));
  }
  terminate(){}
}
const raf=cb=>setTimeout(()=>cb(performance.now()),3);
function make(){
 const renderer={length:0,uploadMs:0,uploadBytes:0,drawCalls:1,canvas:{clientWidth:100,clientHeight:100},gl:{VERSION:1,getParameter:()=>'Fake WebGL'},
   data:[],reset(size){this.capacity=size;this.length=0;this.data=[];this.uploadBytes=0;},
   append(chunk){this.length+=chunk.count;this.data.push(...chunk.positions);this.uploadBytes+=chunk.count*12;return chunk.count;},draw(){} };
 const map={panX:0,panY:0,map:null,name:'mock offline',transform:()=>({}),viewportBounds:()=>({minX:-5000,maxX:5000,minY:-5000,maxY:5000})};
 const bench=new LabBenchmark(renderer,map);
 return {renderer,map,bench};
}
test('A/B/E/C/D orchestrator uses identical data indices; D adaptive budget has no gaps',async()=>{
 globalThis.Worker=FakeWorker;globalThis.requestAnimationFrame=raf;globalThis.cancelAnimationFrame=clearTimeout;
 try{
  const {bench,renderer}=make(),observed={};
  bench.gpu={available:true,reason:'fake test compute (not a benchmark)',cull:async chunk=>({flags:new Uint8Array(chunk.count).fill(1),computeMs:1})};
  for(const mode of ['A','B','E','C','D']){
   const r=await bench.run({mode,size:9073,seed:20261016,profile:'mobile',chunkSize:2048,interactionMs:15});
   assert.equal(r.generatedObjects,9073);
   assert.equal(r.visibleObjects,9073);
   assert.equal(renderer.data.length,9073*2);
   observed[mode]=renderer.data;
  }
  for(const mode of ['B','E','C','D'])assert.deepEqual(observed[mode],observed.A);
 }finally{globalThis.Worker=savedWorker;globalThis.requestAnimationFrame=savedRaf;globalThis.cancelAnimationFrame=savedCancel;}
});
test('AB skips GPU cases without inventing CPU fallback GPU measurements',async()=>{
 globalThis.Worker=FakeWorker;globalThis.requestAnimationFrame=raf;globalThis.cancelAnimationFrame=clearTimeout;
 try{
  const {bench}=make();
  const report=await bench.runAB({size:1024,seed:1,interactionMs:10,chunkSize:1024,modes:['A','B','C','D']});
  assert.deepEqual(report.results.map(r=>r.mode),['A','B']);
  assert.deepEqual(report.errors.map(e=>e.mode),['C','D']);
 }finally{globalThis.Worker=savedWorker;globalThis.requestAnimationFrame=savedRaf;globalThis.cancelAnimationFrame=savedCancel;}
});
