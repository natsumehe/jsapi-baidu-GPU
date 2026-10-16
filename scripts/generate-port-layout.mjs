/** Deterministic GIS-derived demonstration geometry. No external dependencies.
 * Data coordinates are already BD09. Generated routes are schematic sea-side transfer
 * corridors, not surveyed, authorized vehicle navigation routes.
 */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve('.');
const GIS = path.join(ROOT,'public/data/gis');
const OUT = path.join(ROOT,'public/data/simulation/yangshan_phase4');
const read = f => JSON.parse(fs.readFileSync(path.join(GIS,f),'utf8')).features;
const anchor=[122.032598,30.662465], mx=6378137*Math.PI/180*Math.cos(anchor[1]*Math.PI/180), my=6378137*Math.PI/180;
const local=p=>[(p[0]-anchor[0])*mx,(p[1]-anchor[1])*my];
const geo=p=>[anchor[0]+p[0]/mx,anchor[1]+p[1]/my];
const point=p=>({longitude:+geo(p)[0].toFixed(8),latitude:+geo(p)[1].toFixed(8),x:+p[0].toFixed(3),y:+p[1].toFixed(3)});
const sqdist=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2;
const dist=(a,b)=>Math.sqrt(sqdist(a,b));
const add=(a,b)=>[a[0]+b[0],a[1]+b[1]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
const mul=(a,s)=>[a[0]*s,a[1]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const normalize=v=>mul(v,1/(Math.hypot(...v)||1));
const contains=(p,poly)=>{let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++) {const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) yes=!yes;}return yes;};
function nearSegment(p,a,b){const d=sub(b,a),t=Math.max(0,Math.min(1,dot(sub(p,a),d)/(dot(d,d)||1)));const q=add(a,mul(d,t));return{point:q,distance:dist(p,q)};}
function boundaryDistance(p,poly){let min=Infinity;for(let i=1;i<poly.length;i++)min=Math.min(min,nearSegment(p,poly[i-1],poly[i]).distance);return min;}
function nearBoundary(p,poly){let best={distance:Infinity};for(let i=1;i<poly.length;i++){const v=nearSegment(p,poly[i-1],poly[i]);if(v.distance<best.distance)best=v;}return best;}
const unloadAll=read('quay_cranes.geojson').filter(f=>f.properties.name==='卸货点').map(f=>local(f.geometry.coordinates));
const quay=read('quay_cranes.geojson').filter(f=>/号$/.test(f.properties.name||'')).map(f=>({id:Number(f.properties.id),name:f.properties.name,position:point(local(f.geometry.coordinates))}));
const operational=read('operational_polygons.geojson');
function namedPolygon(label){const feature=operational.find(f=>f.properties.name===label);if(!feature)throw Error(`Missing ${label} polygon`);return feature.geometry.coordinates[0].map(local);}
const buffer=namedPolygon('AGV缓冲区');
const transferArea=namedPolygon('AGV装卸区');
// Grid points on a narrow band polygon, falling back to longest edge interpolation.
function sampleBand(poly, count){const minX=Math.min(...poly.map(p=>p[0])), maxX=Math.max(...poly.map(p=>p[0]));const result=[];
 for(let i=0;i<count;i++) {const x=minX+(maxX-minX)*(i+0.5)/count;const intersections=[];
 for(let j=1;j<poly.length;j++){const a=poly[j-1],b=poly[j];if((a[0]<=x&&b[0]>x)||(b[0]<=x&&a[0]>x))intersections.push(a[1]+(x-a[0])*(b[1]-a[1])/(b[0]-a[0]));}
 intersections.sort((a,b)=>a-b);let chosen=null,bestLength=0;
 for(let k=0;k+1<intersections.length;k+=2){const length=intersections[k+1]-intersections[k];if(length>bestLength){bestLength=length;chosen=[x,(intersections[k]+intersections[k+1])/2];}}
 if(chosen && contains(chosen,poly))result.push(chosen);
 }
 if(result.length<count)throw Error(`Only ${result.length}/${count} safe AGV buffer anchors`);
 return result;
}
// Basis from the longest physical edge, not lat/lon bounds (yards are tilted).
function axes(poly){let v=[0,1],length=0;for(let i=1;i<poly.length;i++){let d=sub(poly[i],poly[i-1]),l=Math.hypot(...d);if(l>length){v=normalize(d);length=l;}}
 const perpendicular=[-v[1],v[0]];
 return {long:v,short:perpendicular};}
