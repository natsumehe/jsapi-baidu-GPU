/** Optional GPU compute adapter. Times include all upload/submit/map/readback, not a fake shader-only measurement. */
export class WebGPUCullAdapter {
  constructor(){this.device=null;this.pipeline=null;this.reason='uninitialized';}
  async initialize(){
    if(!navigator.gpu){this.reason='navigator.gpu unavailable';return false;}
    try{
      const adapter=await navigator.gpu.requestAdapter();
      if(!adapter){this.reason='No GPU adapter';return false;}
      this.device=await adapter.requestDevice();
      const module=this.device.createShaderModule({code:`
struct Bounds { minX:f32, maxX:f32, minY:f32, maxY:f32, count:u32, padding0:u32, padding1:u32, padding2:u32 };
@group(0) @binding(0) var<storage,read> positions:array<vec2f>;
@group(0) @binding(1) var<storage,read_write> visibility:array<u32>;
@group(0) @binding(2) var<uniform> bounds:Bounds;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x; if(i>=bounds.count){return;}
 let p=positions[i];
 visibility[i]=select(0u,1u,p.x>=bounds.minX && p.x<=bounds.maxX && p.y>=bounds.minY && p.y<=bounds.maxY);
}`});
      this.pipeline=this.device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main'}});
      this.device.lost.then(info=>{this.reason='Device lost: '+info.message;this.device=null;this.pipeline=null;});
      this.reason='ready';return true;
    }catch(e){this.reason=String(e);this.device=null;return false;}
  }
  get available(){return Boolean(this.device&&this.pipeline);}
  async cull(chunk,b){
    if(!this.available)throw Error('WebGPU not available: '+this.reason);
    const d=this.device,count=chunk.count;
    if(count===0)return {flags:new Uint8Array(),computeMs:0,visible:0};
    const size=count*4,allocated=[];
    const make=(bytes,usage)=>{const result=d.createBuffer({size:Math.max(4,bytes),usage});allocated.push(result);return result;};
    const started=performance.now();
    try {
      const points=make(chunk.positions.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
      const flags=make(size,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
      const read=make(size,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
      const params=make(32,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      d.queue.writeBuffer(points,0,chunk.positions);
      const arr=new ArrayBuffer(32),view=new DataView(arr);
      [b.minX,b.maxX,b.minY,b.maxY].forEach((n,i)=>view.setFloat32(i*4,n,true));
      view.setUint32(16,count,true);
      d.queue.writeBuffer(params,0,arr);
      const group=d.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[
        {binding:0,resource:{buffer:points}}, {binding:1,resource:{buffer:flags}}, {binding:2,resource:{buffer:params}}
      ]});
      const encoder=d.createCommandEncoder(),pass=encoder.beginComputePass();
      pass.setPipeline(this.pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(count/256));pass.end();
      encoder.copyBufferToBuffer(flags,0,read,0,size);d.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const bits=new Uint32Array(read.getMappedRange()).slice();read.unmap();
      const output=new Uint8Array(count);let visible=0;
      for(let i=0;i<count;i++){output[i]=bits[i]?1:0;visible+=output[i];}
      return {flags:output,visible,computeMs:performance.now()-started};
    } finally {allocated.forEach(x=>x.destroy());}
  }
  destroy(){this.device=null;this.pipeline=null;}
}
