import {generateChunk,cpuCull,compactChunk,percentile,DEFAULT_SEED} from './dataset.mjs';
import {WebGPUCullAdapter} from './gpu.mjs';

const MODES={A:{label:'A · Main thread + WebGL (bulk)',worker:false,stream:false,gpu:false,adaptive:false},
 B:{label:'B · Worker + WebGL (stream)',worker:true,stream:true,gpu:false,adaptive:false},
 E:{label:'E · Worker + CPU cull → WebGL',worker:true,stream:true,gpu:false,cpuCull:true,adaptive:false},
 C:{label:'C · Worker + WebGPU cull → WebGL',worker:true,stream:true,gpu:true,adaptive:false},
 D:{label:'D · C + feedback budget',worker:true,stream:true,gpu:true,adaptive:true}};
const waitFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const LAB_MODES=MODES;
export class LabBenchmark {
  constructor(renderer,map,progress=()=>{}){
    this.renderer=renderer;this.map=map;this.progress=progress;
    this.gpu=new WebGPUCullAdapter();this.worker=null;this.pending=null;
    this.running=false;this.results=[];this.cancelRequested=false;this.frameTimes=[];this.frameId=0;
    this.currentScene={mode:null,size:0,seed:DEFAULT_SEED};
  }
  async initialize(){await this.gpu.initialize();return this.gpu.available;}
  cancel(){this.cancelRequested=true;}
  makeWorker(){
    if(this.worker)this.worker.terminate();
    this.worker=new Worker(new URL('./dataset.worker.mjs',import.meta.url),{type:'module'});
    this.worker.onmessage=e=>{const pending=this.pending;this.pending=null;if(pending){if(e.data.error)pending.reject(Error(e.data.error));else pending.resolve(e.data);}};
    this.worker.onerror=e=>{this.pending?.reject(Error(e.message));this.pending=null;};
  }
  workerChunk(start,count,seed,profile,geometry){
    return new Promise((resolve,reject)=>{
      this.pending={resolve,reject};this.worker.postMessage({requestId:start,start,count,seed,profile,geometry});
    });
  }
  probe(){
    const sample=now=>{
      if(this.frameLast){const dt=now-this.frameLast;if(dt>0&&dt<1000)this.frameTimes.push(dt);}
      this.frameLast=now;this.frameId=requestAnimationFrame(sample);
    };
    this.frameLast=0;this.frameTimes=[];this.frameId=requestAnimationFrame(sample);
  }
  stopProbe(){cancelAnimationFrame(this.frameId);this.frameId=0;}
  draw(){this.renderer.draw(this.map.transform());}
  async run({size=100000,mode='B',seed=DEFAULT_SEED,profile='uniform',geometry='mixed',chunkSize=8192,interactionMs=750}={}){
    if(this.running)throw Error('Another benchmark is running');
    const config=MODES[mode];if(!config)throw Error('Unknown benchmark mode '+mode);
    if(!Number.isInteger(size)||size<1||size>1000000)throw Error('Size must be 1 to 1,000,000');
    if(!Number.isInteger(chunkSize)||chunkSize<256||chunkSize>65536)throw Error('Chunk size must be 256–65536');
    if(config.gpu&&!this.gpu.available)throw Error('WebGPU unavailable; mode '+mode+' NOT run. '+this.gpu.reason);
    this.running=true;this.cancelRequested=false;
    let generationMs=0,computeMs=0,cpuCullMs=0,compactionMs=0,chunkCount=0,visible=0,firstVisibleMs=null,receivedBytes=0,maxChunkMs=0;
    const started=performance.now();this.renderer.reset(size,geometry);if(config.worker)this.makeWorker();
    let budget=chunkSize;
    this.currentScene={mode,size,seed,profile,geometry};
    this.probe();
    try {
      const staged=[];
      for(let start=0;start<size;){
        if(this.cancelRequested)throw Error('Cancelled');
        const count=Math.min(config.adaptive?budget:chunkSize,size-start),at=performance.now();
        let chunk;
        if(config.worker){const r=await this.workerChunk(start,count,seed,profile,geometry);
          chunk={count,positions:r.positions,colors:r.colors,types:r.types};
        } else chunk=generateChunk(start,count,seed,profile,geometry);
        generationMs+=performance.now()-at;receivedBytes+=chunk.positions.byteLength+chunk.colors.byteLength+chunk.types.byteLength;
        if(config.gpu||config.cpuCull){
          let flags;
          if(config.gpu){
            const cull=await this.gpu.cull(chunk,this.map.viewportBounds(1.0));
            flags=cull.flags;computeMs+=cull.computeMs;
          }else{
            const beforeCull=performance.now();flags=cpuCull(chunk,this.map.viewportBounds(1.0)).flags;
            cpuCullMs+=performance.now()-beforeCull;
          }
          const beforeCompact=performance.now();chunk=compactChunk(chunk,flags);
          compactionMs+=performance.now()-beforeCompact;
        }
        visible+=this.renderer.append(chunk);chunkCount++;
        if(config.stream){
          this.draw();if(firstVisibleMs===null&&this.renderer.length)firstVisibleMs=performance.now()-started;
          await waitFrame();
        }else staged.push(1);
        const elapsed=performance.now()-at;maxChunkMs=Math.max(elapsed,maxChunkMs);
        if(config.adaptive){
          // Feedback limits chunk size according to recent end-to-end latency, not nominal GPU speed.
          if(elapsed>24)budget=Math.max(1024,Math.floor(budget*.75));
          else if(elapsed<10)budget=Math.min(32768,Math.floor(budget*1.2));
        }
        start+=count; // Advance by the actual processed count, not a newly adapted budget.
        this.progress({loaded:start,size,mode});
      }
      if(!config.stream){this.draw();if(this.renderer.length)firstVisibleMs=performance.now()-started;}
      await waitFrame();
      const loadTimeMs=performance.now()-started;
      const loadFrames=this.frameTimes.slice();
      // Same fixed interaction script for every run; offline basemap pan updates the transform.
      this.frameTimes.length=0;
      const panBeforeX=this.map.panX,panBeforeY=this.map.panY;
      const interactionStart=performance.now();
      while(performance.now()-interactionStart<interactionMs){
        if(this.cancelRequested)throw Error('Cancelled');
        const phase=(performance.now()-interactionStart)/interactionMs;
        if(!this.map.map){this.map.panX=panBeforeX+Math.sin(phase*2*Math.PI)*100;this.map.panY=panBeforeY+Math.cos(phase*2*Math.PI)*35;}
        this.draw();await waitFrame();
      }
      this.map.panX=panBeforeX;this.map.panY=panBeforeY;this.draw();
      const interactionFrames=this.frameTimes.slice();
      const result={timestamp:new Date().toISOString(),mode,modeLabel:config.label,size,seed,profile,geometry,chunkSize,chunkCount,
        loadTimeMs,firstVisibleMs,visibleObjects:this.renderer.length,generatedObjects:size,
        primitives:{point:this.renderer.pointObjects??null,line:this.renderer.lineObjects??null,polygon:this.renderer.polygonObjects??null},
        generationMs,computeMs,cpuCullMs,compactionMs,maxChunkMs,objectsPerSecond:size/(loadTimeMs/1000),
        uploadMs:this.renderer.uploadMs,uploadBytes:this.renderer.uploadBytes,receivedBytes,drawCalls:this.renderer.drawCalls,
        frameP95Ms:percentile(loadFrames,.95),frameP99Ms:percentile(loadFrames,.99),
        interactionP95Ms:percentile(interactionFrames,.95),interactionAvgFPS:interactionFrames.length/(interactionMs/1000),
        sampleFrames:loadFrames.length,interactionFrames:interactionFrames.length,
        gpuComputeStatus:config.gpu?'measured full dispatch + readback':'not used',
        memoryMB:performance.memory?+(performance.memory.usedJSHeapSize/1048576).toFixed(2):null,
        gpuAvailable:this.gpu.available,mapAdapter:this.map.name,
        userAgent:navigator.userAgent,webglVersion:this.renderer.gl.getParameter(this.renderer.gl.VERSION)};
      this.results.push(result);this.progress({loaded:size,size,mode,result});return result;
    }finally{
      this.stopProbe();this.running=false;
      if(this.worker){this.worker.terminate();this.worker=null;}
      this.pending=null;
    }
  }
  async runAB(options={}){
    const modes=options.modes??['A','B','E','C','D'];const completed=[];const errors=[];
    for(const mode of modes){
      if(MODES[mode]?.gpu&&!this.gpu.available){errors.push({mode,reason:'WebGPU unavailable: '+this.gpu.reason});continue;}
      try{completed.push(await this.run({...options,mode}));}
      catch(e){errors.push({mode,reason:String(e)});if(this.cancelRequested)break;}
      await sleep(120);
    }
    return {environment:{userAgent:navigator.userAgent,mapAdapter:this.map.name,webgpu:this.gpu.available,gpuReason:this.gpu.reason,
      webgl:this.renderer.gl.getParameter(this.renderer.gl.VERSION),viewport:[this.renderer.canvas.clientWidth,this.renderer.canvas.clientHeight]},
      parameters:{size:options.size??100000,seed:options.seed??DEFAULT_SEED,profile:options.profile??'uniform',geometry:options.geometry??'mixed',chunkSize:options.chunkSize??8192},results:completed,errors};
  }
  destroy(){this.cancel();this.worker?.terminate();this.gpu.destroy();this.stopProbe();}
}
