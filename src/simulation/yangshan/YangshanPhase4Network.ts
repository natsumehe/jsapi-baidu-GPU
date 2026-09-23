import { CoordinateSystem, type GeoPoint } from "../../map/CoordinateSystem";
import { YANGSHAN_SCENE, type SceneZone } from "./YangshanSceneConfig";

export interface XY {
    x: number;
    y: number;
}

export interface FacilityPoint extends XY {
    id: string;
}

interface Edge { to: string; cost: number; }
interface Node extends XY { id: string; }

/**
 * Yangshan Phase IV road graph authored in the same 1728x864 reference frame
 * as the supplied satellite/route concept image, then converted to a local
 * ENU coordinate system around 122.032722, 30.658429.
 *
 * The graph is synthetic: it matches the visible road organization of the
 * reference image but is NOT an official production lane centerline dataset.
 */
export class YangshanPhase4Network {
    readonly lanes: XY[][] = [];
    readonly zones: SceneZone[] = [...YANGSHAN_SCENE.zones];
    readonly quayCranePoints: FacilityPoint[] = [];
    readonly yardPoints: FacilityPoint[] = [];
    readonly parkingPoints: FacilityPoint[] = [];
    readonly energyPoints: FacilityPoint[] = [];

    readonly origin: GeoPoint = {
        longitude: YANGSHAN_SCENE.anchor.longitude,
        latitude: YANGSHAN_SCENE.anchor.latitude,
        height: 0
    };

    private readonly nodes = new Map<string, Node>();
    private readonly graph = new Map<string, Edge[]>();

    constructor() {
        this.build();
    }

    localToGeo(point: XY): GeoPoint {
        return new CoordinateSystem(this.origin).localToGeo({ x: point.x, y: point.y, z: 0 });
    }

    geoToLocal(point: GeoPoint): XY {
        const local = new CoordinateSystem(this.origin).geoToLocal(point);
        return { x: local.x, y: local.y };
    }

    referencePixelToLocal(px: number, py: number): XY {
        return {
            x: (px - YANGSHAN_SCENE.anchorPixel.x) * YANGSHAN_SCENE.metersPerReferencePixel,
            y: (YANGSHAN_SCENE.anchorPixel.y - py) * YANGSHAN_SCENE.metersPerReferencePixel
        };
    }

