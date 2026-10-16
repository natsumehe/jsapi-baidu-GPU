import {SpatialRecordDecoder} from './stream-codec.mjs';
/** Real HTTP transport + ReadableStream parsing, independent of A/B Worker modes.
 * An optional presentation delay after every GPU batch makes the incremental
 * update visible. Delay is not included in claims of network throughput.
 */
const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class HTTPSpatialStreamDemo {
  constructor(renderer,map,onProgress=()=>{}){
    this.renderer=renderer;this.map=map;this.onProgress=onProgress;
    this.controller=null;this.running=false;this.latest=null;
  }
  cancel(){this.controller?.abort();}
  async run({size=100000,chunkSize=4096,delayMs=30}={}){
    if(this.running)throw Error('HTTP demo already running');
    if(!Number.isInteger(size)||size<1||size>1000000)throw Error('Invalid object count');
    this.running=true;this.controller=new AbortController();
    const started=performance.now(),decoder=new SpatialRecordDecoder(chunkSize);
    let requests=0,uploads=0,firstVisibleMs=null,networkCompleted=false,bodyBytes=0;
    const frames=[];let lastFrame=null,raf=0;
    const probe=now=>{if(lastFrame!==null){const elapsed=now-lastFrame;if(elapsed>0&&elapsed<1000)frames.push(elapsed);}lastFrame=now;raf=requestAnimationFrame(probe);};
    raf=requestAnimationFrame(probe);
    this.renderer.reset(size,'mixed');this.renderer.draw(this.map.transform());
    try{
      const response=await fetch('./data/lab/abstract_mixed_1m.ysl',{signal:this.controller.signal,cache:'no-store'});
      if(!response.ok)throw Error('HTTP '+response.status+' — missing static stream file');
      if(!response.body)throw Error('ReadableStream is unsupported in this browser');
      const reader=response.body.getReader();
      let reached=false;
      while(!reached){
        const {value,done}=await reader.read();
        if(done){networkCompleted=true;break;}
        requests++;bodyBytes+=value.byteLength;
        const batches=decoder.push(value);
        for(const batch of batches){
          if(this.controller.signal.aborted)throw Error('Cancelled');
          if(batch.start>=size){reached=true;break;}
          const count=Math.min(batch.count,size-batch.start);
          const part=count===batch.count?batch:{...batch,count,
            positions:batch.positions.subarray(0,count*2),colors:batch.colors.subarray(0,count*4),
            types:batch.types.subarray(0,count)};
          this.renderer.append(part);uploads++;
          this.renderer.draw(this.map.transform());
          await frame();
          if(firstVisibleMs===null)firstVisibleMs=performance.now()-started;
          this.onProgress({loaded:this.renderer.length,size,networkBytes:bodyBytes,reads:requests,uploads,
            firstVisibleMs,elapsedMs:performance.now()-started,primitives:{
              point:this.renderer.pointObjects,line:this.renderer.lineObjects,polygon:this.renderer.polygonObjects}});
          if(this.renderer.length>=size){reached=true;break;}
          if(delayMs>0)await sleep(delayMs);
        }
      }
      // A smaller experiment intentionally cancels the remainder of the static
      // 1M asset rather than pretending the server sent exactly the requested N.
      if(!networkCompleted)await reader.cancel();
      if(size===1_000_000)decoder.finish();
      if(this.renderer.length!==size)throw Error(`Stream incomplete: ${this.renderer.length}/${size}`);
      const result={source:'HTTP fetch ReadableStream (static YSL1)',geometry:'mixed',
        size,loaded:this.renderer.length,reads:requests,uploads,networkBytes:bodyBytes,
        firstVisibleMs,elapsedMs:performance.now()-started,webglUploadBytes:this.renderer.uploadBytes,
        delayMs,notes:'Delay is visualization-only; HTTP transfer metrics exclude unreceived static asset bytes',
        primitiveCounts:{point:this.renderer.pointObjects,line:this.renderer.lineObjects,polygon:this.renderer.polygonObjects},
        p95FrameMs:frames.length?[...frames].sort((a,b)=>a-b)[Math.ceil(frames.length*.95)-1]:null};
      this.latest=result;this.onProgress({...result,done:true});return result;
    }finally{cancelAnimationFrame(raf);this.running=false;this.controller=null;}
  }
}
