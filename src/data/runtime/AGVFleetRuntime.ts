import type { AGVDefinition } from "../source/AGVSimulationSource";
import { CoordinateSystem } from "../../map/CoordinateSystem";
import type { GISAGVRoute } from "../source/AGVGisRouteSource";

export type AGVPhase =
    | "QUAY_PICKUP"
    | "YARD_STACK"
    | "PARKING"
    | "CHARGING"
    | "RETURN_QUAY";

export interface XY {
    x: number;
    y: number;
}

export interface AGVRuntimeState {
    id: string;
    assetId: string;
    x: number;
    y: number;
    longitude: number;
    latitude: number;
    heading: number;
    speed: number;
    battery: number;
    phase: AGVPhase;
    berthId: string;
    yardId: string;
    parkingSlotId: string;
    energyStationId: string;
    taskId: string;
    routeId: string;
    containerId: string;
    containerNo: string;
    cargoStatus: "LOADING" | "LOADED" | "UNLOADING" | "EMPTY";
    phaseProgress: number;
    taskStatus: "WORKING" | "LOADING" | "LOADED" | "UNLOADING" | "PARKING" | "CHARGING" | "RETURNING";
    cycleProgress: number;
    /** Local-space position of the yard slot assigned to this container. */
    yardX: number;
    yardY: number;
    /** Local-space animated cargo position; used for yard/crane handoff rendering. */
    cargoX: number;
    cargoY: number;
    cargoVisible: boolean;
    cargoAtYard: boolean;
    cargoTransferProgress: number;
    cargoTransferKind: "NONE" | "CRANE_TO_AGV" | "AGV_TO_YARD" | "YARD_TO_AGV";
}

export interface AGVSegment {
    phase: AGVPhase;
    points: XY[];
    speedMps: number;
    dwellSeconds: number;
}

interface SimVehicle {
    definition: AGVDefinition;
    segments: AGVSegment[];
    phaseDistances: number[];
    totalCycleSeconds: number;
    time: number;
    state: AGVRuntimeState;
}

export class AGVFleetRuntime {
    readonly vehicles: SimVehicle[] = [];
    private simulationSpeed = 1;
    private running = true;
    private yardSlots: XY[] = [];

    constructor(
        private readonly coordinateSystem: CoordinateSystem
    ) {}

    load(definitions: AGVDefinition[], gisRoutes?: Map<string, GISAGVRoute>, yardSlots: XY[] = []): void {
        this.yardSlots = yardSlots.length ? yardSlots.map(p => ({ ...p })) : [];
        this.vehicles.length = 0;

        definitions.forEach((definition, vehicleIndex) => {
            const gisRoute = gisRoutes?.get(definition.id);
            if (!gisRoute || gisRoute.phases.length !== 5) {
                throw new Error(`Missing GIS-constrained route for ${definition.id}.`);
            }

            // Important: no legacy synthetic road-network fallback is used here.
            // Every AGV moving phase comes from the uploaded lane-centerline graph;
            // container-yard polygons are used as exclusion zones.
            const segments: AGVSegment[] = gisRoute.phases.map(phase => ({
                phase: phase.phase,
                points: phase.points.map(point => ({ x: point.x, y: point.y })),
                speedMps: phase.speedMps,
                dwellSeconds: phase.dwellSeconds
            }));

            const phaseDistances = segments.map(segment => {
                let d = 0;
                for (let i = 1; i < segment.points.length; i++) {
                    d += this.distance(segment.points[i - 1], segment.points[i]);
                }
                return d;
            });

            const totalCycleSeconds = segments.reduce(
                (sum, segment, index) =>
                    sum + phaseDistances[index] / Math.max(segment.speedMps, 0.001) + segment.dwellSeconds,
                0
            );

            // The source fleet intentionally keeps phaseOffset at zero. Stagger vehicles
            // across their own route cycles, then greedily choose the candidate phase
            // that maximizes distance from already spawned AGVs. This prevents the
            // initial scene from looking like a traffic jam while remaining deterministic.
            const baseStagger = ((vehicleIndex * 0.61803398875) % 1 + (definition.phaseOffset || 0)) % 1;
            const candidateOffsets = Array.from({ length: 32 }, (_, k) => (baseStagger + k / 32) % 1);
            let selectedOffset = baseStagger;
            let selectedSeparation = -1;
            for (const candidate of candidateOffsets) {
                const candidateState = this.sampleVehicle({
                    definition, segments, phaseDistances, totalCycleSeconds,
                    time: candidate * totalCycleSeconds, state: null as never
                }, candidate * totalCycleSeconds);
                const nearest = this.vehicles.reduce((min, vehicle) =>
                    Math.min(min, this.distance(candidateState, vehicle.state)),
                    Number.POSITIVE_INFINITY
                );
                if (nearest > selectedSeparation) {
                    selectedSeparation = nearest;
                    selectedOffset = candidate;
                }
            }
            const time = selectedOffset * totalCycleSeconds;
            const skeleton: SimVehicle = {
                definition,
                segments,
                phaseDistances,
                totalCycleSeconds,
                time,
                state: null as never
            };
            skeleton.state = this.sampleVehicle(skeleton, time);
            this.vehicles.push(skeleton);
        });
    }