    route(from: XY, to: XY): XY[] {
        const start = this.nearestFacilityNode(from);
        const goal = this.nearestFacilityNode(to);

        const open = new Set<string>([start.id]);
        const cameFrom = new Map<string, string>();
        const g = new Map<string, number>([[start.id, 0]]);
        const f = new Map<string, number>([[start.id, this.distance(start, goal)]]);

        while (open.size > 0) {
            let current = start.id;
            let currentScore = Number.POSITIVE_INFINITY;
            for (const id of open) {
                const score = f.get(id) ?? Number.POSITIVE_INFINITY;
                if (score < currentScore) {
                    current = id;
                    currentScore = score;
                }
            }

            if (current === goal.id) {
                const ids = [current];
                let cursor = current;
                while (cameFrom.has(cursor)) {
                    cursor = cameFrom.get(cursor)!;
                    ids.push(cursor);
                }
                ids.reverse();
                const path = ids.map(id => {
                    const node = this.nodes.get(id)!;
                    return { x: node.x, y: node.y };
                });
                if (this.distance(path[0], from) > 0.5) path.unshift({ ...from });
                if (this.distance(path[path.length - 1], to) > 0.5) path.push({ ...to });
                return this.removeCollinear(path);
            }

            open.delete(current);
            for (const edge of this.graph.get(current) ?? []) {
                const tentative = (g.get(current) ?? Number.POSITIVE_INFINITY) + edge.cost;
                if (tentative < (g.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
                    cameFrom.set(edge.to, current);
                    g.set(edge.to, tentative);
                    const target = this.nodes.get(edge.to)!;
                    f.set(edge.to, tentative + this.distance(target, goal));
                    open.add(edge.to);
                }
            }
        }

        throw new Error(`No Yangshan route from (${from.x}, ${from.y}) to (${to.x}, ${to.y}).`);
    }

    private build(): void {
        const frame = YANGSHAN_SCENE;
        const roadRefs: XY[][] = [];

        const laneBases = [245, 315, 385, 455, 525, 600];
        const xStart = 95;
        const xEnd = 1605;
        const slope = 0.108;

        const lanePoint = (laneIndex: number, xPx: number): XY => {
            const yPx = laneBases[laneIndex] + slope * (xPx - xStart);
            return frameToLocal(xPx, yPx);
        };

        // Longitudinal AGV corridors across the terminal.
        for (let laneIndex = 0; laneIndex < laneBases.length; laneIndex++) {
            const pixels: Array<[number, number]> = [];
            for (let x = xStart; x <= xEnd; x += 30) {
                pixels.push([x, laneBases[laneIndex] + slope * (x - xStart)]);
            }
            const lane = pixels.map(([x, y]) => frameToLocal(x, y));
            this.lanes.push(lane);
            roadRefs.push(lane);
        }

        // Cross-terminal connectors. They are intentionally slightly slanted,
        // following the perspective of the reference image rather than a grid.
        const connectorXs = [135, 380, 625, 870, 1115, 1360, 1580];
        for (const xBase of connectorXs) {
            const pixels: Array<[number, number]> = [];
            const top = laneBases[0] + slope * (xBase - xStart);
            const bottom = laneBases[laneBases.length - 1] + slope * (xBase - xStart);
            const drift = 16;
            for (let i = 0; i <= 12; i++) {
                const t = i / 12;
                pixels.push([xBase + drift * t, top + (bottom - top) * t]);
            }
            const connector = pixels.map(([x, y]) => frameToLocal(x, y));
            this.lanes.push(connector);
            roadRefs.push(connector);
        }

        // Northern collective / external roads visible above the yards.
        this.lanes.push(this.refPolyline([[120, 220], [430, 252], [760, 285], [1100, 320], [1515, 365]]));
        this.lanes.push(this.refPolyline([[185, 150], [500, 186], [850, 225], [1200, 265], [1600, 310]]));

        // Eastern parking/service ring and charging approach.
        this.lanes.push(this.refPolyline([[1450, 545], [1595, 560], [1640, 650], [1625, 750], [1470, 730], [1450, 650], [1450, 545]]));
        this.lanes.push(this.refPolyline([[1510, 420], [1620, 435], [1635, 540], [1590, 560]]));
        this.lanes.push(this.refPolyline([[1450, 610], [1595, 620]]));
        this.lanes.push(this.refPolyline([[1455, 660], [1610, 675]]));
        this.lanes.push(this.refPolyline([[1460, 710], [1600, 725]]));

        // Connect all near-touching lane samples to form a road graph.
        this.buildSampleGraph(roadRefs.concat(this.lanes.slice(roadRefs.length)), 28);

        // 29 quay-crane positions along the southern quay work road.
        for (let i = 0; i < 29; i++) {
            const xPx = 105 + (1495 * i) / 28;
            this.quayCranePoints.push({
                id: `QC-${String(i + 1).padStart(2, "0")}`,
                ...lanePoint(5, xPx)
            });
        }

        // 12 yard work points: 3 road bands × 4 columns, keeping every task
        // on an AGV corridor rather than inside the container stacks.
        let yardIndex = 1;
        for (const laneIndex of [1, 2, 4]) {
            for (const xPx of [255, 620, 985, 1350]) {
                this.yardPoints.push({
                    id: `YARD-${String(yardIndex).padStart(2, "0")}`,
                    ...lanePoint(laneIndex, xPx)
                });
                yardIndex++;
            }
        }

        // Parking bays: 5 rows × 31 slots, all attached to the eastern service ring.
        for (let i = 0; i < 155; i++) {
            const row = Math.floor(i / 31);
            const slot = i % 31;
            const xPx = 1480 + slot * 5.4;
            const yPx = 590 + row * 29;
            this.parkingPoints.push({
                id: `PARK-${String(row + 1).padStart(2, "0")}-${String(slot + 1).padStart(2, "02")}`,
                ...frameToLocal(xPx, yPx)
            });
        }

        for (let i = 0; i < 3; i++) {
            this.energyPoints.push({
                id: `BAY-${String(i + 1).padStart(2, "0")}`,
                ...frameToLocal(1600, 440 + i * 45)
            });
        }

        // Facility nodes connect into the closest road sample.
        const facilities = [
            ...this.quayCranePoints,
            ...this.yardPoints,
            ...this.parkingPoints,
            ...this.energyPoints
        ];
        for (const facility of facilities) {
            const nearest = this.nearestRoadNode(facility);
            const id = `f-${facility.id}`;
            this.addNode(id, facility);
            this.connect(id, nearest.id);
        }
    }

    private refPolyline(points: Array<[number, number]>): XY[] {
        return points.map(([x, y]) => frameToLocal(x, y));
    }

    private buildSampleGraph(lanes: XY[][], snapDistance: number): void {
        // Sample every lane into nodes, then connect consecutive samples.
        let index = 0;
        for (const lane of lanes) {
            let previousId: string | null = null;
            for (const point of lane) {
                const id = `r-${index++}`;
                this.addNode(id, point);
                if (previousId) this.connect(previousId, id);
                previousId = id;
            }
        }

        // Connect close samples from different lanes; these are physical road
        // intersections in the image-authored geometry.
        const nodes = [...this.nodes.values()].filter(node => node.id.startsWith("r-"));
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i];
                const b = nodes[j];
                const d = this.distance(a, b);
                if (d > 0 && d <= snapDistance && Math.abs(a.x - b.x) < snapDistance * 1.8) {
                    this.connect(a.id, b.id);
                }
            }
        }
    }

    private addNode(id: string, point: XY): void {
        if (this.nodes.has(id)) return;
        this.nodes.set(id, { id, x: point.x, y: point.y });
        this.graph.set(id, []);
    }

    private connect(a: string, b: string): void {
        if (a === b) return;
        const nodeA = this.nodes.get(a);
        const nodeB = this.nodes.get(b);
        if (!nodeA || !nodeB) return;
        const cost = this.distance(nodeA, nodeB);
        const edgesA = this.graph.get(a)!;
        const edgesB = this.graph.get(b)!;
        if (!edgesA.some(edge => edge.to === b)) edgesA.push({ to: b, cost });
        if (!edgesB.some(edge => edge.to === a)) edgesB.push({ to: a, cost });
    }

    private nearestRoadNode(point: XY): Node {
        let best: Node | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const node of this.nodes.values()) {
            if (!node.id.startsWith("r-")) continue;
            const d = this.distance(node, point);
            if (d < bestDistance) {
                bestDistance = d;
                best = node;
            }
        }
        if (!best) throw new Error("Yangshan road graph is empty.");
        return best;
    }

    private nearestFacilityNode(point: XY): Node {
        let best: Node | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const node of this.nodes.values()) {
            const d = this.distance(node, point);
            if (d < bestDistance) {
                bestDistance = d;
                best = node;
            }
        }
        if (!best) throw new Error("Yangshan graph has no nodes.");
        return best;
    }

    private distance(a: XY, b: XY): number {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    private removeCollinear(points: XY[]): XY[] {
        if (points.length <= 2) return points;
        const result: XY[] = [points[0]];
        for (let i = 1; i < points.length - 1; i++) {
            const a = result[result.length - 1];
            const b = points[i];
            const c = points[i + 1];
            const cross =
                (b.x - a.x) * (c.y - b.y) -
                (b.y - a.y) * (c.x - b.x);
            if (Math.abs(cross) > 2) result.push(b);
        }
        result.push(points[points.length - 1]);
        return result;
    }
}

function frameToLocal(x: number, y: number): XY {
    return {
        x: (x - YANGSHAN_SCENE.anchorPixel.x) * YANGSHAN_SCENE.metersPerReferencePixel,
        y: (YANGSHAN_SCENE.anchorPixel.y - y) * YANGSHAN_SCENE.metersPerReferencePixel
    };
}
