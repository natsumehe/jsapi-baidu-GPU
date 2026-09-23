import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '../../..', 'baidu');
const OUT = path.join(ROOT, 'public/data/simulation/yangshan_phase4');
fs.mkdirSync(OUT, { recursive: true });

const ORIGIN = { longitude: 122.032722, latitude: 30.658429 };
const EARTH = 6378137;
const cosLat = Math.cos(ORIGIN.latitude * Math.PI / 180);

function localToGeo(x, y) {
  return {
    longitude: ORIGIN.longitude + (x / (EARTH * cosLat)) * 180 / Math.PI,
    latitude: ORIGIN.latitude + (y / EARTH) * 180 / Math.PI
  };
}

const horizontalY = [-700, -500, -250, 0, 250, 500, 700, 850, 1050];
const verticalX = [-1500, -1200, -900, -600, -300, 0, 300, 600, 900, 1200, 1500, 1650];
const nodes = new Map();
const graph = new Map();
const lanes = [];

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const addNode = (id, p) => { nodes.set(id, { id, ...p }); graph.set(id, []); };
const connect = (a, b) => {
  const cost = distance(nodes.get(a), nodes.get(b));
  graph.get(a).push({ to: b, cost });
  graph.get(b).push({ to: a, cost });
};

for (let yi = 0; yi < horizontalY.length; yi++) {
  const y = horizontalY[yi];
  lanes.push([{ x: -1700, y }, { x: 1650, y }]);
  for (let xi = 0; xi < verticalX.length; xi++) addNode(`r-${xi}-${yi}`, { x: verticalX[xi], y });
}
for (const x of verticalX) lanes.push([{ x, y: -700 }, { x, y: 850 }]);
lanes.push([{ x: 1650, y: -700 }, { x: 1650, y: 1050 }]);
lanes.push([{ x: 1350, y: 1050 }, { x: 1650, y: 1050 }]);
lanes.push([{ x: 1350, y: 850 }, { x: 1650, y: 850 }]);

for (let yi = 0; yi < horizontalY.length; yi++) {
  for (let xi = 0; xi < verticalX.length; xi++) {
    const id = `r-${xi}-${yi}`;
    if (xi + 1 < verticalX.length) connect(id, `r-${xi + 1}-${yi}`);
    if (yi + 1 < horizontalY.length) connect(id, `r-${xi}-${yi + 1}`);
  }
}

function nearestRoadNode(p) {
  let best = null;
  let d = Infinity;
  for (const node of nodes.values()) {
    if (!node.id.startsWith('r-')) continue;
    const nd = distance(node, p);
    if (nd < d) { d = nd; best = node; }
  }
  return best;
}

function addFacility(id, p) {
  const road = nearestRoadNode(p);
  addNode(id, p);
  connect(id, road.id);
}

const quayCranePoints = Array.from({ length: 29 }, (_, i) => ({
  id: `QC-${String(i + 1).padStart(2, '0')}`,
  x: -1500 + (i / 28) * 3000,
  y: -700
}));

const yardPoints = [];
const yardX = [-1050, -350, 350, 1050];
const yardY = [0, 350, 700];
let yi = 1;
for (const y of yardY) for (const x of yardX) yardPoints.push({ id: `YARD-${String(yi++).padStart(2, '0')}`, x, y });

const energyPoints = [700, 850, 1050].map((y, i) => ({ id: `BAY-${String(i + 1).padStart(2, '0')}`, x: 1650, y }));
const parkingPoints = [];
for (let i = 0; i < 155; i++) {
  const zone = Math.floor(i / 31);
  const slot = i % 31;
  parkingPoints.push({
    id: `PARK-${String(zone + 1).padStart(2, '0')}-${String(slot + 1).padStart(2, '0')}`,
    x: 1360 + slot * 9.1,
    y: 900 + zone * 28
  });
}

for (const p of [...quayCranePoints, ...yardPoints, ...energyPoints, ...parkingPoints]) addFacility(`f-${p.id}`, p);

function nearestNode(p) {
  let best = null; let d = Infinity;
  for (const node of nodes.values()) {
    const nd = distance(node, p);
    if (nd < d) { d = nd; best = node; }
  }
  return best;
}