    update(deltaSeconds: number): void {
        if (!this.running) return;

        const delta = deltaSeconds * this.simulationSpeed;
        for (const vehicle of this.vehicles) {
            vehicle.time = (vehicle.time + delta) % vehicle.totalCycleSeconds;
            vehicle.state = this.sampleVehicle(vehicle, vehicle.time);
        }
    }

    /** Return the selected vehicle's already-traversed path in the current cycle.
     *  This is the history line shown when an AGV is selected.
     */
    getHistoryPath(index: number): XY[] {
        const vehicle = this.vehicles[index];
        if (!vehicle) return [];
        let cursor = vehicle.time;
        const history: XY[] = [];
        for (let i = 0; i < vehicle.segments.length; i++) {
            const segment = vehicle.segments[i];
            const distance = vehicle.phaseDistances[i];
            const travelSeconds = distance / Math.max(segment.speedMps, 0.001);
            if (distance > 0.001 && segment.speedMps > 0 && cursor <= travelSeconds) {
                const traveled = segment.speedMps * cursor;
                history.push(...this.polylinePrefix(segment.points, traveled));
                return this.dedupeHistory(history);
            }
            history.push(...segment.points);
            cursor -= travelSeconds;
            if (cursor <= segment.dwellSeconds) {
                return this.dedupeHistory(history);
            }
            cursor -= segment.dwellSeconds;
        }
        return this.dedupeHistory(history);
    }

    setRunning(running: boolean): void {
        this.running = running;
    }

    isRunning(): boolean {
        return this.running;
    }

    setSimulationSpeed(value: number): void {
        this.simulationSpeed = Math.max(0.1, Math.min(8, value));
    }

    getSimulationSpeed(): number {
        return this.simulationSpeed;
    }

    getStats(): {
        total: number;
        moving: number;
        parking: number;
        charging: number;
        returnQuay: number;
        yardStack: number;
        avgBattery: number;
    } {
        let parking = 0;
        let charging = 0;
        let returnQuay = 0;
        let yardStack = 0;
        let battery = 0;

        for (const vehicle of this.vehicles) {
            battery += vehicle.state.battery;
            if (vehicle.state.phase === "PARKING") parking++;
            else if (vehicle.state.phase === "CHARGING") charging++;
            else if (vehicle.state.phase === "RETURN_QUAY") returnQuay++;
            else if (vehicle.state.phase === "YARD_STACK") yardStack++;
        }

        // "Moving" = every in-motion phase (QUAY_PICKUP + YARD_STACK + RETURN_QUAY).
        // Only PARKING / CHARGING are stationary, so the dashboard reflects that the
        // fleet is mostly running.
        const moving = this.vehicles.length - parking - charging;

        return {
            total: this.vehicles.length,
            moving,
            parking,
            charging,
            returnQuay,
            yardStack,
            avgBattery: this.vehicles.length ? battery / this.vehicles.length : 0
        };
    }

    getCycleProgress(index: number): number {
        const vehicle = this.vehicles[index];
        if (!vehicle || vehicle.totalCycleSeconds <= 0) return 0;
        return Math.max(0, Math.min(1, vehicle.time / vehicle.totalCycleSeconds));
    }

    getSelectedState(index = 77): AGVRuntimeState | null {
        return this.vehicles[index]?.state ?? null;
    }

