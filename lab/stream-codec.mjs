/** YSL1 static network-stream demo: 12-byte little-endian header and 9-byte
 * records (Float32 x, Float32 y, uint8 primitive type). Deterministic data.
 * A browser ReadableStream may split an individual record arbitrarily.
 */
export const RECORD_BYTES=9,HEADER_BYTES=12;
export const LAB_STREAM_COLORS=[[92,203,255,240],[252,190,85,225],[111,231,175,196]];
export class SpatialRecordDecoder {
  constructor(batchSize=4096){
    if(!Number.isInteger(batchSize)||batchSize<1)throw Error('Invalid batch size');
    this.batchSize=batchSize;this.pending=new Uint8Array(0);this.total=null;
    this.seed=null;this.decoded=0;this.networkBytes=0;
  }
  push(bytes){
    const input=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    this.networkBytes+=input.length;
    const all=new Uint8Array(this.pending.length+input.length);
    all.set(this.pending);all.set(input,this.pending.length);
    let offset=0;
    if(this.total===null){
      if(all.length<HEADER_BYTES){this.pending=all;return [];}
      const h=new DataView(all.buffer,all.byteOffset,all.byteLength);
      if(String.fromCharCode(...all.subarray(0,4))!=='YSL1')throw Error('Incorrect YSL1 magic');
      this.total=h.getUint32(4,true);this.seed=h.getUint32(8,true);
      if(this.total<1||this.total>1000000)throw Error('Invalid YSL1 object count');
      offset=HEADER_BYTES;
    }
    const outputs=[];
    while(all.length-offset>=RECORD_BYTES && this.decoded<this.total){
      const n=Math.min(this.batchSize,Math.floor((all.length-offset)/RECORD_BYTES),this.total-this.decoded);
      const positions=new Float32Array(n*2),colors=new Uint8Array(n*4),types=new Uint8Array(n);
      const dv=new DataView(all.buffer,all.byteOffset,all.byteLength);
      const start=this.decoded;
      for(let i=0;i<n;i++){
        const at=offset+i*RECORD_BYTES,kind=dv.getUint8(at+8);
        if(kind>2)throw Error('Invalid geometry type');
        positions[i*2]=dv.getFloat32(at,true);positions[i*2+1]=dv.getFloat32(at+4,true);
        types[i]=kind;colors.set(LAB_STREAM_COLORS[kind],i*4);
      }
      outputs.push({start,count:n,positions,colors,types});
      offset+=n*RECORD_BYTES;this.decoded+=n;
    }
    this.pending=all.slice(offset);
    if(this.decoded===this.total&&this.pending.length)throw Error('Unexpected trailing YSL1 bytes');
    return outputs;
  }
  finish(){if(this.total===null||this.decoded!==this.total||this.pending.length)throw Error('Truncated YSL1 network stream');}
}