function route(from, to) {
  const start = nearestRoadNode(from); const goal = nearestRoadNode(to);
  const open = new Set([start.id]);
  const came = new Map();
  const g = new Map([[start.id, 0]]);
  const f = new Map([[start.id, distance(start, goal)]]);
  while (open.size) {
    let current = [...open][0];
    for (const id of open) if ((f.get(id) ?? Infinity) < (f.get(current) ?? Infinity)) current = id;
    if (current === goal.id) {
      const ids = [current]; let c = current;
      while (came.has(c)) { c = came.get(c); ids.push(c); }
      ids.reverse();
      const path = ids.map(id => ({ x: nodes.get(id).x, y: nodes.get(id).y }));
      if (distance(path[0], from) > 1) path.unshift({ ...from });
      if (distance(path[path.length - 1], to) > 1) path.push({ ...to });
      return simplify(path);
    }
    open.delete(current);
    for (const edge of graph.get(current)) {
      const tentative = (g.get(current) ?? Infinity) + edge.cost;
      if (tentative < (g.get(edge.to) ?? Infinity)) {
        came.set(edge.to, current); g.set(edge.to, tentative);
        const target = nodes.get(edge.to);
        f.set(edge.to, tentative + distance(target, goal));
        open.add(edge.to);
      }
    }
  }
  throw new Error(`No route ${JSON.stringify(from)} -> ${JSON.stringify(to)} start=${start?.id} goal=${goal?.id}`);
}

function simplify(points) {
  if (points.length <= 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1], b = points[i], c = points[i + 1];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) > 1) out.push(b);
  }
  out.push(points.at(-1));
  return out;
}

function polyLength(points) { let d = 0; for (let i = 1; i < points.length; i++) d += distance(points[i - 1], points[i]); return d; }
function samplePolyline(points, distanceM) {
  if (points.length === 1) return { ...points[0] };
  let left = Math.max(0, distanceM);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], len = distance(a, b);
    if (left <= len || i === points.length - 1) {
      const t = len > 0 ? Math.max(0, Math.min(1, left / len)) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= len;
  }
  return { ...points.at(-1) };
}

function fmt(dt) {
  const p = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
}
function addSeconds(date, seconds) { return new Date(date.getTime() + seconds * 1000); }

const vehicles = [];
const routes = [];
const trajectory = [];
const tasks = [];
const baseStart = new Date('2026-09-10T08:00:00+08:00');