    private sampleVehicle(vehicle: SimVehicle, time: number): AGVRuntimeState {
        let cursor = time;

        for (let i = 0; i < vehicle.segments.length; i++) {
            const segment = vehicle.segments[i];
            const distance = vehicle.phaseDistances[i];
            const travelSeconds = distance / Math.max(segment.speedMps, 0.001);

            if (distance > 0.001 && segment.speedMps > 0 && cursor <= travelSeconds) {
                const position = this.samplePolyline(segment.points, segment.speedMps * cursor);
                const next = this.samplePolyline(segment.points, Math.min(distance, segment.speedMps * cursor + 0.8));
                return this.createState(vehicle, position, next, segment, i, cursor / Math.max(travelSeconds, 0.001), segment.speedMps);
            }

            cursor -= travelSeconds;
            if (cursor <= segment.dwellSeconds) {
                const end = segment.points[segment.points.length - 1];
                const previous = segment.points[Math.max(0, segment.points.length - 2)];
                return this.createState(vehicle, end, previous, segment, i, 1, 0, cursor);
            }
            cursor -= segment.dwellSeconds;
        }

        return this.sampleVehicle(vehicle, 0);
    }

    private createState(
        vehicle: SimVehicle,
        position: XY,
        next: XY,
        segment: AGVSegment,
        phaseIndex: number,
        progress: number,
        speed: number,
        dwellProgress = 0
    ): AGVRuntimeState {
        const definition = vehicle.definition;
        const geo = this.coordinateSystem.localToGeo({ ...position, z: 0 });
        const heading = Math.atan2(next.y - position.y, next.x - position.x);
        const battery = segment.phase === "CHARGING"
            ? Math.min(100, definition.battery + 60 * (dwellProgress / Math.max(segment.dwellSeconds, 0.001)))
            : this.estimateBattery(definition.battery, phaseIndex, progress);

        const yard = this.yardSlots[this.idNumber(definition.id) - 1] ?? segment.points[segment.points.length - 1];
        const yardX = yard.x;
        const yardY = yard.y;

        // Cargo exchange is visualized as a real handoff:
        // 1) crane -> AGV during QUAY_PICKUP;
        // 2) AGV -> assigned yard slot during YARD_STACK;
        // 3) a short yard re-handling window at the end of YARD_STACK shows
        //    the next container moving yard -> AGV before the vehicle leaves.
        // The next cycle then carries that next task's container metadata.
        let cargoStatus: AGVRuntimeState["cargoStatus"] = "EMPTY";
        let cargoX = position.x;
        let cargoY = position.y;
        let cargoVisible = false;
        let cargoAtYard = false;
        let cargoTransferProgress = 0;
        let cargoTransferKind: AGVRuntimeState["cargoTransferKind"] = "NONE";

        if (segment.phase === "QUAY_PICKUP") {
            cargoVisible = true;
            if (progress < 0.35) {
                cargoStatus = "LOADING";
                cargoTransferKind = "CRANE_TO_AGV";
                cargoTransferProgress = progress / 0.35;
                const crane = segment.points[0];
                const t = Math.max(0, Math.min(1, cargoTransferProgress));
                cargoX = crane.x + (position.x - crane.x) * t;
                cargoY = crane.y + (position.y - crane.y) * t;
            } else {
                cargoStatus = "LOADED";
                cargoX = position.x;
                cargoY = position.y;
            }
        } else if (segment.phase === "YARD_STACK") {
            cargoVisible = true;
            if (progress < 0.78) {
                cargoStatus = "LOADED";
                cargoX = position.x;
                cargoY = position.y;
            } else if (progress < 0.90) {
                cargoStatus = "UNLOADING";
                cargoTransferKind = "AGV_TO_YARD";
                cargoTransferProgress = (progress - 0.78) / 0.12;
                const t = Math.max(0, Math.min(1, cargoTransferProgress));
                cargoX = position.x + (yardX - position.x) * t;
                cargoY = position.y + (yardY - position.y) * t;
            } else {
                // The current box is now stacked. Keep a yard box visible and
                // show a second, short re-handling operation: the next box is
                // lifted from the stack back onto the AGV before departure.
                cargoAtYard = true;
                cargoStatus = "LOADING";
                cargoTransferKind = "YARD_TO_AGV";
                cargoTransferProgress = (progress - 0.90) / 0.10;
                const t = Math.max(0, Math.min(1, cargoTransferProgress));
                cargoX = yardX + (position.x - yardX) * t;
                cargoY = yardY + (position.y - yardY) * t;
            }
        } else {
            cargoStatus = "EMPTY";
        }

        return {
            id: definition.id,
            assetId: definition.assetId,
            x: position.x,
            y: position.y,
            longitude: Number(geo.longitude.toFixed(8)),
            latitude: Number(geo.latitude.toFixed(8)),
            heading,
            speed,
            battery,
            phase: segment.phase,
            berthId: definition.berthId,
            yardId: definition.yardId,
            parkingSlotId: `PARK-${String(Math.floor((definition.parkingSlot - 1) / 31) + 1).padStart(2, "0")}-${String(((definition.parkingSlot - 1) % 31) + 1).padStart(2, "0")}`,
            energyStationId: definition.energyStationId,
            taskId: definition.taskId,
            routeId: definition.routeId,
            containerId: `CNTR-${String(this.idNumber(definition.id)).padStart(7, "0")}`,
            containerNo: `SYN${String(this.idNumber(definition.id)).padStart(7, "0")}`,
            cargoStatus,
            phaseProgress: Math.max(0, Math.min(1, progress)),
            taskStatus:
                segment.phase === "QUAY_PICKUP" ? (progress < 0.35 ? "LOADING" : "LOADED") :
                segment.phase === "YARD_STACK" ? (progress > 0.90 ? "LOADING" : (progress > 0.78 ? "UNLOADING" : "LOADED")) :
                segment.phase === "PARKING" ? "PARKING" :
                segment.phase === "CHARGING" ? "CHARGING" :
                "RETURNING",
            cycleProgress: Math.max(0, Math.min(1, (
                vehicle.segments.slice(0, phaseIndex).reduce((sum, s, idx) => sum + vehicle.phaseDistances[idx] / Math.max(s.speedMps, 0.001) + s.dwellSeconds, 0) +
                (vehicle.phaseDistances[phaseIndex] / Math.max(segment.speedMps, 0.001)) * Math.max(0, Math.min(1, progress))
            ) / Math.max(vehicle.totalCycleSeconds, 0.001))),
            yardX,
            yardY,
            cargoX,
            cargoY,
            cargoVisible,
            cargoAtYard,
            cargoTransferProgress,
            cargoTransferKind
        };
    }

