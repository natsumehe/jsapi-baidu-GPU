import {HybridMapAdapter} from './map.mjs';
import {PortRenderer} from './renderer.mjs';
import {LabBenchmark} from './benchmark.mjs';
import {HTTPSpatialStreamDemo} from './http-stream.mjs';
const $=id=>document.getElementById(id),num=v=>Number(v).toLocaleString('zh-CN'),ms=v=>v===null||!Number.isFinite(v)?'N/A':v.toFixed(1),
 status=msg=>{$('progress-text').textContent=msg;};
const scene=$('scene'),map=new HybridMapAdapter(scene,$('basemap'));
let renderer,lab,lastReport=null;
function updateResults(){
  const rows=lab.results;$('results-body').innerHTML=rows.length?'':'<tr><td colspan="10" class="empty">未产生有效数据</td></tr>';
  for(const r of rows){const tr=document.createElement('tr');
    for(const value of [r.mode,r.geometry??'mixed',r.size,ms(r.firstVisibleMs)+' ms',ms(r.loadTimeMs)+' ms',ms(r.frameP95Ms)+' ms',ms(r.interactionP95Ms)+' ms',num(Math.round(r.objectsPerSecond)),r.mode==='C'||r.mode==='D'?ms(r.computeMs)+' ms':r.mode==='E'?ms(r.cpuCullMs)+' ms (CPU)':'—',ms(r.uploadBytes/1048576)]){
      const td=document.createElement('td');td.textContent=String(value);tr.appendChild(td);
    }$('results-body').appendChild(tr);
  }
  const r=rows.at(-1);if(!r)return;
  $('drawn').textContent=num(r.visibleObjects);
  $('drawn').title=r.primitives?`Point: ${num(r.primitives.point)} · LineString: ${num(r.primitives.line)} · Polygon: ${num(r.primitives.polygon)}`:'';
  $('shape-breakdown').textContent=r.primitives?`点 ${num(r.primitives.point)} / 线 ${num(r.primitives.line)} / 面 ${num(r.primitives.polygon)}`:'—';$('first').textContent=ms(r.firstVisibleMs);
  $('load').textContent=ms(r.loadTimeMs);$('p95').textContent=ms(r.interactionP95Ms);
  $('compute').textContent=r.mode==='C'||r.mode==='D'?ms(r.computeMs):'未启用';
}
function options(){return {size:Number($('size').value),mode:$('mode').value,seed:Number($('seed').value),profile:$('profile').value,geometry:$('geometry').value,chunkSize:Number($('chunk').value),interactionMs:650};}
function toggleBusy(busy){$('run').disabled=busy;$('ab').disabled=busy;$('stop').disabled=!busy;}
async function run(ab=false){
  toggleBusy(true);$('errors').textContent='';
  try{
    const opts=options();status('初始化实验数据...');
    if(ab){lastReport=await lab.runAB(opts);
      $('errors').textContent=lastReport.errors.map(e=>e.mode+': '+e.reason).join(' | ')||'A/B 顺序测试完成';
      if(!lastReport.results.length)status('没有成功的实验组');else status('已执行 '+lastReport.results.length+' 组，详细环境与结果可导出 JSON');
    }else{const result=await lab.run(opts);
      lastReport={environment:{mapAdapter:map.name,webgpu:lab.gpu.available,reason:lab.gpu.reason},parameters:opts,results:[result],errors:[]};
      status('实验完成 · '+opts.mode+' · '+num(opts.size)+' objects');
    }
  }catch(e){status('实验错误：'+String(e));$('errors').textContent=String(e);}
  finally{toggleBusy(false);updateResults();}
}
function download(name,text,type){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),250);}
function exportJson(){const report={...(lastReport??{results:lab.results}),httpStreamResult:window.__PORT_LAB__?.httpStreamResult??null};download('yangshan-measurements.json',JSON.stringify(report,null,2),'application/json');}
function exportCsv(){const rows=lab.results;if(!rows.length)return;const keys=Object.keys(rows[0]);
  const cell=x=>'"'+String(x??'').replaceAll('"','""')+'"';
  download('yangshan-ab-measurements.csv',[keys.join(','),...rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\n'),'text/csv');}
async function start(){
  try{renderer=new PortRenderer($('overlay'));map.paint();lab=new LabBenchmark(renderer,map,progress=>{
    $('progress-bar').style.width=(progress.loaded/progress.size*100).toFixed(1)+'%';
    if(!progress.result)status(`${progress.mode} · ${num(progress.loaded)} / ${num(progress.size)} objects`);
  });
  map.onChange=()=>{renderer.draw(map.transform());};
  new ResizeObserver(()=>{if(renderer)renderer.draw(map.transform());}).observe(scene);
  $('gl-mode').textContent=renderer.gl.getParameter(renderer.gl.VERSION).slice(0,30);
  $('gpu-mode').textContent=(await lab.initialize())?'可用 · Compute':'不可用 · '+lab.gpu.reason;
  $('map-mode').textContent=map.name;
  $('run').onclick=()=>run(false);$('ab').onclick=()=>run(true);$('stop').onclick=()=>lab.cancel();
  const httpDemo=new HTTPSpatialStreamDemo(renderer,map,p=>{
    $('http-stream-bar').style.width=(p.loaded/p.size*100).toFixed(2)+'%';
    $('http-stream-bytes').textContent=(p.networkBytes/1048576).toFixed(2)+' MB';
    $('http-stream-batches').textContent=`${p.reads} / ${p.uploads}`;
    $('http-stream-timing').textContent=`${ms(p.firstVisibleMs)} / ${ms(p.elapsedMs)} ms`;
    $('http-stream-geoms').textContent=p.primitives?`${num(p.primitives.point)} / ${num(p.primitives.line)} / ${num(p.primitives.polygon)}`:
      p.primitiveCounts?`${num(p.primitiveCounts.point)} / ${num(p.primitiveCounts.line)} / ${num(p.primitiveCounts.polygon)}`:'—';
    $('http-stream-status').textContent=p.done?'HTTP 流加载完成 · JSON 结果已记录':`已增量绘制 ${num(p.loaded)} / ${num(p.size)} 对象`;
  });
  $('http-stream-run').onclick=async()=>{
    if(lab.running){$('http-stream-status').textContent='请等待 A/B 实验结束';return;}
    toggleBusy(true);$('http-stream-run').disabled=true;$('http-stream-stop').disabled=false;
    $('http-stream-status').textContent='等待 HTTP 响应头与首批数据...';
    try{
      const report=await httpDemo.run({size:Number($('size').value),chunkSize:Number($('chunk').value),delayMs:Number($('stream-delay').value)});
      window.__PORT_LAB__.httpStreamResult=report;
      $('http-stream-status').textContent=`HTTP 流式绘制完成 · ${num(report.loaded)} 对象 · ${ms(report.elapsedMs)}ms`;
    }catch(e){$('http-stream-status').textContent='网络流实验失败：'+String(e);}
    finally{toggleBusy(false);$('http-stream-run').disabled=false;$('http-stream-stop').disabled=true;}
  };
  $('http-stream-stop').onclick=()=>httpDemo.cancel();

  $('export-json').onclick=exportJson;$('export-csv').onclick=exportCsv;
  $('baidu').onclick=async()=>{
    $('baidu').disabled=true;status('正在尝试加载百度 JSAPI...');
    const ak=window.__APP_CONFIG__?.baiduMapAk?.trim();
    await map.initialize(ak);$('map-mode').textContent=map.name;
    $('scene-label').textContent=map.map?'百度 JSAPI 实时地图 + 自定义 WebGL 图层':'离线地理坐标场景（未启用真实底图）';
    // Baidu's asynchronous tile/camera update needs an additional overlay redraw.
    map.bringOverlayToFront($('overlay'));
    renderer.draw(map.transform());requestAnimationFrame(()=>requestAnimationFrame(()=>renderer.draw(map.transform())));
    status(map.name);$('baidu').disabled=false;
  };
  window.__PORT_LAB__={run:opts=>lab.run(opts),runAB:opts=>lab.runAB(opts),results:()=>lab.results,
    getCapabilities:()=>({webgpu:lab.gpu.available,reason:lab.gpu.reason,map:map.name,webgl:renderer.gl.getParameter(renderer.gl.VERSION)}),cancel:()=>lab.cancel()};
  status('实验引擎已就绪 · 离线模式，无需百度 AK');document.body.dataset.ready='true';
  renderer.draw(map.transform());
  }catch(e){status('启动失败: '+String(e));console.error(e);document.body.dataset.ready='failed';}
}
start();