for (let i = 0; i < 155; i++) {
  const agvNo = i + 1;
  const id = `AGV-${String(agvNo).padStart(3, '0')}`;
  const berth = quayCranePoints[i % quayCranePoints.length];
  const yard = yardPoints[i % yardPoints.length];
  const parking = parkingPoints[i];
  const energy = energyPoints[i % energyPoints.length];

  const p1 = route(berth, yard);
  const p2 = route(yard, parking);
  const p3 = [{ ...parking }, { ...parking }];
  const p4 = route(parking, energy);
  const p5 = route(energy, berth);
  const segments = [
    ['QUAY_PICKUP', p1, 6.5, 8],
    ['YARD_STACK', p2, 5.7, 18],
    ['PARKING', p3, 0, 25],
    ['CHARGING', p4, 4.8, 35],
    ['RETURN_QUAY', p5, 6.5, 8]
  ];
  const phaseDistances = segments.map(([, pts]) => polyLength(pts));
  const travel = segments.map((s, idx) => phaseDistances[idx] / Math.max(s[2], 0.1));
  const cycle = travel.reduce((sum, x, idx) => sum + x + segments[idx][3], 0);
  const offset = (i * 37) % Math.max(1, Math.floor(cycle));
  const taskId = `TAA-20260910-${String(agvNo).padStart(6, '0')}`;
  const routeId = `ROUTE-${id}-001`;

  const start = addSeconds(baseStart, i * 12);
  const free1Arr = start;
  const free1End = addSeconds(start, 10);
  const full1Arr = addSeconds(start, Math.max(20, travel[0] * 0.68));
  const full1End = addSeconds(full1Arr, 18);
  const full2Arr = addSeconds(full1End, Math.max(10, travel[0] * 0.25));
  const full2End = addSeconds(full2Arr, 20);
  const workEnd = addSeconds(full2End, Math.max(10, travel[1] * 0.75));
  const free2Arr = addSeconds(workEnd, 5);
  const free2End = addSeconds(free2Arr, 10);
  const taskEnd = addSeconds(start, cycle);

  const first = samplePolyline(p1, Math.min(1, phaseDistances[0]));
  const firstGeo = localToGeo(first.x, first.y);

  vehicles.push({
    id,
    assetId: 'agv-glb',
    berthId: berth.id,
    yardId: yard.id,
    parkingZoneId: `PARK-${String(Math.floor(i / 31) + 1).padStart(2, '0')}`,
    parkingSlot: i + 1,
    energyStationId: energy.id,
    speedMps: 5.5 + (i % 6) * 0.35,
    battery: 45 + ((i * 11) % 50),
    phaseOffset: offset / cycle,
    initialLongitude: firstGeo.longitude,
    initialLatitude: firstGeo.latitude,
    taskId,
    routeId
  });

  routes.push({
    routeId,
    agvId: id,
    origin: ORIGIN,
    phases: segments.map(([phase, pts, speedMps, dwellSeconds]) => ({
      phase,
      speedMps,
      dwellSeconds,
      points: pts.map(p => ({ ...localToGeo(p.x, p.y), x: p.x, y: p.y }))
    }))
  });

  tasks.push({
    TAA_ID: taskId,
    TAA_DATE: '2026-09-10',
    TAA_SHIFT: 2,
    TAA_WKNO: `W${String((i % 8) + 1).padStart(2, '0')}`,
    TAA_CHE_TYPE: 'AGV',
    TAA_MOVE_KIND: i % 2 ? 'EXPORT' : 'IMPORT',
    TAA_AGV_ID: id,
    TAA_DRIVER: 'SIM',
    TAA_DRIVENAME: 'Simulation AGV',
    TAA_CNTRID: `CNTR-${String(agvNo).padStart(7, '0')}`,
    TAA_AGO_GROUP_ID: `AGO-G-${String((i % 29) + 1).padStart(2, '0')}`,
    TAA_CSIZECD: i % 3 === 0 ? '20' : '40',
    TAA_CSTATUSCD: 'FULL',
    TAA_DNGCD: 'N',
    TAA_OVLMTCD: 'N',
    TAA_CTYPECD: i % 3 === 0 ? '20GP' : '40HQ',
    TAA_SETTMPT: null,
    TAA_WK_STTIME: fmt(start),
    TAA_WK_EDTIME: fmt(taskEnd),
    TAA_FREE1_ARRTIME: fmt(free1Arr),
    TAA_FREE1_EDTIME: fmt(free1End),
    TAA_FREE2_ARRTIME: fmt(free2Arr),
    TAA_FREE2_EDTIME: fmt(free2End),
    TAA_FULL1_ARRTIME: fmt(full1Arr),
    TAA_FULL1_EDTIME: fmt(full1End),
    TAA_FULL2_ARRTIME: fmt(full2Arr),
    TAA_FULL2_EDTIME: fmt(full2End),
    TAA_CONTRACTOR: 'SYNTHETIC',
    TAA_VOY_ID: `VOY-${String((i % 18) + 1).padStart(3, '0')}`,
    TAA_CNL_WAIT_SECONDS: Math.round(4 + (i % 12)),
    TAA_CNL_AGO_ID: `AGO-${String(agvNo).padStart(6, '0')}`,
    TAA_PRIOR_EDTIME: fmt(addSeconds(start, 180)),
    TAA_VALIDFG: 'Y',
    TAA_WI_ID: `WI-${String(agvNo).padStart(7, '0')}`,
    TAA_ORC_ID: `ORC-${String(agvNo).padStart(7, '0')}`,
    TAA_CNTRNO: `SYN${String(agvNo).padStart(7, '0')}`,
    TAA_CREATEUSER: 'SIMULATOR',
    TAA_FREE_PB_ARRTIME: fmt(addSeconds(start, 5)),
    TAA_FREE_PB_EDTIME: fmt(addSeconds(start, 8)),
    TAA_FULL_PB_ARRTIME: fmt(addSeconds(full1Arr, -8)),
    TAA_FULL_PB_EDTIME: fmt(addSeconds(full1Arr, -3)),
    TAA_FREE1_ST_TP_ID: `TP-F1-S-${agvNo}`,
    TAA_FREE1_ED_TP_ID: `TP-F1-E-${agvNo}`,
    TAA_FREE2_ST_TP_ID: `TP-F2-S-${agvNo}`,
    TAA_FREE2_ED_TP_ID: `TP-F2-E-${agvNo}`,
    TAA_FULL1_ST_TP_ID: `TP-L1-S-${agvNo}`,
    TAA_FULL1_ED_TP_ID: `TP-L1-E-${agvNo}`,
    TAA_FULL2_ST_TP_ID: `TP-L2-S-${agvNo}`,
    TAA_FULL2_ED_TP_ID: `TP-L2-E-${agvNo}`,
    TAA_FREE_PB_ID: `PB-FREE-${String((i % 12) + 1).padStart(2, '0')}`,
    TAA_FULL_PB_ID: `PB-FULL-${String((i % 12) + 1).padStart(2, '0')}`,
    TAA_MILEAGE: Math.round((phaseDistances.reduce((a, b) => a + b, 0)) * 10) / 10,
    TAA_CREATEDT: fmt(baseStart)
  });

  // Full-cycle trajectory sample: one state every 5 s, including lon/lat.
  const sampleStep = 5;
  for (let sec = 0; sec < Math.ceil(cycle); sec += sampleStep) {
    let cursor = (offset + sec) % cycle;
    let phaseIndex = 0;
    let phaseProgress = 0;
    for (let s = 0; s < segments.length; s++) {
      const travelSec = travel[s];
      if (cursor <= travelSec) {
        phaseIndex = s;
        phaseProgress = travelSec > 0 ? cursor / travelSec : 1;
        break;
      }
      cursor -= travelSec;
      if (cursor <= segments[s][3]) {
        phaseIndex = s;
        phaseProgress = 1;
        break;
      }
      cursor -= segments[s][3];
      phaseIndex = Math.min(s + 1, segments.length - 1);
    }
    const [, pts, speedMps] = segments[phaseIndex];
    const dist = phaseDistances[phaseIndex] * phaseProgress;
    const pos = samplePolyline(pts, dist);
    const next = samplePolyline(pts, Math.min(phaseDistances[phaseIndex], dist + 1));
    const heading = Math.atan2(next.y - pos.y, next.x - pos.x);
    const geo = localToGeo(pos.x, pos.y);
    trajectory.push({
      agvId: id,
      taskId,
      routeId,
      timestamp: addSeconds(start, sec).toISOString(),
      longitude: Number(geo.longitude.toFixed(8)),
      latitude: Number(geo.latitude.toFixed(8)),
      heading: Number(heading.toFixed(5)),
      speedMps: Number((speedMps || 0).toFixed(2)),
      phase: segments[phaseIndex][0],
      battery: Math.max(18, Math.min(100, 85 - sec / cycle * 34 + (phaseIndex === 3 ? 15 : 0)))
    });
  }
}

