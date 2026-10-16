import type { DecodedTile } from "../data/runtime/TileTypes";
import type { WorkerResponse } from "./WorkerProtocol";
type Chunk = {offset:number;count:number;positions:Float32Array;colors:Uint8Array};
type Pending = {worker:Worker;resolve:(v:DecodedTile)=>void;reject:(e:unknown)=>void;chunks:Chunk[];onChunk?:(c:Chunk)=>void;ack?:()=>void;ready?:()=>void;};
export class WorkerPool {
 private workers:Worker[]=[];private pending=new Map<number,Pending>();private nextWorker=0;private nextTaskId=1;
 constructor(size=2){for(let i=0;i<Math.max(1,size);i++){const w=new Worker(new URL("./spatial.worker.ts",import.meta.url),{type:"module"});w.onmessage=e=>this.handleMessage(e.data as WorkerResponse);w.onerror=e=>this.failWorker(w,new Error(e.message));this.workers.push(w);}}
 private choose(){if(!this.workers.length)throw Error("WorkerPool destroyed");return this.workers[this.nextWorker++%this.workers.length];}
 decodeTile(tileId:string,buffer:ArrayBuffer):Promise<DecodedTile>{const worker=this.choose(),id=this.nextTaskId++;return new Promise((resolve,reject)=>{this.pending.set(id,{worker,resolve,reject,chunks:[]});worker.postMessage({type:"decode-tile",id,tileId,buffer},[buffer]);});}
 async decodeTileStream(tileId:string,stream:AsyncIterable<Uint8Array>,signal?:AbortSignal,onChunk?:(c:Chunk)=>void):Promise<DecodedTile>{
  const worker=this.choose(),id=this.nextTaskId++;
  let done=false;
  const result=new Promise<DecodedTile>((resolve,reject)=>this.pending.set(id,{worker,resolve:v=>{done=true;resolve(v);},reject:e=>{done=true;reject(e);},chunks:[],onChunk}));
  const abort=()=>{worker.postMessage({type:"stream-cancel",id});this.fail(id,new DOMException("Tile request aborted","AbortError"));};
  signal?.addEventListener("abort",abort,{once:true});
  try{
   if(signal?.aborted)throw new DOMException("Tile request aborted","AbortError");
   const ready=new Promise<void>(resolve=>{const task=this.pending.get(id);if(task)task.ready=resolve;});
   worker.postMessage({type:"stream-start",id,tileId});await ready;
   for await(const part of stream){if(done||signal?.aborted)throw new DOMException("Tile request aborted","AbortError");if(!part.byteLength)continue;
    // Bounded one-in-flight transfer: Worker ACK supplies real backpressure.
    const bytes=part.slice();const ack=new Promise<void>(resolve=>{const task=this.pending.get(id);if(task)task.ack=resolve;else resolve();});
    worker.postMessage({type:"stream-chunk",id,chunk:bytes.buffer},[bytes.buffer]);await ack;
   }
   if(!done)worker.postMessage({type:"stream-finish",id});
   return await result;
  }catch(e){worker.postMessage({type:"stream-cancel",id});this.fail(id,e);throw e;}
  finally{signal?.removeEventListener("abort",abort);}
 }
 getPendingCount(){return this.pending.size;}getWorkerCount(){return this.workers.length;}
 destroy(){for(const w of this.workers)w.terminate();this.workers=[];for(const id of [...this.pending.keys()])this.fail(id,Error("WorkerPool destroyed"));}
 private fail(id:number,error:unknown){const p=this.pending.get(id);if(!p)return;this.pending.delete(id);p.ack?.();p.ready?.();p.reject(error);}
 private failWorker(worker:Worker,error:Error){for(const [id,p] of this.pending)if(p.worker===worker)this.fail(id,error);}
 private handleMessage(m:WorkerResponse){const p=this.pending.get(m.id);if(!p)return;
  if(m.type==="stream-ready"){p.ready?.();p.ready=undefined;return;}
  if(m.type==="chunk-ack"){p.ack?.();p.ack=undefined;return;}
  if(m.type==="error"){this.fail(m.id,Error(m.error));return;}
  if(m.type==="decoded-chunk"){const c={offset:m.offset,count:m.count,positions:new Float32Array(m.positions),colors:new Uint8Array(m.colors)};p.chunks.push(c);p.onChunk?.(c);return;}
  this.pending.delete(m.id);
  const chunks=p.chunks;
  if(chunks.length){const count=chunks.reduce((n,c)=>n+c.count,0),positions=new Float32Array(count*3),colors=new Uint8Array(count*4);let at=0;for(const c of chunks){positions.set(c.positions,at*3);colors.set(c.colors,at*4);at+=c.count;}p.resolve({id:m.tileId,count,positions,colors});}
  else p.resolve({id:m.tileId,count:m.count,positions:new Float32Array(m.positions),colors:new Uint8Array(m.colors)});
 }
}
