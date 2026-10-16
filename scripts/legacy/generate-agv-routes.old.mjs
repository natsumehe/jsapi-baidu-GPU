#!/usr/bin/env node
// Generate 155 Yangshan Phase IV AGV lifecycle trajectories.
//
// Operating model (matches real 洋山四期 AGV behaviour):
//   - Every AGV works ONE container-yard block (uploaded jizhuangxiangport polygon).
//     Its whole load/transport/unload trajectory stays INSIDE that polygon, so the
//     fleet is concentrated in the 集装箱 polygon region rather than roaming the
//     whole operational envelope.
//   - The block is linked to its nearest quay crane (吊桥, uploaded yangshangdiaoqiao
//     point) by a narrow connecting corridor. QUAY_PICKUP / RETURN_QUAY drive along
//     this corridor; the crane is the ship-side lifecycle anchor.
//   - Trajectories never leave (container-polygon ∪ its crane corridor), so they can
//     never exceed the terminal / road-network extent.
//
// Pure Node (no shapely / no deps): point-in-polygon + segment sampling done here.

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
const CORRIDOR_HALF = 9;   // metres, half-width of the crane→block corridor
const ENTRY_INSET = 10;    // metres the corridor pushes inside the block boundary

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

// lng/lat helpers ----------------------------------------------------------
const toM = pt => [pt[0] * MX, pt[1] * MY];
const meters = (a, b) => Math.hypot((a[0] - b[0]) * MX, (a[1] - b[1]) * MY);

function local(xy) {
    return {
        longitude: round7(xy[0]),
        latitude: round7(xy[1]),
        x: round3((xy[0] - ANCHOR[0]) * MX),
        y: round3((xy[1] - ANCHOR[1]) * MY)
    };
}

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

// Distance (metres) from p to segment a-b, plus the closest point in lng/lat.
function segNearest(p, a, b) {
    const [px, py] = toM(p), [ax, ay] = toM(a), [bx, by] = toM(b);
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

function bbox(ring) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of ring) {
        minx = Math.min(minx, p[0]); miny = Math.min(miny, p[1]);
        maxx = Math.max(maxx, p[0]); maxy = Math.max(maxy, p[1]);
    }
    return { minx, miny, maxx, maxy };
}

// ---------------------------------------------------------------------------
// Load uploaded GIS vectors.
const containerFeatures = readJSON(path.join(GIS, "container_yards.geojson")).features
    .filter(f => f.geometry && f.geometry.type === "Polygon")
    .map(f => f.geometry.coordinates[0])
    .filter(r => Array.isArray(r) && r.length >= 4);

const cranes = readJSON(path.join(GIS, "quay_cranes.geojson")).features
    .filter(f => f.geometry && f.geometry.type === "Point")
    .map(f => ({
        id: Number(f.properties?.id ?? 0),
        name: String(f.properties?.name ?? f.properties?.Name ?? "吊桥"),
        xy: [Number(f.geometry.coordinates[0]), Number(f.geometry.coordinates[1])]
    }));

if (!containerFeatures.length) throw new Error("No container-yard polygons.");
if (!cranes.length) throw new Error("No quay cranes.");

// Per-block metadata: nearest crane + corridor entry point pushed inside.
const blocks = containerFeatures.map((ring, index) => {
    const c = centroid(ring);
    let crane = cranes[0];
    let craneDist = Infinity;
    for (const cr of cranes) {
        const d = meters(cr.xy, c);
        if (d < craneDist) { craneDist = d; crane = cr; }
    }
    // Entry = nearest boundary point of this block to its crane.
    let entry = ring[0];
    let entryDist = Infinity;
    for (let i = 0; i < ring.length - 1; i++) {
        const { dist, point } = segNearest(crane.xy, ring[i], ring[i + 1]);
        if (dist < entryDist) { entryDist = dist; entry = point; }
    }
    // Push the entry a few metres inside the block toward the centroid.
    const dxM = (c[0] - entry[0]) * MX, dyM = (c[1] - entry[1]) * MY;
    const dLen = Math.hypot(dxM, dyM) || 1;
    let entryInside = [entry[0] + (dxM / dLen) * (ENTRY_INSET / MX), entry[1] + (dyM / dLen) * (ENTRY_INSET / MY)];
    if (!pointInRing(entryInside, ring)) entryInside = c;
    return { ring, box: bbox(ring), centroid: c, crane, entry, entryInside };
});

function randomPointInBlock(block, tries = 6000) {
    const { box, ring } = block;
    for (let i = 0; i < tries; i++) {
        const p = [box.minx + rng() * (box.maxx - box.minx), box.miny + rng() * (box.maxy - box.miny)];
        if (pointInRing(p, ring)) return p;
    }
    return block.centroid.slice();
}

function randomTarget(block, awayFrom, minGap) {
    for (let i = 0; i < 1200; i++) {
        const p = randomPointInBlock(block);
        if (!awayFrom || meters(p, awayFrom) >= minGap) return p;
    }
    return randomPointInBlock(block);
}

// Driveable = inside this block OR within the crane corridor half-width.
function driveable(pt, block) {
    if (pointInRing(pt, block.ring)) return true;
    return segNearest(pt, block.crane.xy, block.entryInside).dist <= CORRIDOR_HALF;
}

function driveableSegment(a, b, block, step = 5) {
    const d = meters(a, b);
    const n = Math.max(1, Math.ceil(d / step));
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        if (!driveable([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], block)) return false;
    }
    return true;
}