    private samplePolyline(points: XY[], distance: number): XY {
        if (points.length === 0) return { x: 0, y: 0 };
        if (points.length === 1) return { ...points[0] };

        let remaining = Math.max(0, distance);
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1];
            const b = points[i];
            const length = this.distance(a, b);
            if (remaining <= length || i === points.length - 1) {
                const t = length > 0 ? Math.max(0, Math.min(1, remaining / length)) : 0;
                return {
                    x: a.x + (b.x - a.x) * t,
                    y: a.y + (b.y - a.y) * t
                };
            }
            remaining -= length;
        }
        return { ...points[points.length - 1] };
    }

    private estimateBattery(base: number, phaseIndex: number, progress: number): number {
        const outbound = phaseIndex <= 1 ? -22 * progress : 0;
        const parked = phaseIndex === 2 ? -22 : 0;
        const recharged = phaseIndex >= 3 ? 60 : 0;
        return Math.max(15, Math.min(100, base + outbound + parked + recharged));
    }

    private idNumber(id: string): number {
        const value = Number.parseInt(id.match(/(\d+)$/)?.[1] ?? "1", 10);
        return Number.isFinite(value) ? value : 1;
    }

    private polylinePrefix(points: XY[], distance: number): XY[] {
        if (points.length === 0) return [];
        const out: XY[] = [{ ...points[0] }];
        let remaining = Math.max(0, distance);
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1];
            const b = points[i];
            const length = this.distance(a, b);
            if (remaining <= length) {
                const t = length > 0 ? remaining / length : 0;
                out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
                break;
            }
            out.push({ ...b });
            remaining -= length;
        }
        return out;
    }

    private dedupeHistory(points: XY[]): XY[] {
        const out: XY[] = [];
        for (const point of points) {
            const last = out[out.length - 1];
            if (!last || this.distance(last, point) > 0.15) out.push({ ...point });
        }
        return out;
    }

    private distance(a: XY, b: XY): number {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }
}