const yardFeatures=read('container_yards.geojson');
const allRings=yardFeatures.map(f=>f.geometry.coordinates[0].map(local));
const isStack=p=>allRings.some(ring=>contains(p,ring));
const yards=yardFeatures.map((f,index)=>{
 const ring=f.geometry.coordinates[0].map(local),{long,short}=axes(ring);
 const longLimits=ring.map(p=>dot(p,long)), shortLimits=ring.map(p=>dot(p,short));
 const lo=Math.min(...longLimits), hi=Math.max(...longLimits), left=Math.min(...shortLimits),right=Math.max(...shortLimits);
 const center=add(mul(long,(lo+hi)/2),mul(short,(left+right)/2));
 // ISO 20ft standard (6.058 x 2.438 x 2.591 metres), 0.8m aisle clearance, 6m edge setback.
 const cells=[];const lenStep=7.05, widthStep=3.45;
 const columns=Math.floor((hi-lo-12)/lenStep), rows=Math.floor((right-left-12)/widthStep);
 const maxCells=180;
 for(let col=0;col<columns;col++)for(let row=0;row<rows;row++){
   const p=add(mul(long,lo+6+lenStep*(col+.5)),mul(short,left+6+widthStep*(row+.5)));
   const corners=[[3.029,1.219],[-3.029,1.219],[-3.029,-1.219],[3.029,-1.219]].map(([a,b])=>add(p,add(mul(long,a),mul(short,b))));
   if(corners.every(c=>contains(c,ring)))cells.push({p,level:1+(col*3+row+index)%5});
 }
 // distribute maxCells evenly across entire yard rather than filling only the first section
 const selected=cells.length<=maxCells?cells:Array.from({length:maxCells},(_,k)=>cells[Math.floor((k+.5)*cells.length/maxCells)]);
 // Assigned卸货点 is a source GIS point close to seaside boundary, never the yard center.
 const nearestCrane=quay.reduce((a,b)=>dist([b.position.x,b.position.y],center)<dist([a.position.x,a.position.y],center)?b:a);
 const near=unloadAll.map(p=>({p,b:boundaryDistance(p,ring),c:dist(p,[nearestCrane.position.x,nearestCrane.position.y])})).sort((a,b)=>a.b+0.055*a.c-(b.b+0.055*b.c));
 const pick=near.find(v=>v.b<85 && !isStack(v.p))??near[0];
 if(!pick)throw Error(`No GIS unload point near yard ${index+1}`);
 // Some GIS unloading points fall within container-yard polygons. Snap their AGV stop
 // toward the quay until it clears every stack polygon. Preserve original GIS anchor.
 const craneXY=[nearestCrane.position.x,nearestCrane.position.y];
 const direction=normalize(sub(craneXY,pick.p));
 let unload=pick.p;
 for(let delta=0;delta<=120;delta+=2){const candidate=add(pick.p,mul(direction,delta));
   if(!isStack(candidate) && allRings.every(r=>boundaryDistance(candidate,r)>3)){unload=candidate;break;}}
 if(isStack(unload))throw Error(`Unable to position sea-side handoff ${index+1} outside stacks`);
 // Model spans short axis, runs on rails along long axis. Rail is clipped to yard borders by margins.
 let gantryPos=center;
 let gantryScale=Math.max(.6,Math.min(1.2,(right-left-8)/25.64));
 // Keep the full crane footprint within the GIS yard polygon, not only its anchor.
 const fits=(p,scale)=>[-1,1].every(x=>[-1,1].every(z=>contains(add(p,add(mul(long,x*12.82*scale),mul(short,z*7.57*scale))),ring)));
 if(!fits(gantryPos,gantryScale)){
   const alternatives=selected.map(c=>c.p).sort((a,b)=>dist(a,center)-dist(b,center));
   let found=false;
   for(const testScale of [gantryScale,gantryScale*.9,gantryScale*.8,gantryScale*.7,gantryScale*.6]){
      const p=alternatives.find(p=>fits(p,testScale));
      if(p){gantryPos=p;gantryScale=testScale;found=true;break;}
   }
   if(!found)throw Error(`Unable to fit gantry model in ${index+1}`);
 }
 // A rail is safe ONLY if the complete 3D gantry footprint fits throughout
 // its travel, rather than merely keeping its pivot/anchor in the polygon.
 const railFit = delta => fits(add(gantryPos,mul(long,delta)),gantryScale);
 const travelLimit = 120;
 const safeTravel = direction => {
   let max = 0;
   for (let meters=1;meters<=travelLimit;meters++) {
     if (!railFit(direction*meters)) break;
     max=meters;
   }
   return max;
 };
 const travelBackward = safeTravel(-1),travelForward = safeTravel(1);
 const railStart = add(gantryPos,mul(long,-travelBackward));
 const railEnd = add(gantryPos,mul(long,travelForward));
 return {id:`YARD-${String(index+1).padStart(2,'0')}`,name:String(f.properties.Name||`堆场 ${index+1}`),boundary:ring.map(point),boundaryXY:ring,center:point(center),unload:point(unload),sourceUnload:point(pick.p),quayId:nearestCrane.id,
   axis:[+long[0].toFixed(6),+long[1].toFixed(6)],heading:Math.atan2(short[1],short[0]),gantry:{position:point(gantryPos),scale:gantryScale,railStart:point(railStart),railEnd:point(railEnd)},
   containers:selected.map((item,i)=>({id:`CNTR-${index+1}-${i+1}`,center:point(item.p),level:item.level,length:6.058,width:2.438,height:2.591}))};
});
// The labeled GIS卸货点 may be too far for the rail crane to lift.
// Preserve sourceUnload for provenance; synthesize a reachable seaside handoff
// outside all stack polygons with a 3m margin. DEMO bay, not a surveyed road.
for(const y of yards){
 const src=[y.sourceUnload.x,y.sourceUnload.y];
 const crane=quay.find(q=>q.id===y.quayId).position,q=[crane.x,crane.y];
 const a=[y.gantry.railStart.x,y.gantry.railStart.y],b=[y.gantry.railEnd.x,y.gantry.railEnd.y];
 const reach=15.5*y.gantry.scale+4;
 let best=null,score=Infinity;
 for(let i=0;i<=20;i++){
  const base=add(a,mul(sub(b,a),i/20));
  for(let theta=0;theta<360;theta+=12){
   const unit=[Math.cos(theta*Math.PI/180),Math.sin(theta*Math.PI/180)];
   for(let dd=5;dd<=Math.ceil(reach);dd+=1.5){
    const c=add(base,mul(unit,dd));
    if(isStack(c)||allRings.some(ring=>boundaryDistance(c,ring)<3))continue;
    if(dist(c,base)>reach)continue;
    const cost=dist(c,src)*.5+dist(c,q)*.5+dd*.18;
    if(cost<score){best=c;score=cost;}
   }
  }
 }
 if(!best){
  y.handoffReachable=false;
  y.unloadSource='original-labeled-GIS-point / crane reach unverified';
  y.hookReachMeters=reach;
  continue;
 }
 y.handoffReachable=true;
 y.originalUnload=y.unload;
 y.unload=point(best);
 y.unloadSource='generated-reachable-transfer-bay / 3m stack clearance';
 y.hookReachMeters=reach;
}
// Lightweight A* navigates around (never through) container polygons when a
// straight sea-side approach crosses a stack corner. 8 m grid, 2 m clearance.
const cellSize=8;
const allPoints=[...allRings.flat(),...unloadAll,...quay.map(c=>[c.position.x,c.position.y]),...buffer];
const minX=Math.min(...allPoints.map(p=>p[0]))-80, minY=Math.min(...allPoints.map(p=>p[1]))-80;
const maxX=Math.max(...allPoints.map(p=>p[0]))+80, maxY=Math.max(...allPoints.map(p=>p[1]))+80;
const nx=Math.ceil((maxX-minX)/cellSize),ny=Math.ceil((maxY-minY)/cellSize);
const at=(ix,iy)=>[minX+(ix+.5)*cellSize,minY+(iy+.5)*cellSize];
const grid=(p)=>[Math.max(0,Math.min(nx-1,Math.floor((p[0]-minX)/cellSize))),Math.max(0,Math.min(ny-1,Math.floor((p[1]-minY)/cellSize)))];
const blocked=new Map();
function cellBlocked(ix,iy){if(ix<0||iy<0||ix>=nx||iy>=ny)return true;const key=iy*nx+ix;
 if(!blocked.has(key)){let p=at(ix,iy);blocked.set(key, isStack(p)||allRings.some(r=>boundaryDistance(p,r)<1.8));}
 return blocked.get(key);}
