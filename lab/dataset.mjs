/** Reproducible, abstract geospatial benchmarks: POINT / LINESTRING / POLYGON.
 * Every mode A/B/E/C/D consumes the same seed, indices, kind and coordinates.
 * The three types are geometry primitives, NOT container/AGV/crane categories.
 */
export const DEFAULT_SEED=20261016;
export const PORT_BOUNDS=Object.freeze({minX:-3200,maxX:3200,minY:-1450,maxY:1450});
export const DATASET_SIZES=[10000,100000,500000,1000000];
export const GEOMETRY_TYPES=Object.freeze({point:0,line:1,polygon:2});
export const GEOMETRY_MODES=Object.freeze(['mixed','point','line','polygon']);
export const DATASET_PROFILES=Object.freeze({uniform:'均匀分布',clustered:'聚簇分布',corridor:'带状分布',port:'聚簇分布',yard:'聚簇分布',mobile:'带状分布'});
export const COLOR_MAP=Object.freeze([[92,203,255,240],[252,190,85,225],[111,231,175,196]]);
function hash(n){n=Math.imul(n^(n>>>16),0x7feb352d);n=Math.imul(n^(n>>>15),0x846ca68b);return (n^(n>>>16))>>>0;}
function rand(seed,id,salt=0){return hash((seed ^ Math.imul(id+1,0x9e3779b1)^Math.imul(salt+17,0x85ebca6b))>>>0)/4294967296;}
export function geometryType(index,mode='mixed'){
  if(!GEOMETRY_MODES.includes(mode))throw Error('Unknown geometry kind: '+mode);
  return mode==='mixed'?index%3:GEOMETRY_TYPES[mode];
}
/** Return object centre plus primitive type. Coordinates in metres. */
export function pointFor(index,seed=DEFAULT_SEED,profile='uniform',geometry='mixed'){
  if(!(profile in DATASET_PROFILES))throw Error('Unknown spatial profile '+profile);
  if(!Number.isInteger(index)||index<0)throw Error('Invalid object index');
  const kind=geometryType(index,geometry),x=rand(seed,index,0),y=rand(seed,index,1);
  if(profile==='clustered'||profile==='yard'||profile==='port'){
    const cluster=index%20;
    return [-2780+(cluster%10)*600+(x-.5)*240,-1080+Math.floor(cluster/10)*1750+(y-.5)*320,kind];
  }
  if(profile==='corridor'||profile==='mobile'){
    const lane=index%19;
    return [-3020+x*6040,-1170+lane*126+(y-.5)*25,kind];
  }
  return [-3000+x*6000,-1320+y*2640,kind];
}
/** Positions are centres; line and polygon vertices are expanded by the WebGL
 * renderer, so GPU culling compares exactly the same object centres as CPU.
 */
export function generateChunk(start,count,seed=DEFAULT_SEED,profile='uniform',geometry='mixed'){
  if(!Number.isInteger(start)||start<0||!Number.isInteger(count)||count<0||count>1000000)throw Error('Invalid chunk parameters');
  const positions=new Float32Array(count*2),colors=new Uint8Array(count*4),types=new Uint8Array(count);
  for(let i=0;i<count;i++){
    const [x,y,kind]=pointFor(start+i,seed,profile,geometry);
    positions[i*2]=x;positions[i*2+1]=y;types[i]=kind;colors.set(COLOR_MAP[kind],i*4);
  }
  return {start,count,positions,colors,types};
}
export const inBounds=(x,y,b)=>x>=b.minX&&x<=b.maxX&&y>=b.minY&&y<=b.maxY;
export function cpuCull(chunk,bounds){
  const flags=new Uint8Array(chunk.count);let visible=0;
  for(let i=0;i<chunk.count;i++){
    const flag=inBounds(chunk.positions[2*i],chunk.positions[2*i+1],bounds)?1:0;
    flags[i]=flag;visible+=flag;
  }return {flags,visible};
}
export function compactChunk(chunk,flags){
  const positions=new Float32Array(chunk.positions.length),colors=new Uint8Array(chunk.colors.length),types=new Uint8Array(chunk.count);
  let n=0;
  for(let i=0;i<chunk.count;i++){
    if(!flags[i])continue;
    positions[n*2]=chunk.positions[i*2];positions[n*2+1]=chunk.positions[i*2+1];
    colors.set(chunk.colors.subarray(i*4,i*4+4),n*4);types[n]=chunk.types[i];n++;
  }
  return {start:chunk.start,count:n,positions:positions.subarray(0,n*2),
    colors:colors.subarray(0,n*4),types:types.subarray(0,n)};
}
export function geometryCounts(chunk){
  const totals=[0,0,0];for(const kind of chunk.types)totals[kind]++;
  return {points:totals[0],lines:totals[1],polygons:totals[2]};
}
export function percentile(values,p){if(!values.length)return null;const s=[...values].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.max(0,Math.ceil(p*s.length)-1))];}
