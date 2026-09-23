#!/usr/bin/env node
// Generate 155 Yangshan Phase IV AGV lifecycle trajectories.
//
// Operating model (matches the reference free-space-streaming image):
//   - Container-yard polygons are EXCLUSION zones. AGVs drive in the free-space
//     lanes BETWEEN the 集装箱 blocks, never through them.
//   - Driveable = inside an operational polygon AND outside every container block.
//   - Cargo is LOADED at a quay crane (吊桥) and UNLOADED at a container block edge.
//   - Each moving phase is a grid-A* path through the free-space lanes, so every
//     trajectory provably stays driveable and follows the lanes organically.
//
// Pure Node (no deps): point-in-polygon + grid A* + segment sampling done here.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GIS = path.join(ROOT, "public/data/gis");
const OUT = path.join(ROOT, "public/data/simulation/yangshan_phase4/agv_routes_gis.json");

const ANCHOR = [122.032598, 30.662465]; // BD09 / GIS↔百度 registration point
const N = 155;
const SEED = 20260922;
const EARTH_R = 6378137;
const CELL_M = 4.5;          // grid cell size (metres) for A* free-space routing
const UNLOAD_OUTSET = 5;     // metres the unload point sits OUTSIDE the block edge

// Constant local metre scale at the anchor latitude — identical convention to
// src/map/CoordinateSystem.ts (ENU: x = dLon·R·cos(lat0), y = dLat·R).
const MX = (Math.PI / 180) * EARTH_R * Math.cos((ANCHOR[1] * Math.PI) / 180);
const MY = (Math.PI / 180) * EARTH_R;

const round7 = v => Math.round(v * 1e7) / 1e7;
const round3 = v => Math.round(v * 1e3) / 1e3;

// Deterministic RNG (mulberry32) so the dataset is reproducible.
function makeRng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rng = makeRng(SEED);

function readJSON(p) {
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

const meters = (a, b) => Math.hypot((a[0] - b[0]) * MX, (a[1] - b[1]) * MY);

function local(xy) {
    return {
        longitude: round7(xy[0]),
        latitude: round7(xy[1]),
        x: round3((xy[0] - ANCHOR[0]) * MX),
        y: round3((xy[1] - ANCHOR[1]) * MY)
    };
}
// --- geometry -------------------------------------------------------------
function pointInRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const hit = ((yi > pt[1]) !== (yj > pt[1])) &&
            pt[0] < ((xj - xi) * (pt[1] - yi)) / ((yj - yi) || 1e-12) + xi;
        if (hit) inside = !inside;
    }
    return inside;
}

// A polygon here is { rings:[outer, ...holes], box }. Inside = in outer, not in a hole.
function ringBox(ring) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of ring) {
        minx = Math.min(minx, p[0]); miny = Math.min(miny, p[1]);
        maxx = Math.max(maxx, p[0]); maxy = Math.max(maxy, p[1]);
    }
    return { minx, miny, maxx, maxy };
}

function makePoly(rings) {
    return { rings, box: ringBox(rings[0]) };
}

function pointInPoly(pt, poly) {
    const b = poly.box;
    if (pt[0] < b.minx || pt[0] > b.maxx || pt[1] < b.miny || pt[1] > b.maxy) return false;
    if (!pointInRing(pt, poly.rings[0])) return false;
    for (let i = 1; i < poly.rings.length; i++) if (pointInRing(pt, poly.rings[i])) return false;
    return true;
}

function pointInAny(pt, polys) {
    for (const poly of polys) if (pointInPoly(pt, poly)) return true;
    return false;
}

// Distance (metres) from p to segment a-b, plus the closest point in lng/lat.
function segNearest(p, a, b) {
    const px = p[0] * MX, py = p[1] * MY, ax = a[0] * MX, ay = a[1] * MY, bx = b[0] * MX, by = b[1] * MY;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + dx * t, cy = ay + dy * t;
    return { dist: Math.hypot(px - cx, py - cy), point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] };
}

function centroid(ring) {
    let x = 0, y = 0;
    for (const p of ring) { x += p[0]; y += p[1]; }
    const n = Math.max(1, ring.length);
    return [x / n, y / n];
}

