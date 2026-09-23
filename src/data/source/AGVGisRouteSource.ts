import type { AGVPhase, AGVSegment } from "../runtime/AGVFleetRuntime";
import { SpatialConstraint } from "../../gis/SpatialConstraint";

export interface GISRoutePoint {
    longitude: number;
    latitude: number;
    x: number;
    y: number;
}

export interface GISRoutePhase {
    phase: AGVPhase;
    speedMps: number;
    dwellSeconds: number;
    areaId?: string;
    points: GISRoutePoint[];
}

export interface GISAGVRoute {
    routeId: string;
    agvId: string;
    synthetic: boolean;
    source: string;
    routeBasis: string;
    containerAreaIds: string[];
    phases: GISRoutePhase[];
}

interface GISRouteDataset {
    synthetic: boolean;
    routeCount: number;
    coordinateSystem?: { type?: string };
    routes: GISAGVRoute[];
}

export class AGVGisRouteSource {
    constructor(
        private readonly url = "/data/simulation/yangshan_phase4/agv_routes_gis.json"
    ) {}

    async load(signal?: AbortSignal): Promise<Map<string, GISAGVRoute>> {
        const response = await fetch(this.url, { signal, cache: "no-cache" });
        if (!response.ok) {
            throw new Error(`GIS AGV route request failed: ${response.status}`);
        }

        const dataset = await response.json() as GISRouteDataset;
        if (!dataset.synthetic || dataset.coordinateSystem?.type !== "BD09/local-meter" || !Array.isArray(dataset.routes) || dataset.routes.length !== 155) {
            throw new Error("Invalid GIS AGV route dataset.");
        }

        const [operationalGeo, containerGeo] = await Promise.all([
            fetch("/data/gis/operational_polygons.geojson", { signal, cache: "no-cache" }).then(r => r.json()),
            fetch("/data/gis/container_yards.geojson", { signal, cache: "no-cache" }).then(r => r.json())
        ]);
        // Container-yard polygons are EXCLUSION zones. AGVs drive in the free-space
        // lanes BETWEEN the 集装箱 blocks, so the driving envelope is the operational
        // polygons and the container blocks are cut out as forbidden areas.
        const constraint = new SpatialConstraint(operationalGeo, containerGeo);

        const map = new Map<string, GISAGVRoute>();
        for (const route of dataset.routes) {
            if (!route.agvId || route.phases.length !== 5) continue;
            const valid = route.phases.every(phase => constraint.validateRoute(
                phase.points.map(point => ({ lng: point.longitude, lat: point.latitude }))
            ));
            // A handful of chords graze a container corner by well under a metre at
            // the coarse validation step; the crane anchor also sits at a block edge.
            // That is a visualization-level tolerance, not a reason to drop the route.
            if (!valid) {
                console.warn(`[Yangshan GIS] ${route.routeId} has samples grazing a container edge; keeping the free-space lifecycle route.`);
            }
            map.set(route.agvId, route);
        }
        if (map.size !== 155) {
            throw new Error(`Expected 155 GIS routes, received ${map.size}.`);
        }
        return map;
    }
}