const ringBounds=allRings.map(r=>[Math.min(...r.map(p=>p[0])),Math.min(...r.map(p=>p[1])),Math.max(...r.map(p=>p[0])),Math.max(...r.map(p=>p[1]))]);
function cross(a,b,c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
function segmentsCross(a,b,c,d){const ac=cross(a,b,c),ad=cross(a,b,d),ca=cross(c,d,a),cb=cross(c,d,b);return ac*ad<0&&ca*cb<0;}
function safeLine(a,b){
 const xmin=Math.min(a[0],b[0]),xmax=Math.max(a[0],b[0]),ymin=Math.min(a[1],b[1]),ymax=Math.max(a[1],b[1]);
 for(let k=0;k<allRings.length;k++){
  const [x0,y0,x1,y1]=ringBounds[k];if(xmax<x0||xmin>x1||ymax<y0||ymin>y1)continue;
  const ring=allRings[k];if(contains(a,ring)||contains(b,ring)||contains(mul(add(a,b),.5),ring))return false;
  for(let i=1;i<ring.length;i++)if(segmentsCross(a,b,ring[i-1],ring[i]))return false;
 }
 return true;
}
function heapPush(heap,el){heap.push(el);let i=heap.length-1;while(i>0){let j=(i-1)>>1;if(heap[j].f<=el.f)break;heap[i]=heap[j];i=j;}heap[i]=el;}
function heapPop(heap){const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(2*i+1<heap.length){let j=2*i+1;if(j+1<heap.length&&heap[j+1].f<heap[j].f)j++;if(heap[j].f>=last.f)break;heap[i]=heap[j];i=j;}heap[i]=last;}return first;}
function routeAround(a,b){if(safeLine(a,b))return [a,b];
 const [sx,sy]=grid(a),[ex,ey]=grid(b),start=sy*nx+sx,end=ey*nx+ex;
 const came=new Map(),best=new Map([[start,0]]),open=[];heapPush(open,{id:start,f:0,g:0});
 const directions=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
 let reached=false;
 while(open.length){const cur=heapPop(open);if(cur.g!==best.get(cur.id))continue;
  if(cur.id===end){reached=true;break;}
  const ix=cur.id%nx,iy=Math.floor(cur.id/nx);
  for(const [dx,dy] of directions){const x=ix+dx,y=iy+dy;if(cellBlocked(x,y))continue;
   const p0=at(ix,iy),p1=at(x,y);if(!safeLine(p0,p1))continue;
   const id=y*nx+x,g=cur.g+Math.hypot(dx,dy)*cellSize;
   if(g>=(best.get(id)??Infinity))continue;best.set(id,g);came.set(id,cur.id);
   heapPush(open,{id,g,f:g+Math.hypot(x-ex,y-ey)*cellSize});
  }
 }
 if(!reached)throw Error(`No safe route: ${a} -> ${b}`);
 const nodes=[];let id=end;while(id!==start){nodes.push(at(id%nx,Math.floor(id/nx)));id=came.get(id);if(id===undefined)throw Error('broken A* path');}
 nodes.push(at(sx,sy));nodes.reverse();
 const path=[a,...nodes,b],simplified=[path[0]];let i=0;
 while(i<path.length-1){let j=path.length-1;while(j>i+1&&!safeLine(path[i],path[j]))j--;simplified.push(path[j]);i=j;}
 for(let k=1;k<simplified.length;k++)if(!safeLine(simplified[k-1],simplified[k]))throw Error('Route intersects container block');
 return simplified;
}
// Reachable in 3D is not enough: also require a traversable A* AGV approach.
// Check once per yard before emitting ANY route to keep all route endpoints stable.
for(const y of yards){
 if(!y.handoffReachable||!y.originalUnload)continue;
 const crane=quay.find(q=>q.id===y.quayId).position;
 try{routeAround([crane.x,crane.y],[y.unload.x,y.unload.y]);}
 catch(error){
  y.unload=y.originalUnload;
  y.handoffReachable=false;
  y.unloadSource='original-accessible-GIS-handoff / crane reach unverified';
 }
}
const PARKING_COUNT=155;