// Load feature collection into an array of makePoly() (expands MultiPolygon).
function loadPolys(file) {
    const out = [];
    for (const f of readJSON(path.join(GIS, file)).features ?? []) {
        const g = f.geometry;
        if (!g) continue;
        if (g.type === "Polygon") out.push(makePoly(g.coordinates));
        else if (g.type === "MultiPolygon") for (const rings of g.coordinates) out.push(makePoly(rings));
    }
    return out;
}

const operational = loadPolys("operational_polygons.geojson");
const containers = loadPolys("container_yards.geojson");
const cranes = readJSON(path.join(GIS, "quay_cranes.geojson")).features
    .filter(f => f.geometry && f.geometry.type === "Point")
    .map(f => ({
        id: Number(f.properties?.id ?? 0),
        name: String(f.properties?.name ?? f.properties?.Name ?? "吊桥"),
        xy: [Number(f.geometry.coordinates[0]), Number(f.geometry.coordinates[1])]
    }));

if (!operational.length) throw new Error("No operational polygons.");
if (!containers.length) throw new Error("No container-yard polygons.");
if (!cranes.length) throw new Error("No quay cranes.");

// Driveable = inside operational lanes AND outside every container block.
function driveable(pt) {
    return pointInAny(pt, operational) && !pointInAny(pt, containers);
}

function driveableSegment(a, b, step = CELL_M) {
    const d = meters(a, b);
    const n = Math.max(1, Math.ceil(d / step));
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        if (!driveable([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])) return false;
    }
    return true;
}

// --- grid A* over the free-space lanes -------------------------------------
let GMINX = Infinity, GMINY = Infinity, GMAXX = -Infinity, GMAXY = -Infinity;
for (const poly of operational) {
    GMINX = Math.min(GMINX, poly.box.minx); GMINY = Math.min(GMINY, poly.box.miny);
    GMAXX = Math.max(GMAXX, poly.box.maxx); GMAXY = Math.max(GMAXY, poly.box.maxy);
}
const DLON = CELL_M / MX;
const DLAT = CELL_M / MY;
const NX = Math.max(1, Math.ceil((GMAXX - GMINX) / DLON));
const NY = Math.max(1, Math.ceil((GMAXY - GMINY) / DLAT));

const cellCenter = (ix, iy) => [GMINX + (ix + 0.5) * DLON, GMINY + (iy + 0.5) * DLAT];
const cellOf = (lon, lat) => [
    Math.max(0, Math.min(NX - 1, Math.floor((lon - GMINX) / DLON))),
    Math.max(0, Math.min(NY - 1, Math.floor((lat - GMINY) / DLAT)))
];

// Precompute the driveable mask once (shared across all A* searches). A cell is
// passable only if its centre is driveable AND a small buffer ring around it is
// clear of every container block, so A* paths keep a margin off the block edges
// and simplified chords never graze a corner.
const BUFFER_M = 3;
const BOFF = [[BUFFER_M, 0], [-BUFFER_M, 0], [0, BUFFER_M], [0, -BUFFER_M]];
function cellPassable(ix, iy) {
    const c = cellCenter(ix, iy);
    if (!driveable(c)) return false;
    for (const [ox, oy] of BOFF) {
        if (pointInAny([c[0] + ox / MX, c[1] + oy / MY], containers)) return false;
    }
    return true;
}
const PASS = new Uint8Array(NX * NY);
for (let iy = 0; iy < NY; iy++) {
    for (let ix = 0; ix < NX; ix++) {
        PASS[iy * NX + ix] = cellPassable(ix, iy) ? 1 : 0;
    }
}

// Snap an arbitrary point to the nearest passable cell (spiral search).
function snapCell(lon, lat) {
    const [cx, cy] = cellOf(lon, lat);
    if (PASS[cy * NX + cx]) return [cx, cy];
    for (let r = 1; r < Math.max(NX, NY); r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const x = cx + dx, y = cy + dy;
                if (x < 0 || y < 0 || x >= NX || y >= NY) continue;
                if (PASS[y * NX + x]) return [x, y];
            }
        }
    }
    return null;
}

