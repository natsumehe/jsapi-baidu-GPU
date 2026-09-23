export interface GeoPoint { lng: number; lat: number; }

/**
 * 用户给出的控制点。
 * 注意：标准 EPSG:3857 反算后，Y=3688475 会落到约 31.428°N；
 * 当前上传 GeoJSON 的实际空间位置与 Y=3588475 更吻合。
 * 因此代码保留用户值用于诊断，不静默把 3688475 当成正确值。
 */
export const USER_REFERENCE = {
    sourceCRS: "EPSG:3857",
    sourceX: 13583417,
    sourceY: 3688475,
    targetCRS: "BD09",
    targetLng: 122.032598,
    targetLat: 30.662465
} as const;

export const VERIFIED_DATASET_REFERENCE = {
    sourceCRS: "EPSG:3857",
    sourceX: 13583417,
    sourceY: 3588475,
    targetCRS: "BD09",
    targetLng: 122.032598,
    targetLat: 30.662465
} as const;

export function webMercatorToWgs84(x: number, y: number): GeoPoint {
    return {
        lng: x / 6378137 * 180 / Math.PI,
        lat: (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI
    };
}

export function wgs84ToWebMercator(point: GeoPoint): { x: number; y: number } {
    const lat = Math.max(-85.0511287798, Math.min(85.0511287798, point.lat));
    return {
        x: 6378137 * point.lng * Math.PI / 180,
        y: 6378137 * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))
    };
}

function outOfChina(lng: number, lat: number): boolean {
    return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}
function transformLat(x:number,y:number){let r=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x));r+=(20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3;r+=(20*Math.sin(y*Math.PI)+40*Math.sin(y/3*Math.PI))*2/3;r+=(160*Math.sin(y/12*Math.PI)+320*Math.sin(y*Math.PI/30))*2/3;return r;}
function transformLng(x:number,y:number){let r=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));r+=(20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3;r+=(20*Math.sin(x*Math.PI)+40*Math.sin(x/3*Math.PI))*2/3;r+=(150*Math.sin(x/12*Math.PI)+300*Math.sin(x/30*Math.PI))*2/3;return r;}
function wgs84ToGcj02(p:GeoPoint):GeoPoint{if(outOfChina(p.lng,p.lat))return p;const dLat=transformLat(p.lng-105,p.lat-35),dLng=transformLng(p.lng-105,p.lat-35),rad=p.lat*Math.PI/180,magic=1-.00669342162296594323*Math.sin(rad)**2,s=Math.sqrt(magic);return{lng:p.lng+dLng*180/(6378245*Math.cos(rad)/s*Math.PI),lat:p.lat+dLat*180/(6335552.717000426*magic/(s*Math.PI))};}
function gcj02ToBd09(p:GeoPoint):GeoPoint{const z=Math.sqrt(p.lng*p.lng+p.lat*p.lat)+.00002*Math.sin(p.lat*Math.PI*3000/180),t=Math.atan2(p.lat,p.lng)+.000003*Math.cos(p.lng*Math.PI*3000/180);return{lng:z*Math.cos(t)+.0065,lat:z*Math.sin(t)+.006};}
function bd09ToGcj02(p:GeoPoint):GeoPoint{const x=p.lng-.0065,y=p.lat-.006,z=Math.sqrt(x*x+y*y)-.00002*Math.sin(y*Math.PI*3000/180),t=Math.atan2(y,x)-.000003*Math.cos(x*Math.PI*3000/180);return{lng:z*Math.cos(t),lat:z*Math.sin(t)};}
function gcj02ToWgs84(p:GeoPoint):GeoPoint{if(outOfChina(p.lng,p.lat))return p;let g={...p};for(let i=0;i<6;i++){const t=wgs84ToGcj02(g);g.lng+=p.lng-t.lng;g.lat+=p.lat-t.lat;}return g;}

/** 使用已验证的数据控制点，把 EPSG:3857 的整个数据集刚性注册到 BD09。 */
export function align3857ToBd09(x:number,y:number):GeoPoint{
    const targetWgs=gcj02ToWgs84(bd09ToGcj02({lng:VERIFIED_DATASET_REFERENCE.targetLng,lat:VERIFIED_DATASET_REFERENCE.targetLat}));
    const targetM=wgs84ToWebMercator(targetWgs);
    return gcj02ToBd09(wgs84ToGcj02(webMercatorToWgs84(
        targetM.x + x - VERIFIED_DATASET_REFERENCE.sourceX,
        targetM.y + y - VERIFIED_DATASET_REFERENCE.sourceY
    )));
}

export function diagnoseUserReference(): { userPoint: GeoPoint; verifiedPoint: GeoPoint } {
    return {
        userPoint: webMercatorToWgs84(USER_REFERENCE.sourceX, USER_REFERENCE.sourceY),
        verifiedPoint: webMercatorToWgs84(VERIFIED_DATASET_REFERENCE.sourceX, VERIFIED_DATASET_REFERENCE.sourceY)
    };
}