const fleet = {
  scenario: 'yangshan_phase4_tos_agv_synthetic',
  vehicleCount: 155,
  synthetic: true,
  coordinateSystem: { type: 'local-enu', origin: ORIGIN },
  anchor: ORIGIN,
  vehicles
};

fs.writeFileSync(path.join(OUT, 'agv_fleet.json'), JSON.stringify(fleet, null, 2));
fs.writeFileSync(path.join(OUT, 'agv_routes.json'), JSON.stringify({ synthetic: true, routeCount: routes.length, routes }, null, 2));
fs.writeFileSync(path.join(OUT, 'TOS_STA_AGV_CNTR_INFOS.json'), JSON.stringify({ table: 'TOS_STA_AGV_CNTR_INFOS', synthetic: true, rowCount: tasks.length, rows: tasks }, null, 2));
fs.writeFileSync(path.join(OUT, 'AGV_TRAJECTORY.json'), JSON.stringify({ synthetic: true, rowCount: trajectory.length, coordinateSystem: { type: 'WGS84-like geographic output for Baidu adapter', anchor: ORIGIN }, rows: trajectory }, null, 2));
fs.writeFileSync(path.join(OUT, 'AGV_TRAJECTORY.jsonl'), trajectory.map(x => JSON.stringify(x)).join('\n') + '\n');

const headers = Object.keys(tasks[0]);
const csv = [headers.join(','), ...tasks.map(row => headers.map(k => JSON.stringify(row[k] ?? '')).join(','))].join('\n');
fs.writeFileSync(path.join(OUT, 'TOS_STA_AGV_CNTR_INFOS.csv'), csv + '\n');

console.log(`Generated 155 AGVs, ${tasks.length} TOS rows and ${trajectory.length} trajectory samples.`);
console.log(`Anchor: ${ORIGIN.longitude}, ${ORIGIN.latitude}`);