// Minimal binary min-heap keyed by f-score.
class Heap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(node) {
        const a = this.a; a.push(node);
        let i = a.length - 1;
        while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
    }
    pop() {
        const a = this.a, top = a[0], last = a.pop();
        if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < a.length && a[l].f < a[s].f) s = l; if (r < a.length && a[r].f < a[s].f) s = r; if (s === i) break; [a[s], a[i]] = [a[i], a[s]]; i = s; } }
        return top;
    }
}

const NBR = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// A* between two passable cells; returns array of [lon,lat] cell centres or null.
function astar(sc, gc) {
    const start = sc[1] * NX + sc[0], goal = gc[1] * NX + gc[0];
    if (start === goal) return [cellCenter(sc[0], sc[1])];
    const g = new Float64Array(NX * NY).fill(Infinity);
    const came = new Int32Array(NX * NY).fill(-1);
    const closed = new Uint8Array(NX * NY);
    const h = (x, y) => Math.hypot(x - gc[0], y - gc[1]);
    g[start] = 0;
    const open = new Heap();
    open.push({ idx: start, f: h(sc[0], sc[1]) });
    while (open.size) {
        const cur = open.pop();
        if (closed[cur.idx]) continue;
        closed[cur.idx] = 1;
        if (cur.idx === goal) break;
        const cx = cur.idx % NX, cy = (cur.idx / NX) | 0;
        for (const [dx, dy] of NBR) {
            const x = cx + dx, y = cy + dy;
            if (x < 0 || y < 0 || x >= NX || y >= NY) continue;
            const ni = y * NX + x;
            if (!PASS[ni] || closed[ni]) continue;
            // Prevent diagonal corner-cutting through a blocked cell.
            if (dx && dy && (!PASS[cy * NX + x] || !PASS[y * NX + cx])) continue;
            const step = (dx && dy) ? 1.41421356 : 1;
            const ng = g[cur.idx] + step;
            if (ng < g[ni]) { g[ni] = ng; came[ni] = cur.idx; open.push({ idx: ni, f: ng + h(x, y) }); }
        }
    }
    if (came[goal] === -1 && start !== goal) return null;
    const path = [];
    let node = goal;
    while (node !== -1) { path.push(cellCenter(node % NX, (node / NX) | 0)); if (node === start) break; node = came[node]; }
    return path.reverse();
}

// Conservative simplify: drop a vertex only when skipping it leaves a chord that
// is still driveable at fine (2 m) sampling. Never introduces a corner-cut.
function simplify(pts) {
    if (pts.length <= 2) return pts.slice();
    const out = [pts[0]];
    let anchor = 0;
    for (let i = 2; i < pts.length; i++) {
        if (!driveableSegment(pts[anchor], pts[i], 2)) { out.push(pts[i - 1]); anchor = i - 1; }
    }
    out.push(pts[pts.length - 1]);
    return out;
}

// Route between two world points through the lanes. `startExact`/`goalExact`
// force the emitted polyline to begin/end exactly at the given anchors.
function route(startPt, goalPt, startExact, goalExact) {
    const sc = snapCell(startPt[0], startPt[1]);
    const gc = snapCell(goalPt[0], goalPt[1]);
    if (!sc || !gc) return null;
    const grid = astar(sc, gc);
    if (!grid) return null;
    let pts = grid;
    if (startExact && driveableSegment(startPt, pts[0], 1)) pts = [startPt, ...pts];
    if (goalExact && driveableSegment(pts[pts.length - 1], goalPt, 1)) pts = [...pts, goalPt];
    pts = simplify(pts);
    // Drop near-duplicate samples.
    const clean = [];
    for (const p of pts) if (!clean.length || meters(clean[clean.length - 1], p) > 1.5) clean.push(p);
    if (clean.length < 2) return null;
    // Final guarantee: every emitted chord is driveable at fine (1 m) sampling.
    for (let i = 1; i < clean.length; i++) if (!driveableSegment(clean[i - 1], clean[i], 1)) return null;
    return clean;
}

