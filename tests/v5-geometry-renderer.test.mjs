import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateChunk,compactChunk,cpuCull,geometryCounts,GEOMETRY_MODES} from '../lab/dataset.mjs';
import {PortRenderer} from '../lab/renderer.mjs';
function fakeGL(){
 const calls=[];let id=0;
 const gl={VERTEX_SHADER:35633,FRAGMENT_SHADER:35632,COMPILE_STATUS:1,LINK_STATUS:1,ARRAY_BUFFER:34962,
  DYNAMIC_DRAW:35048,FLOAT:5126,UNSIGNED_BYTE:5121,POINTS:0,LINES:1,TRIANGLES:4,
  COLOR_BUFFER_BIT:16384,BLEND:3042,SRC_ALPHA:770,ONE_MINUS_SRC_ALPHA:771,
  createShader:()=>++id,shaderSource(){},compileShader(){},getShaderParameter:()=>true,
  createProgram:()=>++id,attachShader(){},linkProgram(){},getProgramParameter:()=>true,
  deleteShader(){},createBuffer:()=>++id,getAttribLocation:()=>0,getUniformLocation:()=>({}),
  bindBuffer(){},bufferData(){},bufferSubData(){},deleteBuffer(){},deleteProgram(){},
  viewport(){},clearColor(){},clear(){},useProgram(){},uniform2f(){},
  enableVertexAttribArray(){},vertexAttribPointer(){},enable(){},blendFunc(){},disableVertexAttribArray(){},
  drawArrays:(mode,first,count)=>calls.push({mode,first,count})};return {gl,calls};
}
test('abstract primitive generator supports point/line/polygon and mixed reproducibly',()=>{
 for(const geometry of GEOMETRY_MODES){
  const a=generateChunk(0,600,123,'uniform',geometry),b=generateChunk(0,600,123,'uniform',geometry);
  assert.deepEqual(a.positions,b.positions);assert.deepEqual(a.types,b.types);
  const c=geometryCounts(a);
  assert.equal(c.points+c.lines+c.polygons,600);
  if(geometry==='point')assert.equal(c.points,600);
  if(geometry==='line')assert.equal(c.lines,600);
  if(geometry==='polygon')assert.equal(c.polygons,600);
  if(geometry==='mixed')assert.deepEqual(c,{points:200,lines:200,polygons:200});
 }
});
test('cull/compaction retain primitive kinds and deterministic indexes',()=>{
 const src=generateChunk(31,301,901,'corridor','mixed');
 const bounds={minX:-1000,maxX:1000,minY:-500,maxY:500};
 const {flags,visible}=cpuCull(src,bounds),out=compactChunk(src,flags);
 assert.equal(out.count,visible);assert.equal(out.types.length,visible);
 let n=0;for(let i=0;i<src.count;i++)if(flags[i])assert.equal(out.types[n++],src.types[i]);
});
test('renderer uses actual POINTS, LINES and TRIANGLES, not point-only emulation',()=>{
 const {gl,calls}=fakeGL(),canvas={clientWidth:500,clientHeight:400,getContext:()=>gl,width:0,height:0};
 const previous=globalThis.window;globalThis.window={devicePixelRatio:1};
 try{
  const renderer=new PortRenderer(canvas);renderer.reset(9,'mixed');
  const chunk=generateChunk(0,9,77,'uniform','mixed');
  assert.equal(renderer.append(chunk),9);
  assert.equal(renderer.pointObjects,3);assert.equal(renderer.lineObjects,3);assert.equal(renderer.polygonObjects,3);
  renderer.draw({origin:[250,200],basisX:[.1,0],basisY:[0,-.1]});
  assert.deepEqual(calls.map(c=>[c.mode,c.count]),[[gl.POINTS,3],[gl.LINES,6],[gl.TRIANGLES,18]]);
  assert.equal(renderer.length,9);assert.equal(renderer.uploadBytes,3*12+6*12+18*12);
 }finally{globalThis.window=previous;}
});
test('Baidu map canvas stays on top and fits viewport, lab has explicit abstract geometry controls',()=>{
 const ui=readFileSync(new URL('../lab.html',import.meta.url),'utf8');
 const map=readFileSync(new URL('../lab/map.mjs',import.meta.url),'utf8');
 assert.match(ui,/id="geometry"/);
 for(const k of ['Point','LineString','Polygon'])assert.match(ui,new RegExp(k));
 assert.ok(!ui.includes('● 集装箱 / 堆场'));
 assert.match(map,/bringOverlayToFront/);
 assert.match(map,/setViewport/);
 assert.match(map,/pointToPixel\(pt\)/);
});
