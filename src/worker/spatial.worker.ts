import { WasmEngine } from "../wasm/WasmEngine";
const wasm = new WasmEngine();
let wasmReady = false;
const HEADER = 24, RECORD = 16, MAGIC = 0x504f5254;
interface StreamState { tileId:string; tail:Uint8Array; expected:number|null; decoded:number; }
const streams = new Map<number,StreamState>();
function emit(id:number,s:StreamState,bytes:Uint8Array) {
 const n = Math.floor(bytes.byteLength/RECORD);
 if(!n)return;
 const positions=new Float32Array(n*3),colors=new Uint8Array(n*4);
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 for(let i=0;i<n;i++){const o=i*RECORD;positions.set([v.getFloat32(o,true),v.getFloat32(o+4,true),v.getFloat32(o+8,true)],i*3);colors.set([v.getUint8(o+12),v.getUint8(o+13),v.getUint8(o+14),255],i*4);}
 self.postMessage({type:"decoded-chunk",id,tileId:s.tileId,offset:s.decoded,count:n,positions:positions.buffer,colors:colors.buffer},[positions.buffer,colors.buffer]);
 s.decoded+=n;
}
self.onmessage=async (event:MessageEvent)=>{
 const m=event.data;
 try {
  if(m.type==="stream-start"){streams.set(m.id,{tileId:m.tileId,tail:new Uint8Array(0),expected:null,decoded:0});self.postMessage({type:"stream-ready",id:m.id});return;}
  if(m.type==="stream-cancel"){streams.delete(m.id);return;}
  if(m.type==="stream-chunk"){
   const s=streams.get(m.id);if(!s)return;
   const incoming=new Uint8Array(m.chunk);
   const combined=new Uint8Array(s.tail.length+incoming.length);
   combined.set(s.tail);combined.set(incoming,s.tail.length);
   let start=0;
   if(s.expected===null){
    if(combined.length<HEADER){s.tail=combined;self.postMessage({type:"chunk-ack",id:m.id});return;}
    const v=new DataView(combined.buffer);
    if(v.getUint32(0,true)!==MAGIC||v.getUint32(4,true)!==1)throw Error("Invalid PORT tile header/version");
    s.expected=v.getUint32(8,true);
    if(s.expected>10_000_000)throw Error("Tile record limit exceeded");
    start=HEADER;
   }
   const remaining=s.expected-s.decoded;
   const complete=Math.min(remaining,Math.floor((combined.length-start)/RECORD));
   const end=start+complete*RECORD;
   emit(m.id,s,combined.subarray(start,end));
   s.tail=combined.slice(end);
   if(s.tail.length && s.decoded===s.expected)throw Error("Unexpected trailing tile bytes");
   self.postMessage({type:"chunk-ack",id:m.id});return;
  }
  if(m.type==="stream-finish"){
   const s=streams.get(m.id);if(!s)return;
   streams.delete(m.id);
   if(s.expected===null||s.decoded!==s.expected||s.tail.length)throw Error("Incomplete PORT tile stream");
   self.postMessage({type:"decoded",id:m.id,tileId:s.tileId,count:s.decoded,positions:new ArrayBuffer(0),colors:new ArrayBuffer(0)});return;
  }
  if(m.type==="decode-tile"){
   if(!wasmReady)wasmReady=await wasm.initialize();
   const b=new Uint8Array(m.buffer),v=new DataView(m.buffer);
   if(b.length<HEADER||v.getUint32(0,true)!==MAGIC||v.getUint32(4,true)!==1)throw Error("Invalid PORT tile");
   const count=v.getUint32(8,true);
   if(count>10_000_000||HEADER+count*RECORD!==b.length)throw Error("Invalid tile length");
   if(wasmReady){const r=wasm.decodeTile(m.buffer,m.tileId);self.postMessage({type:"decoded",id:m.id,tileId:r.id,count:r.count,positions:r.positions.buffer,colors:r.colors.buffer},[r.positions.buffer,r.colors.buffer]);}
   else {const s:StreamState={tileId:m.tileId,tail:new Uint8Array(),expected:count,decoded:0};emit(m.id,s,b.subarray(HEADER));self.postMessage({type:"decoded",id:m.id,tileId:m.tileId,count,positions:new ArrayBuffer(0),colors:new ArrayBuffer(0)});}
  }
 }catch(e){streams.delete(m.id);self.postMessage({type:"error",id:m.id,error:e instanceof Error?e.message:String(e)});}
};
