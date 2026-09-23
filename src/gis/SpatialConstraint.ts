import type { GeoJSONFeatureCollection, MultiPolygon, Polygon, Ring } from "./GeoJSONTypes";

export interface LonLat { lng: number; lat: number; }

function pointInRing(point: LonLat, ring: Ring): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const hit = ((yi > point.lat) !== (yj > point.lat)) &&
            point.lng < (xj - xi) * (point.lat - yi) / ((yj - yi) || Number.EPSILON) + xi;
        if (hit) inside = !inside;
    }
    return inside;
}

function pointInPolygon(point: LonLat, polygon: Polygon): boolean {
    if (!polygon.length || !pointInRing(point, polygon[0])) return false;
    for (let i = 1; i < polygon.length; i++) {
        if (pointInRing(point, polygon[i])) return false;
    }
    return true;
}

function pointInMultiPolygon(point: LonLat, multi: MultiPolygon): boolean {
    return multi.some(polygon => pointInPolygon(point, polygon));
}

function extractPolygons(data: GeoJSONFeatureCollection): MultiPolygon {
    const result: MultiPolygon = [];
    for (const feature of data.features ?? []) {
        const geometry = feature.geometry;
        if (!geometry) continue;
        if (geometry.type === "Polygon") result.push(geometry.coordinates as Polygon);
        if (geometry.type === "MultiPolygon") result.push(...geometry.coordinates as MultiPolygon);
    }
    return result;
}

export class SpatialConstraint {
    private readonly allowed: MultiPolygon;
    private readonly forbidden: MultiPolygon;

    /**
     * `allowedGeoJSON` is the driving envelope. For the Yangshan AGV model this is
     * the operational polygons: AGVs drive in the free-space lanes BETWEEN the
     * 集装箱 blocks. `forbiddenGeoJSON` is the container-yard polygons, cut out as
     * exclusion zones so no trajectory ever crosses a block.
     */
    constructor(allowedGeoJSON: GeoJSONFeatureCollection, forbiddenGeoJSON?: GeoJSONFeatureCollection) {
        this.allowed = extractPolygons(allowedGeoJSON);
        this.forbidden = forbiddenGeoJSON ? extractPolygons(forbiddenGeoJSON) : [];
        if (!this.allowed.length) throw new Error("No allowed operational polygons found.");
    }

    containsAllowed(point: LonLat): boolean {
        return pointInMultiPolygon(point, this.allowed);
    }

    isContainer(point: LonLat): boolean {
        return pointInMultiPolygon(point, this.forbidden);
    }

    isDriveable(point: LonLat): boolean {
        return this.containsAllowed(point) && !this.isContainer(point);
    }

    /** 对折线做采样检查，避免只检查顶点导致直线穿过集装箱区域。 */
    isDriveableSegment(a: LonLat, b: LonLat, stepMeters = 8): boolean {
        const distanceMeters = Math.hypot((b.lng - a.lng) * 95000, (b.lat - a.lat) * 111000);
        const steps = Math.max(1, Math.ceil(distanceMeters / stepMeters));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const p = { lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t };
            if (!this.isDriveable(p)) return false;
        }
        return true;
    }

    validateRoute(points: LonLat[]): boolean {
        if (points.length < 2) return false;
        for (const point of points) if (!this.isDriveable(point)) return false;
        for (let i = 1; i < points.length; i++) {
            if (!this.isDriveableSegment(points[i - 1], points[i])) return false;
        }
        return true;
    }
}