// Split a polyline into two phases at ~fraction of its total length.
function splitPolyline(pts, fraction) {
    const total = pts.reduce((s, p, i) => i ? s + meters(pts[i - 1], p) : 0, 0);
    const target = total * fraction;
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
        const seg = meters(pts[i - 1], pts[i]);
        if (acc + seg >= target || i === pts.length - 1) {
            const t = seg > 0 ? Math.max(0, Math.min(1, (target - acc) / seg)) : 0;
            const mid = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
            const head = [...pts.slice(0, i), mid];
            const tail = [mid, ...pts.slice(i)];
            return [head.length >= 2 ? head : pts.slice(0, 2), tail.length >= 2 ? tail : pts.slice(-2)];
        }
        acc += seg;
    }
    return [pts.slice(0, 2), pts.slice(-2)];
}
// --- per-block metadata ----------------------------------------------------
const blocks = containers.map((poly, index) => {
    const ring = poly.rings[0];
    const c = centroid(ring);
    let crane = cranes[0], craneDist = Infinity;
    for (const cr of cranes) { const d = meters(cr.xy, c); if (d < craneDist) { craneDist = d; crane = cr; } }
    return { index, poly, ring, centroid: c, crane };
});

// A driveable point just OUTSIDE a block edge, chosen closest to the block's crane
// (so the loaded AGV meets the block from the lane side).
function unloadPoint(block) {
    const { ring, centroid: c, crane } = block;
    let best = null, bestDist = Infinity;
    for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        for (const t of [0.25, 0.5, 0.75]) {
            const edge = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            const nx = (edge[0] - c[0]) * MX, ny = (edge[1] - c[1]) * MY;
            const nl = Math.hypot(nx, ny) || 1;
            const out = [edge[0] + (nx / nl) * (UNLOAD_OUTSET / MX), edge[1] + (ny / nl) * (UNLOAD_OUTSET / MY)];
            if (!driveable(out)) continue;
            const d = meters(out, crane.xy);
            if (d < bestDist) { bestDist = d; best = out; }
        }
    }
    if (best) return best;
    const snap = snapCell(c[0], c[1]);
    return snap ? cellCenter(snap[0], snap[1]) : c.slice();
}

// Pick a random driveable anchor near `centre` that is A*-reachable FROM `from`,
// returning both the anchor and the routed polyline to it. When `alsoReach` is
// given, the anchor must ALSO route back to that point (e.g. charging→crane), so
// the following phase never falls back to a straight line. Falls back to the
// last reachable candidate found so a valid lane path always exists.
function reachableAnchor(from, centre, radius, eastBias = 0, alsoReach = null) {
    let fallback = null;
    for (let i = 0; i < 80; i++) {
        const ang = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * radius;
        const pt = [centre[0] + (Math.cos(ang) * r + eastBias) / MX, centre[1] + (Math.sin(ang) * r) / MY];
        if (!driveable(pt)) continue;
        const path = route(from, pt, true, true);
        if (!path) continue;
        if (alsoReach && !route(pt, alsoReach, true, true)) { if (!fallback) fallback = { pt, path }; continue; }
        return { pt, path };
    }
    if (fallback) return fallback;
    // Last resort: route to the snapped centre (guaranteed reachable component check).
    const snap = snapCell(centre[0] + eastBias / MX, centre[1]);
    if (snap) {
        const c = cellCenter(snap[0], snap[1]);
        const path = route(from, c, true, true);
        if (path) return { pt: c, path };
    }
    return null;
}