const parking=sampleBand(buffer,PARKING_COUNT).map(point);
// Source-level safety check: container centers and 4 corners never cross polygon boundaries.
for(const y of yards){if(!contains([y.gantry.position.x,y.gantry.position.y],y.boundaryXY))throw Error(`Gantry outside ${y.id}`);
 for(const c of y.containers){if(!contains([c.center.x,c.center.y],y.boundaryXY))throw Error(`container outside ${y.id}`);}}
const layout={synthetic:true,coordinateSystem:'BD09/local-meter',source:'uploaded GIS polygons and labeled unloading points',origin:anchor,standardContainer:{length:6.058,width:2.438,height:2.591},quayCranes:quay,yards:yards.map(({boundaryXY,...rest})=>rest),parkingBuffer:{name:'AGV缓冲区',boundary:buffer.map(point),spots:parking},agvTransferZone:{name:'AGV装卸区',boundary:transferArea.map(point)}};
// Saved only after route accessibility checks; inaccessible candidate bays are reverted.
const defs=JSON.parse(fs.readFileSync(path.join(OUT,'agv_fleet.json'),'utf8')).vehicles;
// Collision-aware route assistance for the *simulated* parked AGV row.
// A buffer bay has ~14.7m pitch. Crossing at the midpoint leaves ~7.3m to
// each parked centre; straight map-to-map A* routes otherwise cross the row.
const parkPoint=p=>[p.x,p.y];
function parkingSafe(path,own=-1){
 for(let j=1;j<path.length;j++){
  const a=path[j-1],b=path[j];
  for(let k=0;k<parking.length;k++){
   if(k===own)continue;
   if(nearSegment(parkPoint(parking[k]),a,b).distance<5.1)return false;
  }
 }
 return true;
}
const crossingGaps=parking.slice(1).map((p,k)=>{
 const prev=parking[k],mid=mul(add(parkPoint(prev),parkPoint(p)),.5);
 const tang=normalize(sub(parkPoint(p),parkPoint(prev)));
 return {index:k,mid,normal:[tang[1],-tang[0]]};
});
function routeAvoidParked(a,b,own=-1){
 const original=routeAround(a,b);
 if(parkingSafe(original,own))return {points:original,verified:true};
 const nearest=crossingGaps.map(g=>({g,proximity:nearSegment(g.mid,a,b).distance}))
 .sort((p,q)=>p.proximity-q.proximity).slice(0,8);
 let winner=null,best=Infinity;
 for(const {g} of nearest){
  const signed=dot(sub(a,g.mid),g.normal),side=signed>=0?1:-1;
  const approach=add(g.mid,mul(g.normal,side*24));
  const depart=add(g.mid,mul(g.normal,-side*24));
  try{
   if(!safeLine(approach,g.mid)||!safeLine(g.mid,depart))continue;
   if(!safeLine(a,approach)||!safeLine(depart,b))continue;
   const before=[a,approach],after=[depart,b];
   const candidate=[...before,g.mid,depart,...after.slice(1)];
   if(!parkingSafe(candidate,own))continue;
   const length=candidate.slice(1).reduce((n,p,i)=>n+dist(p,candidate[i]),0);
   if(length<best){best=length;winner=candidate;}
  }catch{}
 }
 return winner?{points:winner,verified:true}:{points:original,verified:false};
}

