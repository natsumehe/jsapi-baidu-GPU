// AUTO-GENERATED from src/data/runtime/AGVFleetRuntime.ts. Do not edit.
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
/**
 * Event-driven import demo fleet. Vehicles remain in surveyed buffer slots until
 * explicitly dispatched; after unloading they drive back and stay parked.
 * Acceleration, service braking, heading slew, collision time-gap and deterministic
 * resource ownership are simulated (not a safety-certified AGV controller).
 */
export class AGVFleetRuntime {
    coordinateSystem;
    vehicles = [];
    running = true;
    simulationSpeed = 1;
    yardSlots = [];
    /** GIS-derived navigable graph. QC connectors are screened against yard polygons;
     * only the source GIS QC->yard corridors may terminate at a Gantry. */
    quayGraph = new Map();
    quayPositions = new Map();
    yardEntrances = new Map();
    edgeReservations = new Map();
    tick = 0;
    clockSeconds = 0;
    continuousWorkload = false;
    sceneSeeded = false;
    historyLimit = 3600;
    sampleInterval = .25;
    accel = 1.15;
    decel = 1.9;
    turnRate = 0.52;
    maxLateral = 1.5;
    vehicleLength = 7.2;
    vehicleWidth = 3.0;
    gap = 3.2;
    timeHeadway = 1.4;
    constructor(coordinateSystem) {
        this.coordinateSystem = coordinateSystem;
    }
    load(definitions, gisRoutes, yardSlots = [], forbiddenYards = []) {
        this.yardSlots = yardSlots.map(p => ({ ...p }));
        this.vehicles.length = 0;
        this.clockSeconds = 0;
        this.sceneSeeded = false;
        this.quayGraph.clear();
        this.quayPositions.clear();
        this.yardEntrances.clear();
        this.edgeReservations.clear();
        const variantsByQuay = new Map();
        const quayPositions = new Map();
        for (const [index, def] of definitions.entries()) {
            const route = gisRoutes?.get(def.id);
            if (!route)
                continue;
            const segment = route.phases[1];
            quayPositions.set(route.quayCraneId, segment.points[0]);
            const variant = { yardId: route.yardId, routeId: route.routeId, segment: { phase: 'YARD_STACK',
                    points: segment.points.map(p => ({ x: p.x, y: p.y })), speedMps: segment.speedMps, dwellSeconds: segment.dwellSeconds },
                yardSlot: yardSlots[index] ?? route.phases[1].points.at(-1) };
            const yardRoutes = this.yardEntrances.get(route.yardId) ?? [];
            if (!yardRoutes.some(e => e.quay === route.quayCraneId)) {
                yardRoutes.push({ quay: route.quayCraneId, segment: variant.segment,
                    yardSlot: { ...variant.yardSlot }, routeId: route.routeId });
                this.yardEntrances.set(route.yardId, yardRoutes);
            }
            const options = variantsByQuay.get(route.quayCraneId) ?? [];
            if (!options.some(o => o.yardId === variant.yardId))
                options.push(variant);
            variantsByQuay.set(route.quayCraneId, options);
        }
        // Optional synthetic QC-to-QC interchanges create a bipartite many-to-many
        // experiment topology. Only nearby QC pairs are considered, and the entire
        // connector segment is checked against every supplied yard polygon.
        // They are NOT surveyed lanes or industrially validated traffic routes.
        const orientation = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        const onSegment = (a, b, p) => Math.min(a.x, b.x) - 1e-5 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-5 &&
            Math.min(a.y, b.y) - 1e-5 <= p.y && p.y <= Math.max(a.y, b.y) + 1e-5;
        const crosses = (a, b, c, d) => {
            const x = orientation(a, b, c), y = orientation(a, b, d), z = orientation(c, d, a), w = orientation(c, d, b);
            return (x * y < 0 && z * w < 0) ||
                (Math.abs(x) < 1e-7 && onSegment(a, b, c)) || (Math.abs(y) < 1e-7 && onSegment(a, b, d)) ||
                (Math.abs(z) < 1e-7 && onSegment(c, d, a)) || (Math.abs(w) < 1e-7 && onSegment(c, d, b));
        };
        const inside = (point, poly) => {
            let yes = false;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                const a = poly[i], b = poly[j];
                if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x)
                    yes = !yes;
            }
            return yes;
        };
        const clear = (a, b) => forbiddenYards.every(poly => {
            if (inside(a, poly) || inside(b, poly) || inside({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, poly))
                return false;
            for (let i = 0; i < poly.length; i++)
                if (crosses(a, b, poly[i], poly[(i + 1) % poly.length]))
                    return false;
            return true;
        });
        if (forbiddenYards.length) {
            const direct = [...variantsByQuay].map(([key, options]) => [key, [...options]]);
            for (const [originKey, originOptions] of direct) {
                const a = quayPositions.get(originKey);
                for (const [targetKey, targetOptions] of direct) {
                    if (originKey === targetKey)
                        continue;
                    const b = quayPositions.get(targetKey);
                    if (dist(a, b) > 145 || !clear(a, b))
                        continue;
                    for (const v of targetOptions) {
                        if (originOptions.some(o => o.yardId === v.yardId))
                            continue;
                        originOptions.push({ yardId: v.yardId, routeId: `SYN-${originKey}-${v.yardId}`,
                            segment: { ...v.segment, points: [{ ...a }, ...v.segment.points.map(p => ({ ...p }))] },
                            yardSlot: { ...v.yardSlot }, syntheticConnector: true });
                    }
                }
                originOptions.sort((a, b) => a.yardId.localeCompare(b.yardId));
                variantsByQuay.set(originKey, originOptions);
            }
        }
        this.quayPositions = new Map(quayPositions);
        // Build a shared *geometry* graph, not shared vehicle itineraries. Every AGV
        // later computes its own start-to-pickup-to-yard path and can choose a different
        // route on its next task. Yard nodes are never used as through-roads.
        for (const [id] of quayPositions)
            this.quayGraph.set(id, []);
        const quayList = [...quayPositions.entries()];
        for (let i = 0; i < quayList.length; i++)
            for (let j = i + 1; j < quayList.length; j++) {
                const [a, pa] = quayList[i], [b, pb] = quayList[j];
                if (dist(pa, pb) > 145 || (forbiddenYards.length > 0 && !clear(pa, pb)))
                    continue;
                const distance = dist(pa, pb), id = `QC-LINK:${[a, b].sort().join(':')}`;
                this.quayGraph.get(a).push({ to: b, points: [{ ...pa }, { ...pb }], length: distance, id });
                this.quayGraph.get(b).push({ to: a, points: [{ ...pb }, { ...pa }], length: distance, id });
            }
        for (let index = 0; index < definitions.length; index++) {
            const definition = definitions[index], route = gisRoutes?.get(definition.id);
            if (!route || route.phases.length !== 5)
                throw Error(`Missing GIS route for ${definition.id}`);
            const original = route.phases.map(s => ({ phase: s.phase, points: s.points.map(p => ({ x: p.x, y: p.y })), speedMps: s.speedMps, dwellSeconds: s.dwellSeconds }));
            // Yard -> quay returns on the validated reverse cargo corridor; a separate
            // quay -> buffer segment is used ONLY when no new assignment remains.
            const reverse = (s, phase) => ({ phase, points: [...s.points].reverse().map(p => ({ ...p })), speedMps: s.speedMps, dwellSeconds: 0 });
            const segments = [original[0], original[1], { ...reverse(original[1], 'RETURN_QUAY'), dwellSeconds: original[0].dwellSeconds },
                reverse(original[0], 'RETURN_BUFFER'), original[3], original[4]];
            const phaseDistances = segments.map(s => s.points.slice(1).reduce((sum, p, i) => sum + dist(p, s.points[i]), 0));
            const vehicle = { definition, segments, phaseDistances, phaseIndex: 4, distance: 0, dwell: 0, active: false, speed: 0, heading: 0, waitingForTraffic: false, taskCompleted: 0, taskNumber: 0, state: null,
                quayCraneId: route.quayCraneId, homeQuayCraneId: route.quayCraneId,
                currentQuayCraneId: route.quayCraneId, homePickup: { ...original[0], points: original[0].points.map(p => ({ ...p })) },
                assignedYardId: route.yardId, assignedRouteId: route.routeId, variants: variantsByQuay.get(route.quayCraneId) ?? [],
                history: [], sampleClock: 0, sampleNumber: 0, initialSceneZone: null };
            const park = segments[4].points[0];
            const toward = segments[0].points[Math.min(1, segments[0].points.length - 1)];
            vehicle.heading = Math.atan2(toward.y - park.y, toward.x - park.x);
            vehicle.state = this.makeState(vehicle, park, 0);
            this.seedSyntheticHistory(vehicle);
            this.vehicles.push(vehicle);
        }
    }
    /**
     * Synthetic lifecycle snapshot for visualization ONLY. Fleet starts across
     * the *real route geometry* rather than bunching up at the buffer exit after
     * 50 s of prewarming. No AGV jumps position after the simulation begins:
     * subsequent updates use the existing acceleration, cornering and SAT checks.
     * This is not recorded GPS telemetry and is not a dispatch recommendation.
     *
     * Approximate sector quotas for 155 vehicles: 39 at the Gantry end, 46 on
     * the Gantry-side approach / GIS parking strip, and 70 toward the quay.
     * The buffer remains a legitimate idle state when no task is available.
     */
    seedLifecycleScene() {
        if (this.sceneSeeded || this.vehicles.some(v => v.active)) {
            throw new Error("Seed a lifecycle scene only once, before dispatching tasks");
        }
        this.sceneSeeded = true;
        const n = this.vehicles.length;
        const zones = ['GANTRY_END', 'GANTRY_SIDE_BUFFER', 'QUAY_SIDE'];
        const target = {
            GANTRY_END: Math.round(n * .25), GANTRY_SIDE_BUFFER: Math.floor(n * .30), QUAY_SIDE: 0
        };
        target.QUAY_SIDE = n - target.GANTRY_END - target.GANTRY_SIDE_BUFFER;
        const actual = { GANTRY_END: 0, GANTRY_SIDE_BUFFER: 0, QUAY_SIDE: 0 };
        // Interleave parking-zone IDs so Gantry and quay groups are distributed
        // longitudinally over the whole surveyed strip, never one end only.
        // 67 is coprime with 155, as is the fallback stride 1 for other fleet sizes.
        const stride = n === 155 ? 67 : 1;
        const order = Array.from({ length: n }, (_, i) => this.vehicles[(i * stride) % n]);
        const assigned = new Set();
        const footprints = [];
        const canStage = (v, position, heading) => {
            // Include initially parked vehicles which will remain idle or are not yet
            // staged, preventing visually interpenetrating vehicles at the shoreline.
            for (const other of footprints) {
                if (other.vehicle !== v && this.footprintsConflict(position, heading, other.position, other.heading))
                    return false;
            }
            for (const other of this.vehicles) {
                if (other === v || assigned.has(other))
                    continue;
                if (this.footprintsConflict(position, heading, other.state, other.state.heading))
                    return false;
            }
            return true;
        };
        const candidatePhases = (zone, vehicleIndex) => {
            const jitter = ((vehicleIndex * 29 + 17) % 31) / 31;
            if (zone === 'GANTRY_END')
                return [
                    { phase: 1, progress: .78 + .17 * jitter }, { phase: 2, progress: .04 + .17 * jitter },
                    { phase: 1, progress: .61 + .16 * jitter }
                ];
            if (zone === 'GANTRY_SIDE_BUFFER')
                return [
                    { phase: 1, progress: .47 + .26 * jitter }, { phase: 2, progress: .25 + .27 * jitter },
                    { phase: 1, progress: .32 + .20 * jitter }
                ];
            return [
                { phase: 0, progress: .69 + .28 * jitter }, { phase: 2, progress: .73 + .25 * jitter },
                { phase: 1, progress: .03 + .22 * jitter }, { phase: 0, progress: .38 + .32 * jitter }
            ];
        };
        // Prioritize Gantry-end placements, which are the hardest to see in V7.
        // Preserve some authentic GIS parking positions in the second group.
        for (const zone of zones) {
            const maximum = target[zone];
            let count = 0;
            for (const v of order) {
                if (count >= maximum)
                    break;
                if (assigned.has(v))
                    continue;
                const number = Number.parseInt(v.definition.id.match(/(\d+)$/)?.[1] ?? '1', 10);
                // A portion of the 30% cohort remains idle, *at its original buffer
                // point*, never at a fabricated parking position next to the Gantry.
                const remainParked = zone === 'GANTRY_SIDE_BUFFER' && (count % 4 === 0);
                if (remainParked) {
                    v.initialSceneZone = zone;
                    assigned.add(v);
                    count++;
                    actual[zone]++;
                    continue;
                }
                // chooseVariant mutates only route assignment and does not move a car.
                v.taskNumber = 1;
                this.chooseVariant(v);
                const candidates = candidatePhases(zone, number);
                let chosen = null;
                for (const candidate of candidates) {
                    const seg = v.segments[candidate.phase], len = v.phaseDistances[candidate.phase];
                    // Search nearby legal arclengths when another AGV occupies a proposed
                    // slot. This spreads the simulated snapshot without inventing roads.
                    for (const offset of [0, -.055, .055, -.11, .11, -.18, .18, -.25, .25]) {
                        const progress = clamp(candidate.progress + offset, .025, .975);
                        const distance = len * progress, position = this.onPath(seg.points, distance);
                        const heading = this.tangent(seg.points, distance);
                        if (canStage(v, position, heading)) {
                            chosen = { phase: candidate.phase, position, heading, distance };
                            break;
                        }
                    }
                    if (chosen)
                        break;
                }
                if (!chosen) {
                    v.taskNumber = 0;
                    continue;
                }
                v.phaseIndex = chosen.phase;
                v.distance = chosen.distance;
                v.dwell = 0;
                v.speed = 0;
                v.heading = chosen.heading;
                v.active = true;
                v.waitingForTraffic = false;
                v.initialSceneZone = zone;
                v.state = this.makeState(v, chosen.position, v.phaseDistances[v.phaseIndex] > 0 ?
                    chosen.distance / v.phaseDistances[v.phaseIndex] : 0);
                footprints.push({ position: chosen.position, heading: chosen.heading, vehicle: v });
                assigned.add(v);
                count++;
                actual[zone]++;
            }
        }
        return { target, actual, parked: this.vehicles.filter(v => !v.active).length,
            unplaced: n - Object.values(actual).reduce((a, b) => a + b, 0) };
    }
    /** These are INITIAL simulated stage counts, not live GPS region counts. */
    getInitialSceneDistribution() {
        const result = { GANTRY_END: 0, GANTRY_SIDE_BUFFER: 0, QUAY_SIDE: 0 };
        for (const v of this.vehicles)
            if (v.initialSceneZone)
                result[v.initialSceneZone]++;
        return result;
    }
    /** A task is issued only when requested; no modulo-time automatic redispatch. */
    dispatchTask(id) {
        const v = this.vehicles.find(v => v.definition.id === id);
        if (!v || v.active || v.phaseIndex !== 4)
            return false;
        v.phaseIndex = 0;
        v.distance = 0;
        v.dwell = 0;
        v.speed = 0;
        v.active = true;
        v.waitingForTraffic = false;
        v.taskNumber++;
        this.chooseVariant(v);
        v.state = this.makeState(v, v.segments[0].points[0], 0);
        return true;
    }
    dispatchBatch(max = 12) {
        let count = 0;
        for (const v of this.vehicles) {
            if (count >= max)
                break;
            if (this.dispatchTask(v.definition.id))
                count++;
        }
        return count;
    }
    getPendingCount() { return this.vehicles.filter(v => !v.active).length; }
    /**
     * Spatially balanced departure waves. Parking slots follow the surveyed GIS
     * buffer strip; choose across five sections and across source QCs instead of
     * dispatching every car into the same merging aisle on one frame.
     * Does not teleport cars or bypass swept-footprint collision checks.
     */
    dispatchDistributed(max = 10) {
        const n = this.vehicles.length;
        if (!n || max <= 0)
            return 0;
        const sectors = 5, perSector = Math.ceil(n / sectors);
        const section = (v) => Math.min(sectors - 1, Math.floor((v.definition.parkingSlot - 1) / perSector));
        const activeBySection = new Array(sectors).fill(0);
        const activeByQuay = new Map();
        for (const v of this.vehicles)
            if (v.active) {
                activeBySection[section(v)]++;
                activeByQuay.set(v.quayCraneId, (activeByQuay.get(v.quayCraneId) ?? 0) + 1);
            }
        let dispatched = 0;
        const used = new Set();
        while (dispatched < max) {
            let candidate = null, score = Infinity;
            for (const v of this.vehicles) {
                if (v.active || v.phaseIndex !== 4 || used.has(v.definition.id))
                    continue;
                // Prefer distinct sectors first, and then the least busy quay.
                const quayLoad = activeByQuay.get(v.quayCraneId) ?? 0;
                const sectorLoad = activeBySection[section(v)];
                const nextScore = sectorLoad * 10 + quayLoad * 4 +
                    ((v.definition.parkingSlot * 37 + this.tick) % Math.max(n, 1)) / Math.max(n, 1);
                if (nextScore < score) {
                    score = nextScore;
                    candidate = v;
                }
            }
            if (!candidate)
                break;
            used.add(candidate.definition.id);
            if (this.dispatchTask(candidate.definition.id)) {
                dispatched++;
                activeBySection[section(candidate)]++;
                activeByQuay.set(candidate.quayCraneId, (activeByQuay.get(candidate.quayCraneId) ?? 0) + 1);
            }
        }
        return dispatched;
    }
    update(deltaSeconds) {
        if (!this.running || deltaSeconds <= 0)
            return;
        let remaining = clamp(deltaSeconds * this.simulationSpeed, 0, .35);
        while (remaining > 0) {
            const dt = Math.min(.05, remaining);
            remaining -= dt;
            this.tick++;
            // Rotating priority prevents systematically blocking the last vehicle ID.
            const count = this.vehicles.length, offset = this.tick % Math.max(count, 1);
            this.clockSeconds += dt;
            for (let i = 0; i < count; i++)
                this.stepVehicle(this.vehicles[(i + offset) % count], dt);
            for (const v of this.vehicles)
                this.appendSample(v, dt);
        }
    }
    stepVehicle(v, dt) {
        if (!v.active)
            return;
        const seg = v.segments[v.phaseIndex], length = v.phaseDistances[v.phaseIndex];
        const position = this.onPath(seg.points, v.distance);
        const rest = Math.max(0, length - v.distance);
        if (rest < .025) {
            v.speed = 0;
            v.distance = length;
            if (v.dwell < seg.dwellSeconds && (v.phaseIndex !== 2 || this.continuousWorkload)) {
                v.dwell = Math.min(seg.dwellSeconds, v.dwell + dt);
                v.state = this.makeState(v, seg.points.at(-1), 1);
                return;
            }
            const finished = v.phaseIndex;
            v.phaseIndex++;
            v.distance = 0;
            v.dwell = 0;
            if (finished === 2) {
                v.taskCompleted++;
                v.currentQuayCraneId = v.quayCraneId;
                if (this.continuousWorkload) {
                    // Each new task is independently planned FROM this AGV's actual QC.
                    // Phase 0 contains the empty inter-QC transfer and pickup dwell;
                    // never jump directly into loaded transport at another QC.
                    v.taskNumber++;
                    this.chooseVariant(v, true);
                    v.phaseIndex = 0;
                }
            }
            if (finished === 3) { // Quay -> GIS buffer completed; park without a new task.
                v.phaseIndex = 4;
                v.active = false;
            }
            v.state = this.makeState(v, v.segments[v.phaseIndex].points[0], 0);
            return;
        }
        const heading = this.tangent(seg.points, v.distance);
        const lookAhead = this.tangent(seg.points, Math.min(length, v.distance + Math.max(4, 2 * v.speed)));
        const bend = Math.abs(wrap(lookAhead - heading));
        const curveCap = bend > .05 ? Math.sqrt(this.maxLateral * Math.max(3, 8) / Math.max(bend, .05)) : seg.speedMps;
        const stopCap = Math.sqrt(2 * this.decel * rest);
        const headingError = Math.abs(wrap(heading - v.heading));
        // On corners, slow before rotating rather than teleporting heading.
        const steerCap = headingError > .35 ? Math.max(.6, seg.speedMps * (.35 / headingError)) : seg.speedMps;
        const target = Math.max(0, Math.min(seg.speedMps, curveCap, stopCap, steerCap));
        let requested = clamp(target - v.speed, -this.decel * dt, this.accel * dt);
        let newSpeed = clamp(v.speed + requested, 0, seg.speedMps);
        const proposed = this.onPath(seg.points, Math.min(length, v.distance + newSpeed * dt));
        const desired = this.tangent(seg.points, Math.min(length, v.distance + newSpeed * dt + .5));
        const proposedHeading = v.heading + clamp(wrap(desired - v.heading), -this.turnRate * dt, this.turnRate * dt);
        const blocked = this.trafficBlock(v, position, proposed, newSpeed, proposedHeading);
        if (blocked) {
            newSpeed = 0;
            requested = -v.speed;
            v.waitingForTraffic = true;
        }
        else
            v.waitingForTraffic = false;
        const moved = newSpeed * dt;
        v.distance = Math.min(length, v.distance + moved);
        v.speed = newSpeed;
        // Rotating a stopped AGV can also strike a neighbour: keep its heading
        // unchanged whenever the predicted swept footprint is blocked.
        if (!blocked)
            v.heading = proposedHeading;
        v.state = this.makeState(v, this.onPath(seg.points, v.distance), length > 0 ? v.distance / length : 1, requested / Math.max(dt, .001));
    }
    /** Oriented-rectangle overlap (separating axis test) with 0.6 m safety
     * clearance on each full footprint. Unlike a bounding circle this lets a
     * vehicle drive down narrow lanes beside parked AGVs without false blocks.
     */
    footprintsConflict(a, aHeading, b, bHeading) {
        const fa = { x: Math.cos(aHeading), y: Math.sin(aHeading) };
        const sa = { x: -fa.y, y: fa.x };
        const fb = { x: Math.cos(bHeading), y: Math.sin(bHeading) };
        const sb = { x: -fb.y, y: fb.x };
        const delta = { x: b.x - a.x, y: b.y - a.y };
        const dot = (u, v) => u.x * v.x + u.y * v.y;
        const hl = this.vehicleLength * .5, hw = this.vehicleWidth * .5;
        for (const axis of [fa, sa, fb, sb]) {
            const rA = hl * Math.abs(dot(fa, axis)) + hw * Math.abs(dot(sa, axis));
            const rB = hl * Math.abs(dot(fb, axis)) + hw * Math.abs(dot(sb, axis));
            if (Math.abs(dot(delta, axis)) > rA + rB + .65)
                return false;
        }
        return true;
    }
    trafficBlock(v, origin, target, speed, proposedHeading) {
        const safeFollowing = this.vehicleLength + this.gap + speed * this.timeHeadway;
        const dx = target.x - origin.x, dy = target.y - origin.y, len2 = dx * dx + dy * dy;
        const direction = { x: Math.cos(v.heading), y: Math.sin(v.heading) };
        for (const other of this.vehicles) {
            if (other === v)
                continue;
            const p = other.state;
            const t = len2 > 0 ? clamp(((p.x - origin.x) * dx + (p.y - origin.y) * dy) / len2, 0, 1) : 0;
            const swept = Math.hypot(origin.x + dx * t - p.x, origin.y + dy * t - p.y);
            // Narrow-area SAT: block predicted oriented body contact rather than
            // applying a large circular distance to every direction.
            if (swept < this.vehicleLength * 1.6) {
                const midpoint = { x: (origin.x + target.x) * .5, y: (origin.y + target.y) * .5 };
                if (this.footprintsConflict(target, proposedHeading, p, other.state.heading)
                    || this.footprintsConflict(midpoint, proposedHeading, p, other.state.heading))
                    return true;
            }
            if (!other.active)
                continue;
            const rx = p.x - origin.x, ry = p.y - origin.y;
            const ahead = rx * direction.x + ry * direction.y;
            const lateral = Math.abs(rx * direction.y - ry * direction.x);
            if (ahead > 0 && ahead < safeFollowing && lateral < 3.8)
                return true;
        }
        return false;
    }
    onPath(points, s) {
        if (!points.length)
            return { x: 0, y: 0 };
        let d = Math.max(0, s);
        for (let i = 1; i < points.length; i++) {
            const n = dist(points[i - 1], points[i]);
            if (d <= n || i === points.length - 1) {
                const t = n > 0 ? clamp(d / n, 0, 1) : 0;
                return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t };
            }
            d -= n;
        }
        return { ...points.at(-1) };
    }
    tangent(points, s) {
        let d = Math.max(0, s);
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i], n = dist(a, b);
            if (d <= n || i === points.length - 1)
                return Math.atan2(b.y - a.y, b.x - a.x);
            d -= n;
        }
        return 0;
    }
    makeState(v, position, progress, acceleration = 0) {
        const seg = v.segments[v.phaseIndex], d = v.definition;
        const park = v.segments[4].points[0];
        const selected = v.variants.find(o => o.yardId === v.assignedYardId);
        const yard = selected?.yardSlot ?? this.yardSlots[Number.parseInt(d.id.match(/(\d+)$/)?.[1] ?? '1', 10) - 1] ?? park;
        const unloading = v.segments[1].points.at(-1) ?? park;
        const dwellFrac = seg.dwellSeconds ? clamp(v.dwell / seg.dwellSeconds, 0, 1) : 0;
        const inDwell = v.dwell > 0;
        const loading = (seg.phase === 'QUAY_PICKUP' || (seg.phase === 'RETURN_QUAY' && this.continuousWorkload)) && inDwell;
        const unloadingNow = seg.phase === 'YARD_STACK' && inDwell;
        const loaded = seg.phase === 'YARD_STACK' && !unloadingNow;
        const status = loading ? 'LOADING' : unloadingNow ? 'UNLOADING' : loaded ? 'LOADED' : 'EMPTY';
        const cargoVisible = loading || loaded || unloadingNow;
        const cargoX = unloadingNow ? unloading.x + (yard.x - unloading.x) * dwellFrac : position.x;
        const cargoY = unloadingNow ? unloading.y + (yard.y - unloading.y) * dwellFrac : position.y;
        const geog = this.coordinateSystem.localToGeo({ ...position, z: 0 });
        const taskStatus = !v.active ? 'PARKING' : loading ? 'LOADING' : unloadingNow ? 'UNLOADING' : loaded ? 'LOADED' : (seg.phase === 'RETURN_BUFFER' || seg.phase === 'RETURN_QUAY') ? 'RETURNING' : v.waitingForTraffic ? 'WAITING' : 'WORKING';
        return {
            id: d.id, assetId: d.assetId, x: position.x, y: position.y,
            longitude: Number(geog.longitude.toFixed(8)), latitude: Number(geog.latitude.toFixed(8)),
            heading: v.heading, speed: v.speed, acceleration, battery: Math.max(12, d.battery - (v.taskCompleted * 8 + (v.active ? 6 * progress : 0))),
            phase: seg.phase, berthId: v.quayCraneId, yardId: v.assignedYardId,
            parkingSlotId: `PARK-${String(Math.floor((d.parkingSlot - 1) / 31) + 1).padStart(2, '0')}-${String((d.parkingSlot - 1) % 31 + 1).padStart(2, '0')}`,
            energyStationId: d.energyStationId, taskId: v.active ? `${d.taskId}-${v.taskNumber}` : '—', routeId: v.assignedRouteId,
            containerId: `CNTR-${String(Number.parseInt(d.id.match(/(\d+)$/)?.[1] ?? '1', 10)).padStart(7, '0')}`,
            containerNo: `SYN${String(Number.parseInt(d.id.match(/(\d+)$/)?.[1] ?? '1', 10)).padStart(7, '0')}`,
            cargoStatus: status, phaseProgress: progress, taskStatus, cycleProgress: v.active ? (v.phaseIndex + progress) / 4 : 1,
            yardX: yard.x, yardY: yard.y, cargoX, cargoY, cargoVisible, cargoAtYard: unloadingNow && dwellFrac >= 1,
            cargoTransferProgress: unloadingNow || loading ? dwellFrac : 0,
            cargoTransferKind: loading ? 'CRANE_TO_AGV' : unloadingNow ? 'AGV_TO_YARD' : 'NONE',
            hasTask: v.active, taskCompleted: v.taskCompleted, waitingForTraffic: v.waitingForTraffic
        };
    }
    /** Complete current mission, including loaded and empty return legs. */
    getLifecycleLegs(index) {
        const v = this.vehicles[index];
        if (!v)
            return [];
        return [0, 1, 2, 3].map(i => ({ phase: v.segments[i].phase,
            points: v.segments[i].points.map(p => ({ ...p })) }));
    }
    /** Route geometry: the current assignment, not a pile of historical segments. */
    getCurrentRoute(index) {
        const v = this.vehicles[index];
        if (!v)
            return [];
        const phases = [0, 1, 2, 3];
        return phases.flatMap((i, j) => v.segments[i].points.slice(j ? 1 : 0).map(p => ({ ...p })));
    }
    /** All recorded positions are simulated; optionally return only actual motion
     * since this page started (no preseeded synthetic history). */
    getTravelledPath(index, limit = 1400) {
        const h = this.vehicles[index]?.history ?? [];
        const live = h.filter(v => v.source === 'live-simulation');
        const points = live.slice(-Math.max(1, limit));
        return points.map(p => ({ x: p.x, y: p.y }));
    }
    getHistoryPath(index) {
        return this.getHistoryRecords(index).map(p => ({ x: p.x, y: p.y }));
    }
    getHistoryRecords(index, limit = 900) {
        const h = this.vehicles[index]?.history ?? [];
        return h.slice(-Math.max(0, Math.min(this.historyLimit, limit))).map(record => ({ ...record }));
    }
    /** Simulation-only historical example. It never claims to be actual TOS telemetry. */
    seedSyntheticHistory(v) {
        // Three historical SIMULATED journeys through distinct available yard
        // assignments. They are not surveyed GPS measurements.
        const reverse = (s, phase) => ({ phase, points: [...s.points].reverse().map(p => ({ ...p })),
            speedMps: s.speedMps, dwellSeconds: 0 });
        for (let journey = 0; journey < 3; journey++) {
            const option = v.variants[(journey + (v.definition.parkingSlot % Math.max(1, v.variants.length))) % Math.max(1, v.variants.length)];
            const outbound = option?.segment ?? v.segments[1];
            const paths = [v.segments[0], outbound, reverse(outbound, 'RETURN_QUAY'), v.segments[3]];
            const distances = paths.map(s => s.points.slice(1).reduce((sum, p, i) => sum + dist(p, s.points[i]), 0));
            const total = distances.reduce((a, b) => a + b, 0);
            for (let i = 0; i < 200; i++) {
                const sample = journey * 200 + i;
                let d = total * i / 199, which = 0;
                while (which < 3 && d > distances[which])
                    d -= distances[which++];
                const segment = paths[which], position = this.onPath(segment.points, d);
                v.history.push({ sample, simulatedSeconds: (sample - 600) * this.sampleInterval,
                    x: position.x, y: position.y, speedMps: segment.speedMps, heading: this.tangent(segment.points, d),
                    phase: segment.phase, taskId: `${v.definition.taskId}-SYN-HIST-${journey + 1}`, source: 'synthetic-history' });
            }
        }
        v.sampleNumber = 600;
    }
    appendSample(v, dt) {
        v.sampleClock += dt;
        if (v.sampleClock < this.sampleInterval)
            return;
        v.sampleClock %= this.sampleInterval;
        const s = v.state;
        // Parked cars do not flood their history with thousands of identical points.
        const last = v.history.at(-1);
        if (!v.active && last?.source === 'live-simulation' && Math.hypot(s.x - last.x, s.y - last.y) < .025)
            return;
        v.history.push({ sample: v.sampleNumber++, simulatedSeconds: this.clockSeconds,
            x: s.x, y: s.y, speedMps: s.speed, heading: s.heading, phase: s.phase,
            taskId: s.taskId, source: 'live-simulation' });
        if (v.history.length > this.historyLimit)
            v.history.splice(0, v.history.length - this.historyLimit);
    }
    /** Penalize corridors occupied by other active AGVs when planning. Planning
     * happens at assignment time, not each frame; the motion controller performs
     * the short-horizon collision avoidance independently. */
    corridorCost(points, vehicle) {
        let length = 0;
        for (let i = 1; i < points.length; i++)
            length += dist(points[i - 1], points[i]);
        if (!length)
            return 0;
        let traffic = 0;
        for (const other of this.vehicles) {
            if (other === vehicle || !other.active)
                continue;
            const pos = other.state;
            for (let i = 1; i < points.length; i++) {
                const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
                const t = clamp(((pos.x - a.x) * dx + (pos.y - a.y) * dy) / Math.max(1e-8, dx * dx + dy * dy), 0, 1);
                if (Math.hypot(a.x + t * dx - pos.x, a.y + t * dy - pos.y) < 13) {
                    traffic += 3;
                    break;
                }
            }
        }
        return length + traffic;
    }
    /** A* / Dijkstra on *validated QC link edges only*.  The route is recomputed
     * per vehicle and task. No fabricated straight segment can cut through a yard. */
    findQuayPath(start, end, vehicle) {
        if (!this.quayGraph.has(start) || !this.quayGraph.has(end))
            return null;
        if (start === end) {
            return { points: [{ ...this.quayPositions.get(start) }], cost: 0, edgeIds: [] };
        }
        const best = new Map([[start, 0]]);
        const previous = new Map();
        const visited = new Set();
        while (true) {
            let node, score = Infinity;
            for (const [candidate, d] of best)
                if (!visited.has(candidate) && d < score) {
                    node = candidate;
                    score = d;
                }
            if (node === undefined)
                return null;
            if (node === end)
                break;
            visited.add(node);
            for (const edge of this.quayGraph.get(node) ?? []) {
                const preference = (([...vehicle.definition.id].reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261)
                    ^ [...edge.id].reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261)) % 97) / 970;
                const cost = this.corridorCost(edge.points, vehicle) +
                    (this.edgeReservations.get(edge.id) ?? 0) * 1.5 + edge.length * preference;
                const next = score + cost;
                if (next < (best.get(edge.to) ?? Infinity)) {
                    best.set(edge.to, next);
                    previous.set(edge.to, { from: node, edge });
                }
            }
        }
        const steps = [];
        for (let node = end; node !== start;) {
            const step = previous.get(node);
            if (!step)
                return null;
            steps.push({ points: step.edge.points, id: step.edge.id });
            node = step.from;
        }
        steps.reverse();
        const points = steps.flatMap((step, i) => step.points.slice(i ? 1 : 0).map(p => ({ ...p })));
        return { points, cost: best.get(end), edgeIds: steps.map(s => s.id) };
    }
    joinPaths(a, b) {
        if (!a.length)
            return b.map(p => ({ ...p }));
        if (!b.length)
            return a.map(p => ({ ...p }));
        const all = a.map(p => ({ ...p }));
        all.push(...b.slice(dist(a.at(-1), b[0]) < .05 ? 1 : 0).map(p => ({ ...p })));
        return all.length === 1 ? [all[0], { ...all[0] }] : all;
    }
    /** Personalized per-assignment path planning: each AGV begins at its own
     * parking/QC position, searches available QC links, chooses an actual GIS
     * corridor to its selected yard, and receives a unique route/task ID.
     * The target yard is rotated reproducibly for test coverage; the approach
     * QC is chosen by path cost, traffic, and existing corridor reservations.
     * All links are synthetic unless separately surveyed and certified. */
    chooseVariant(v, fromQuay = false) {
        if (!v.variants.length)
            return;
        const hash = [...v.definition.id].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
        const index = (hash % v.variants.length + (Math.max(1, v.taskNumber) - 1) * (v.variants.length - 1)) % v.variants.length;
        const choice = v.variants[index];
        const startQuay = fromQuay ? v.currentQuayCraneId : v.homeQuayCraneId;
        let selected = null;
        let navigation = null;
        let minimum = Infinity;
        for (const entrance of this.yardEntrances.get(choice.yardId) ?? []) {
            const path = this.findQuayPath(startQuay, entrance.quay, v);
            if (!path)
                continue;
            const cost = path.cost + this.corridorCost(entrance.segment.points, v) +
                (this.edgeReservations.get(entrance.routeId) ?? 0) * 2;
            if (cost < minimum) {
                minimum = cost;
                selected = entrance;
                navigation = path;
            }
        }
        if (!selected || !navigation) {
            // The V8 prevalidated synthetic variant is the safe fallback for a yard
            // whose optional QC network cannot find a route. Do not draw a new line.
            selected = { quay: startQuay, segment: choice.segment, yardSlot: choice.yardSlot, routeId: choice.routeId };
            navigation = { points: [v.homePickup.points.at(-1)], cost: 0, edgeIds: [] };
        }
        const quayApproach = navigation.points.length ? navigation.points : [v.homePickup.points.at(-1)];
        const parkingToPickup = this.joinPaths(v.homePickup.points, fromQuay ? this.findQuayPath(v.homeQuayCraneId, selected.quay, v)?.points ?? quayApproach : quayApproach);
        const pickupApproach = fromQuay ? this.joinPaths([v.segments[2].points.at(-1)], quayApproach) : parkingToPickup;
        const outbound = selected.segment.points.map(p => ({ ...p }));
        // Prevent disguised teleports when an incorrectly encoded GIS corridor
        // does not share the selected QC endpoint.
        if (dist(pickupApproach.at(-1), outbound[0]) > .1)
            throw Error(`Disconnected QC handoff for ${v.definition.id}`);
        v.quayCraneId = selected.quay;
        v.assignedYardId = choice.yardId;
        v.assignedRouteId = `PLAN-${v.definition.id}-${v.taskNumber}-${selected.quay}-${choice.yardId}`;
        v.segments[0] = { phase: 'QUAY_PICKUP', points: pickupApproach, speedMps: v.homePickup.speedMps,
            dwellSeconds: v.homePickup.dwellSeconds };
        v.segments[1] = { phase: 'YARD_STACK', points: outbound, speedMps: selected.segment.speedMps, dwellSeconds: selected.segment.dwellSeconds };
        v.segments[2] = { phase: 'RETURN_QUAY', points: outbound.slice().reverse().map(p => ({ ...p })),
            speedMps: selected.segment.speedMps, dwellSeconds: 0 };
        v.segments[3] = { phase: 'RETURN_BUFFER', points: parkingToPickup.slice().reverse().map(p => ({ ...p })),
            speedMps: v.homePickup.speedMps, dwellSeconds: 0 };
        for (const i of [0, 1, 2, 3])
            v.phaseDistances[i] = v.segments[i].points.slice(1)
                .reduce((sum, p, j) => sum + dist(p, v.segments[i].points[j]), 0);
        for (const id of [...navigation.edgeIds, selected.routeId])
            this.edgeReservations.set(id, (this.edgeReservations.get(id) ?? 0) + 1);
    }
    setContinuousWorkload(enabled) { this.continuousWorkload = enabled; }
    getContinuousWorkload() { return this.continuousWorkload; }
    setRunning(running) { this.running = running; }
    isRunning() { return this.running; }
    setSimulationSpeed(speed) { this.simulationSpeed = clamp(speed, .1, 8); }
    getSimulationSpeed() { return this.simulationSpeed; }
    getSelectedState(index = 77) { return this.vehicles[index]?.state ?? null; }
    getCycleProgress(index) { return this.vehicles[index]?.state.cycleProgress ?? 0; }
    getStats() {
        let moving = 0, parking = 0, charging = 0, returnBuffer = 0, yardStack = 0, battery = 0, waiting = 0;
        for (const v of this.vehicles) {
            const s = v.state;
            battery += s.battery;
            if (!v.active)
                parking++;
            else if (s.phase === 'CHARGING')
                charging++;
            else {
                if (s.speed > .02)
                    moving++;
                if (s.waitingForTraffic)
                    waiting++;
                if (s.phase === 'RETURN_BUFFER')
                    returnBuffer++;
                if (s.phase === 'YARD_STACK')
                    yardStack++;
            }
        }
        return { total: this.vehicles.length, active: this.vehicles.filter(v => v.active).length, moving, parking, charging, returnBuffer, yardStack, waiting,
            avgBattery: this.vehicles.length ? battery / this.vehicles.length : 0 };
    }
}