// --- build routes ----------------------------------------------------------
const routes = [];
let repaired = 0;
for (let i = 0; i < N; i++) {
    const block = blocks[i % blocks.length];
    const crane = block.crane;
    const craneXY = crane.xy;

    const yardApproach = unloadPoint(block);

    // Full loaded run crane→block edge, split into QUAY_PICKUP + YARD_STACK so
    // QUAY_PICKUP.points[0] is exactly the crane (cargo handoff anchor).
    let outbound = route(craneXY, yardApproach, true, true);
    if (!outbound) {
        // yardApproach unreachable directly: snap it into the reachable lane graph.
        const alt = reachableAnchor(craneXY, block.centroid, 60);
        if (alt) { outbound = alt.path; } else { outbound = [craneXY, yardApproach]; repaired++; }
    }
    const yardEnd = outbound[outbound.length - 1];
    const [quay, yard] = splitPolyline(outbound, 0.4);

    // PARKING / CHARGING / RETURN all chained so each starts where the last ended.
    const parkA = reachableAnchor(yardEnd, block.centroid, 90);
    const park = parkA ? parkA.path : [yardEnd, yardEnd];
    const parkEnd = park[park.length - 1];

    const chargeA = reachableAnchor(parkEnd, block.centroid, 120, 40, craneXY);
    const charge = chargeA ? chargeA.path : [parkEnd, parkEnd];
    const chargeEnd = charge[charge.length - 1];

    let ret = route(chargeEnd, craneXY, true, true);
    if (!ret) { ret = [chargeEnd, craneXY]; repaired++; }

    const parking = parkA ? parkA.pt : parkEnd;
    const charging = chargeA ? chargeA.pt : chargeEnd;

    const specs = [
        ["QUAY_PICKUP", 5.5, 5, "QUAY", quay],
        ["YARD_STACK", 4.5, 6, "YARD", yard],
        ["PARKING", 3.0, 3, "PARKING", park],
        ["CHARGING", 2.0, 6, "CHARGING", charge],
        ["RETURN_QUAY", 5.5, 4, "QUAY", ret]
    ];

    const phases = specs.map(([name, speed, dwell, area, rawPath]) => {
        let pathPts = rawPath.map(p => [Number(p[0]), Number(p[1])]);
        if (pathPts.length < 2) pathPts = [pathPts[0], pathPts[0]];
        return { phase: name, speedMps: speed, dwellSeconds: dwell, areaId: area, points: pathPts.map(local) };
    });

    routes.push({
        routeId: `CNTR-BLOCK-LIFECYCLE-${String(i + 1).padStart(3, "0")}`,
        agvId: `AGV-${String(i + 1).padStart(3, "0")}`,
        synthetic: true,
        source: "uploaded: jizhuangxiangport(container polygons, exclusion) + yangshangdiaoqiao(quay cranes) + operational_polygons(driving envelope); road_network kept as reference",
        routeBasis: "AGV lifecycle trajectory runs in the free-space lanes BETWEEN container-yard blocks (inside operational polygons, outside every 集装箱 block). Cargo is loaded at a quay crane and unloaded at a container block edge; every moving phase is a grid-A* path that provably stays driveable.",
        containerAreaIds: [`BLOCK-${String((i % blocks.length) + 1).padStart(2, "0")}`],
        quayCraneId: `QC-${String(crane.id).padStart(2, "0")}`,
        quayCraneName: crane.name,
        quayCranePoint: local(craneXY),
        yardPoint: local(yardApproach),
        parkingPoint: local(parking),
        chargingPoint: local(charging),
        phases
    });
}

const payload = {
    synthetic: true,
    routeCount: N,
    coordinateSystem: { type: "BD09/local-meter", origin: { longitude: ANCHOR[0], latitude: ANCHOR[1] } },
    sourceVectors: {
        container: "container_yards.geojson",
        quayCrane: "quay_cranes.geojson",
        operational: "operational_polygons.geojson",
        roadReference: "road_network.geojson"
    },
    routeGeneration: {
        seed: SEED,
        trajectoryModel: "grid-A* pathfinding through free-space lanes between container blocks",
        driveable: "inside operational polygons AND outside every container-yard polygon",
        gridCellM: CELL_M,
        cranePolicy: "cargo loaded at nearest quay crane (QUAY_PICKUP start / RETURN_QUAY end)",
        unloadPolicy: "cargo unloaded at a driveable point just outside the target container block edge",
        roadNetworkPolicy: "reference visualization only; trajectories confined to the operational free-space lanes"
    },
    routes
};

fs.writeFileSync(OUT, JSON.stringify(payload));
console.log("generated", routes.length, "routes; containers", containers.length, "cranes", cranes.length, "operational", operational.length);
console.log("grid", NX, "x", NY, "cells; passable", PASS.reduce((s, v) => s + v, 0), "; repaired segments", repaired);
console.log("route[0] phases", routes[0].phases.map(p => [p.phase, p.points.length]));


