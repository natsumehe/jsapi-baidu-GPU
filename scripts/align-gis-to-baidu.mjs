import fs from "node:fs";

const CONFIG = {
  sourceX: 13583417,
  sourceY: 3688475,
  targetLng: 122.032598,
  targetLat: 30.662465,
  earthRadius: 6378137
};

function outOfChina(lng, lat) { return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271; }
function transformLat(x,y){let r=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x));r+=(20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3;r+=(20*Math.sin(y*Math.PI)+40*Math.sin(y/3*Math.PI))*2/3;r+=(160*Math.sin(y/12*Math.PI)+320*Math.sin(y*Math.PI/30))*2/3;return r;}
function transformLng(x,y){let r=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));r+=(20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3;r+=(20*Math.sin(x*Math.PI)+40*Math.sin(x/3*Math.PI))*2/3;r+=(150*Math.sin(x/12*Math.PI)+300*Math.sin(x/30*Math.PI))*2/3;return r;}
function wgsToGcj(p){if(outOfChina(p.lng,p.lat))return p;const dLat=transformLat(p.lng-105,p.lat-35),dLng=transformLng(p.lng-105,p.lat-35),rad=p.lat*Math.PI/180,magic=1-.00669342162296594323*Math.sin(rad)**2,s=Math.sqrt(magic);return{lng:p.lng+dLng*180/(6378245*Math.cos(rad)/s*Math.PI),lat:p.lat+dLat*180/(6335552.717000426*magic/(s*Math.PI))};}
function gcjToWgs(p){if(outOfChina(p.lng,p.lat))return p;let g={...p};for(let i=0;i<6;i++){const t=wgsToGcj(g);g.lng+=p.lng-t.lng;g.lat+=p.lat-t.lat;}return g;}
function bdToGcj(p){const x=p.lng-.0065,y=p.lat-.006,z=Math.sqrt(x*x+y*y)-.00002*Math.sin(y*Math.PI*3000/180),t=Math.atan2(y,x)-.000003*Math.cos(x*Math.PI*3000/180);return{lng:z*Math.cos(t),lat:z*Math.sin(t)};}
function gcjToBd(p){const z=Math.sqrt(p.lng*p.lng+p.lat*p.lat)+.00002*Math.sin(p.lat*Math.PI*3000/180),t=Math.atan2(p.lat,p.lng)+.000003*Math.cos(p.lng*Math.PI*3000/180);return{lng:z*Math.cos(t)+.0065,lat:z*Math.sin(t)+.006};}
function toM(p){return{x:CONFIG.earthRadius*p.lng*Math.PI/180,y:CONFIG.earthRadius*Math.log(Math.tan(Math.PI/4+p.lat*Math.PI/360))};}
function fromM(x,y){return{lng:x/CONFIG.earthRadius*180/Math.PI,lat:(2*Math.atan(Math.exp(y/CONFIG.earthRadius))-Math.PI/2)*180/Math.PI};}
const targetWgs=gcjToWgs(bdToGcj({lng:CONFIG.targetLng,lat:CONFIG.targetLat}));
const targetM=toM(targetWgs);
function convertXY(x,y){const p=fromM(targetM.x+(x-CONFIG.sourceX),targetM.y+(y-CONFIG.sourceY));return gcjToBd(wgsToGcj(p));}
function walk(c){if(Array.isArray(c[0]))return c.map(walk);return convertXY(c[0],c[1]).toTuple;}
function transformCoordinates(c){if(Array.isArray(c[0]))return c.map(transformCoordinates);const p=convertXY(c[0],c[1]);return[p.lng,p.lat];}
function transformGeometry(g){return{...g,coordinates:transformCoordinates(g.coordinates)};}
const [, , input, output] = process.argv;
if(!input||!output){console.error('Usage: node scripts/align-gis-to-baidu.mjs input.geojson output.geojson');process.exit(2);}
const data=JSON.parse(fs.readFileSync(input,'utf8'));
if(data.type==='FeatureCollection') data.features=data.features.map(f=>({...f,geometry:f.geometry?transformGeometry(f.geometry):f.geometry}));
else if(data.type==='Feature') data.geometry=transformGeometry(data.geometry);
else throw new Error('Only GeoJSON Feature/FeatureCollection is supported.');
data.crs={type:'name',properties:{name:'BD09',registration:{source:'EPSG:3857',sourceX:CONFIG.sourceX,sourceY:CONFIG.sourceY,targetLng:CONFIG.targetLng,targetLat:CONFIG.targetLat}}};
fs.writeFileSync(output,JSON.stringify(data));
console.log(`aligned ${input} -> ${output}`);