// Meandering trajectory whose every accepted chord stays driveable.
function walk(start, target, block, stepsMin, stepsMax) {
    let cur = start.slice();
    const out = [cur];
    const count = stepsMin + Math.floor(rng() * (stepsMax - stepsMin + 1));
    for (let step = 0; step < count; step++) {
        const remaining = meters(cur, target);
        let cand;
        if (step >= count - 3 || remaining < 40) {
            cand = target;
        } else {
            const ang = Math.atan2(target[1] - cur[1], target[0] - cur[0]) + (rng() - 0.5) * 2.2;
            const dist = Math.min(remaining * 0.4, 20 + rng() * 55);
            cand = [cur[0] + (Math.cos(ang) * dist) / MX, cur[1] + (Math.sin(ang) * dist) / MY];
        }
        if (meters(cur, cand) >= 4 && driveableSegment(cur, cand, block)) {
            out.push(cand); cur = cand; continue;
        }
        // Short valid detour when a chord would leave the block.
        let ok = false;
        for (let k = 0; k < 40; k++) {
            const ang = rng() * Math.PI * 2;
            const dist = 12 + rng() * 45;
            const p = [cur[0] + (Math.cos(ang) * dist) / MX, cur[1] + (Math.sin(ang) * dist) / MY];
            if (driveableSegment(cur, p, block)) { out.push(p); cur = p; ok = true; break; }
        }
        if (!ok) continue;
    }
    if (driveableSegment(cur, target, block)) out.push(target);
    // Drop near-duplicate samples.
    const clean = [];
    for (const p of out) if (!clean.length || meters(clean[clean.length - 1], p) > 2) clean.push(p);
    return clean.length >= 2 ? clean : [start, target];
}

// ---------------------------------------------------------------------------
const routes = [];
for (let i = 0; i < N; i++) {
    const block = blocks[i % blocks.length];
    const crane = block.crane;
    const craneXY = crane.xy;
    const entry = block.entryInside;

    // Three in-block work anchors: stacking target, parking bay, charging bay.
    const yardTarget = randomTarget(block, entry, 45);
    const parking = randomTarget(block, yardTarget, 35);
    const charging = randomTarget(block, parking, 25);

    // QUAY_PICKUP: crane → block entry (corridor) → a little into the block.
    const pickupInner = walk(entry, yardTarget, block, 2, 4).slice(0, 2);
    const quay = [craneXY, entry, ...pickupInner.slice(1)];
    // YARD_STACK: main loaded transport across the block to the stacking point.
    const yard = walk(quay[quay.length - 1], yardTarget, block, 8, 16);
    // PARKING: short repositioning to the parking bay.
    const park = walk(yard[yard.length - 1], parking, block, 3, 6);
    // CHARGING: crawl to the charging bay (kept short so most AGVs stay moving).
    const charge = walk(park[park.length - 1], charging, block, 3, 6);
    // RETURN_QUAY: back through the block to the entry, then along the corridor.
    const back = walk(charge[charge.length - 1], entry, block, 8, 16);
    const ret = [...back, craneXY];

    const specs = [
        ["QUAY_PICKUP", 5.5, 5, "QUAY", quay],
        ["YARD_STACK", 4.5, 6, "YARD", yard],
        ["PARKING", 3.0, 3, "PARKING", park],
        ["CHARGING", 2.0, 6, "CHARGING", charge],
        ["RETURN_QUAY", 5.5, 4, "QUAY", ret]
    ];

    const phases = [];
    for (const [name, speed, dwell, area, rawPath] of specs) {
        let pathPts = rawPath.map(p => [Number(p[0]), Number(p[1])]);
        if (pathPts.length < 2) pathPts = [pathPts[0], pathPts[0]];
        for (let s = 1; s < pathPts.length; s++) {
            if (!driveableSegment(pathPts[s - 1], pathPts[s], block)) {
                throw new Error(`Route escaped block: AGV-${String(i + 1).padStart(3, "0")} ${name} seg ${s}`);
            }
        }
        phases.push({
            phase: name, speedMps: speed, dwellSeconds: dwell, areaId: area,
            points: pathPts.map(local)
        });
    }

    routes.push({
        routeId: `CNTR-BLOCK-LIFECYCLE-${String(i + 1).padStart(3, "0")}`,
        agvId: `AGV-${String(i + 1).padStart(3, "0")}`,
        synthetic: true,
        source: "uploaded: jizhuangxiangport(container polygons) + yangshangdiaoqiao(quay cranes); road_network kept as reference",
        routeBasis: "AGV lifecycle trajectory is confined to one uploaded container-yard polygon plus a corridor to its nearest quay crane; concentrated inside the 集装箱 polygon region and bounded by the terminal road extent.",
        containerAreaIds: [`BLOCK-${String((i % blocks.length) + 1).padStart(2, "0")}`],
        quayCraneId: `QC-${String(crane.id).padStart(2, "0")}`,
        quayCraneName: crane.name,
        quayCranePoint: local(craneXY),
        yardPoint: local(yardTarget),
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
        trajectoryModel: "per-block deterministic random walk inside container polygons + crane connecting corridor",
        driveable: "one container-yard polygon ∪ its crane corridor",
        corridorHalfWidthM: CORRIDOR_HALF,
        cranePolicy: "ship-side lifecycle anchor (pickup start / return end)",
        roadNetworkPolicy: "reference visualization only; trajectories never exceed the terminal road extent"
    },
    routes
};

fs.writeFileSync(OUT, JSON.stringify(payload));
console.log("generated", routes.length, "routes; blocks", blocks.length, "cranes", cranes.length);
console.log("route[0] phases", routes[0].phases.map(p => [p.phase, p.points.length]));