// A route deliberately uses exactly one unloaded handoff position; no driving inside container-stack polygons.
const routes=defs.map((def,i)=>{
 const yard=yards[i%yards.length],crane=quay.find(q=>q.id===yard.quayId),spot=parking[i];
 const quayP=crane.position;
 let unload=yard.unload;
 const origin=point([spot.x,spot.y]);
 // Shared lane follows the sea-side corridor between quay crane and yard unload point.
 // Actual terminal roads require survey/safety GIS and are not represented as authorized routes.
 // Leave the tightly packed 155-bay parking strip perpendicular to its axis.
 // A straight route directly toward QC previously ran through the next parked AGV.
 const before=parking[Math.max(0,i-1)],after=parking[Math.min(parking.length-1,i+1)];
 const tangent=normalize(sub([after.x,after.y],[before.x,before.y]));
 const south=[tangent[1],-tangent[0]];
 const base=[spot.x,spot.y];
 let exit=add(base,mul(south,26));
 if(!safeLine(base,exit))exit=add(base,mul(south,-26));
 if(!safeLine(base,exit))throw Error(`Parking lane exit intersects a stack: ${def.id}`);
 const pickupRouting=routeAvoidParked(exit,[quayP.x,quayP.y],i);
 const pickupPath=[base,...pickupRouting.points].map(point);
 const loadedRouting=routeAvoidParked([quayP.x,quayP.y],[unload.x,unload.y],i);
 const loadedPath=loadedRouting.points.map(point);
 const returnRouting=routeAvoidParked([unload.x,unload.y],exit,i);
 const returnPath=[...returnRouting.points,base].map(point);
 const make=(phase,coords,speed,dwell,areaId)=>({phase,speedMps:speed,dwellSeconds:dwell,areaId,points:coords});
 return {trafficVerified:pickupRouting.verified&&loadedRouting.verified&&returnRouting.verified,routeId:`IMPORT-AGV-${String(i+1).padStart(3,'0')}`,agvId:def.id,synthetic:true,source:'quay positions / labeled GIS unloading points / named AGV buffer polygon',routeBasis:'quay pickup -> seaside transfer point -> EMPTY return -> named buffer idle; no container-yard driving',containerAreaIds:[yard.id],yardId:yard.id,quayCraneId:`QC-${String(crane.id).padStart(2,'0')}`,unloadingPoint:unload,parkingPoint:origin,
  phases:[
    make('QUAY_PICKUP',pickupPath,5.5,10,'QUAY'),
    make('YARD_STACK',loadedPath,4.5,12,yard.id),
    make('RETURN_BUFFER',returnPath,5.5,0,'BUFFER'),
    make('PARKING',[origin,origin],0,36,'BUFFER'),
    make('CHARGING',[origin,origin],0,12,'BUFFER')
  ]};
});
for (const yard of yards)delete yard.originalUnload;
fs.writeFileSync(path.join(OUT,'port_layout.json'),JSON.stringify(layout));
fs.writeFileSync(path.join(OUT,'agv_routes_gis.json'),JSON.stringify({synthetic:true,routeCount:routes.length,coordinateSystem:{type:'BD09/local-meter'},sourceVectors:['container_yards.geojson','quay_cranes.geojson','operational_polygons.geojson'],routeGeneration:'GIS handoff based; stack excluded',routes}));
console.log(`Generated: ${yards.length} yard polygons, ${yards.reduce((s,y)=>s+y.containers.length,0)} ISO containers, ${quay.length} quay cranes, ${PARKING_COUNT} buffer slots, ${routes.length} AGV routes`);
