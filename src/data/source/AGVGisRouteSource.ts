import type { AGVPhase } from '../runtime/AGVFleetRuntime';
import { loadPortGeometry } from '../../simulation/yangshan/PortGeometry';
export interface GISRoutePoint { longitude:number;latitude:number;x:number;y:number }
export interface GISRoutePhase { phase:AGVPhase;speedMps:number;dwellSeconds:number;areaId?:string;points:GISRoutePoint[] }
export interface GISAGVRoute {
    routeId:string;agvId:string;synthetic:boolean;source:string;routeBasis:string;
    containerAreaIds:string[];yardId:string;quayCraneId:string;trafficVerified?:boolean;
    unloadingPoint:GISRoutePoint;parkingPoint:GISRoutePoint;phases:GISRoutePhase[];
}
interface GISRouteDataset {
    synthetic:boolean;routeCount:number;
    coordinateSystem:{type?:string};routes:GISAGVRoute[];
}
const close=(a:GISRoutePoint,b:GISRoutePoint)=>Math.hypot(a.x-b.x,a.y-b.y)<.02;
/** Validate endpoint role and phases; the generation tests separately enforce
 * every segment excludes the container-yard footprint. Do not silently load old routes.
 */
export class AGVGisRouteSource {
    constructor(private readonly url='/data/simulation/yangshan_phase4/agv_routes_gis.json'){}
    async load(signal?:AbortSignal):Promise<Map<string,GISAGVRoute>>{
        const [response,layout]=await Promise.all([fetch(this.url,{signal,cache:'no-cache'}),loadPortGeometry(signal)]);
        if(!response.ok)throw Error(`GIS AGV route request failed: ${response.status}`);
        const data=await response.json() as GISRouteDataset;
        if(!data.synthetic||data.coordinateSystem?.type!=='BD09/local-meter'||data.routes.length!==155)
            throw Error('Invalid GIS AGV route dataset');
        const phases:AGVPhase[]=['QUAY_PICKUP','YARD_STACK','RETURN_BUFFER','PARKING','CHARGING'];
        const result=new Map<string,GISAGVRoute>();
        for(const route of data.routes){
            const yard=layout.yards.find(y=>y.id===route.yardId);
            const q=layout.quayCranes.find(c=>`QC-${String(c.id).padStart(2,'0')}`===route.quayCraneId);
            if(!yard||!q||route.phases.length!==5 || !phases.every((p,i)=>p===route.phases[i]?.phase))throw Error(`Invalid route roles: ${route.agvId}`);
            const [pickup,loaded,empty,waiting,charging]=route.phases;
            if(!close(pickup.points[0],route.parkingPoint)||!close(pickup.points.at(-1)!,q.position)||
                !close(loaded.points[0],q.position)||!close(loaded.points.at(-1)!,yard.unload)||
                !close(empty.points[0],yard.unload)||!close(empty.points.at(-1)!,route.parkingPoint)||
                !close(waiting.points[0],route.parkingPoint)||!close(charging.points[0],route.parkingPoint)){
                throw Error(`Wrong terminal handoff / buffer endpoint: ${route.agvId}`);
            }
            if(result.has(route.agvId))throw Error(`Duplicate AGV ID ${route.agvId}`);
            result.set(route.agvId,route);
        }
        if(result.size!==155)throw Error(`Expected 155 GIS routes, got ${result.size}`);
        return result;
    }
}
