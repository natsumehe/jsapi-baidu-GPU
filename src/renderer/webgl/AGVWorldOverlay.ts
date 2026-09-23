import { CoordinateSystem, type GeoPoint } from "../../map/CoordinateSystem";
import { AGVFleetRuntime, type AGVRuntimeState, type AGVPhase, type XY } from "../../data/runtime/AGVFleetRuntime";
import { AGVSimulationSource } from "../../data/source/AGVSimulationSource";
import { AGVGisRouteSource } from "../../data/source/AGVGisRouteSource";
import { TOSAGVTaskSource, type TOSAGVTaskRecord } from "../../data/source/TOSAGVTaskSource";
import { YANGSHAN_SCENE } from "../../simulation/yangshan/YangshanSceneConfig";
import { GLBAGVLayer, type AGVProjection } from "./GLBAGVLayer";

interface ScreenPoint { x: number; y: number; }
interface PhaseStyle { stroke: string; fill: string; }

const phaseStyle: Record<AGVPhase, PhaseStyle> = {
    QUAY_PICKUP: { stroke: "#39eb75", fill: "#22c55e" },
    YARD_STACK: { stroke: "#ffae27", fill: "#f59e0b" },
    PARKING: { stroke: "#2f8cff", fill: "#3b82f6" },
    CHARGING: { stroke: "#66baff", fill: "#38bdf8" },
    RETURN_QUAY: { stroke: "#d15dec", fill: "#c026d3" }
};

const zoneStyle = {
    YARD: { fill: "rgba(40, 180, 120, 0.08)", stroke: "rgba(45, 220, 145, 0.48)" },
    QUAY: { fill: "rgba(50, 155, 235, 0.10)", stroke: "rgba(70, 185, 255, 0.56)" },
    PARKING: { fill: "rgba(45, 130, 255, 0.14)", stroke: "rgba(65, 165, 255, 0.68)" },
    CHARGING: { fill: "rgba(75, 185, 255, 0.16)", stroke: "rgba(100, 205, 255, 0.72)" },
    ROAD: { fill: "rgba(35, 140, 255, 0.04)", stroke: "rgba(55, 155, 255, 0.24)" },
    OFFICE: { fill: "rgba(65, 90, 130, 0.13)", stroke: "rgba(110, 155, 205, 0.45)" },
    EXTERNAL: { fill: "rgba(50, 110, 220, 0.05)", stroke: "rgba(75, 150, 255, 0.44)" }
} as const;

export class AGVWorldOverlay {
    private readonly map: BMapGL.Map;
    private readonly origin: GeoPoint;
    private readonly coordinateSystem: CoordinateSystem;
    private readonly source = new AGVSimulationSource();
    private readonly gisRouteSource = new AGVGisRouteSource();
    private readonly tosSource = new TOSAGVTaskSource();
    private tosRows = new Map<string, TOSAGVTaskRecord>();
    private containerYards: Array<Array<[number, number]>> = [];
    private roadNetwork: Array<Array<[number, number]>> = [];
    private operationalPolygons: Array<Array<[number, number]>> = [];
    private quayCranes: Array<{ id: number; name: string; longitude: number; latitude: number }> = [];
    private yardSlots: XY[] = [];
    private readonly runtime: AGVFleetRuntime;

    private readonly fleetCanvas: HTMLCanvasElement;
    private readonly glbCanvas: HTMLCanvasElement;
    private readonly fleetContext: CanvasRenderingContext2D;
    private readonly gl: WebGLRenderingContext;
    private readonly glb: GLBAGVLayer;
    private dpr = 1;

    private loaded = false;
    private error: string | null = null;
    private modelLoaded = false;
    private modelError: string | null = null;
    private frame = 0;
    private lastTime = 0;
    private selectedIndex = 77;
    private redraw: (() => void) | null = null;
    private dashboardLastUpdate = 0;
    private dashboardTableMode: "agv" | "tos" = "agv";

    constructor(map: BMapGL.Map, origin: GeoPoint) {
        this.map = map;
        this.origin = { ...origin };
        this.coordinateSystem = new CoordinateSystem(this.origin);
        this.runtime = new AGVFleetRuntime(this.coordinateSystem);

        const container = document.getElementById("map_container");
        if (!container) throw new Error("#map_container not found.");
        if (getComputedStyle(container).position === "static") container.style.position = "relative";

        this.fleetCanvas = this.createCanvas(container, "agv-fleet-overlay", "10010");
        this.glbCanvas = this.createCanvas(container, "agv-glb-overlay", "10011");

        const ctx = this.fleetCanvas.getContext("2d");
        if (!ctx) throw new Error("2D fleet overlay is unavailable.");
        this.fleetContext = ctx;

        const gl = this.glbCanvas.getContext("webgl", {
            alpha: true,
            antialias: true,
            depth: false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: false
        });
        if (!gl) throw new Error("Dedicated AGV GLB WebGL context is unavailable.");
        this.gl = gl;
        this.glb = new GLBAGVLayer(gl);

        this.map.addEventListener("moving", () => this.invalidate());
        this.map.addEventListener("dragging", () => this.invalidate());
        this.map.addEventListener("zoomstart", () => this.invalidate());
        this.map.addEventListener("zoomend", () => this.invalidate());
        this.map.addEventListener("resize", () => this.resize());
        this.map.addEventListener("click", (event: any) => this.handleMapClick(event));
        window.addEventListener("resize", () => this.resize());
        this.resize();
    }

    async initialize(redraw: () => void): Promise<void> {
        this.redraw = redraw;
        try {
            const [dataset, tosRows, gisRoutes, containerGeo, roadGeo, operationalGeo, craneGeo] = await Promise.all([
                this.source.load(),
                this.tosSource.load(),
                this.gisRouteSource.load(),
                fetch("/data/gis/container_yards.geojson").then(r => r.json()),
                fetch("/data/gis/road_network.geojson").then(r => r.json()),
                fetch("/data/gis/operational_polygons.geojson").then(r => r.json()),
                fetch("/data/gis/quay_cranes.geojson").then(r => r.json())
            ]);
            if (dataset.vehicleCount !== 155 || dataset.vehicles.length !== 155) {
                throw new Error(`Expected 155 AGVs, received ${dataset.vehicles.length}.`);
            }
            this.tosRows = new Map(tosRows.map(row => [row.TAA_AGV_ID, row]));
            this.containerYards = (containerGeo.features ?? [])
                .map((feature: any) => feature.geometry?.coordinates?.[0])
                .filter((ring: any) => Array.isArray(ring) && ring.length >= 3);
            this.roadNetwork = (roadGeo.features ?? [])
                .flatMap((feature: any) => {
                    if (feature.geometry?.type === "LineString") return [feature.geometry.coordinates];
                    if (feature.geometry?.type === "MultiLineString") return feature.geometry.coordinates;
                    return [];
                })
                .filter((line: any) => Array.isArray(line) && line.length >= 2);
            this.operationalPolygons = (operationalGeo.features ?? [])
                .flatMap((feature: any) => {
                    if (feature.geometry?.type === "Polygon") return [feature.geometry.coordinates?.[0]];
                    if (feature.geometry?.type === "MultiPolygon") return feature.geometry.coordinates.map((p: any) => p?.[0]);
                    return [];
                })
                .filter((ring: any) => Array.isArray(ring) && ring.length >= 3);
            this.quayCranes = (craneGeo.features ?? [])
                .filter((feature: any) => feature.geometry?.type === "Point")
                .map((feature: any) => ({
                    id: Number(feature.properties?.id ?? 0),
                    name: String(feature.properties?.name ?? feature.properties?.Name ?? "吊桥"),
                    longitude: Number(feature.geometry.coordinates[0]),
                    latitude: Number(feature.geometry.coordinates[1])
                }))
                .filter((point: any) => Number.isFinite(point.longitude) && Number.isFinite(point.latitude));

            if (this.quayCranes.length === 0) {
                throw new Error("Uploaded quay-crane point dataset is empty.");
            }

            // Build deterministic container-stack slots from the uploaded container-yard
            // polygons. These are visualization/simulation slots, not survey-grade stack
            // positions. Every AGV receives one slot, so unload/load animations have a
            // concrete geographic destination instead of floating beside the vehicle.
            this.yardSlots = this.containerYards.map((ring) => {
                const c = ring.reduce((acc, point) => ({ lng: acc.lng + point[0], lat: acc.lat + point[1] }), { lng: 0, lat: 0 });
                const n = Math.max(1, ring.length);
                return this.coordinateSystem.geoToLocal({ longitude: c.lng / n, latitude: c.lat / n, height: 0 });
            });
            if (this.yardSlots.length === 0) {
                throw new Error("Uploaded container-yard polygons are empty.");
            }

            // Spread the 155 simulated containers over the uploaded yard polygons.
            // The runtime uses the same slots for AGV -> YARD and YARD -> AGV transfer.
            const expandedYardSlots = Array.from({ length: dataset.vehicles.length }, (_, index) => {
                const base = this.yardSlots[index % this.yardSlots.length];
                // Reuse the geographic center of an uploaded yard polygon when more
                // than one simulated container is assigned to the same yard. The
                // renderer offsets stacked boxes by pixels, so their geographic anchor
                // remains inside the source polygon instead of drifting outside it.
                return { x: base.x, y: base.y, z: 0 };
            });
            this.runtime.load(dataset.vehicles, gisRoutes, expandedYardSlots);

            this.loaded = true;
            console.info(`[Yangshan AGV] 155-vehicle GIS-constrained runtime ready; anchor=${YANGSHAN_SCENE.anchor.longitude},${YANGSHAN_SCENE.anchor.latitude}`);
            this.invalidate();

            void this.glb.load("/assets/agv/agv.glb").then(() => {
                this.modelLoaded = this.glb.isLoaded();
                this.modelError = this.glb.getLoadError();
                this.invalidate();
            });
        } catch (e) {
            this.error = e instanceof Error ? e.message : String(e);
            console.error("AGV World Overlay initialization failed:", e);
        }
    }

    start(): void {
        if (this.frame) return;
        this.lastTime = performance.now();
        const loop = (now: number) => {
            const dt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
            this.lastTime = now;
            if (this.loaded) this.runtime.update(dt);
            this.render();
            this.frame = requestAnimationFrame(loop);
        };
        this.frame = requestAnimationFrame(loop);
    }

    setRunning(running: boolean): void { this.runtime.setRunning(running); }
    isRunning(): boolean { return this.runtime.isRunning(); }
    setSpeed(speed: number): void { this.runtime.setSimulationSpeed(speed); }

    getSelectedState(): AGVRuntimeState | null {
        return this.runtime.vehicles[this.selectedIndex]?.state ?? null;
    }

    getStats() {
        const stats = this.runtime.getStats();
        return {
            ...stats,
            loaded: this.loaded,
            error: this.error,
            simulationRunning: this.runtime.isRunning(),
            simulationSpeed: this.runtime.getSimulationSpeed(),
            modelLoaded: this.modelLoaded,
            modelError: this.modelError
        };
    }

    render(): void {
        this.resize();
        const ctx = this.fleetContext;
        const w = this.fleetCanvas.clientWidth;
        const h = this.fleetCanvas.clientHeight;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.fleetCanvas.width, this.fleetCanvas.height);
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        this.drawSceneGeometry(ctx);

        if (!this.loaded || this.runtime.vehicles.length === 0) {
            this.drawBootstrap(ctx, w, h);
            return;
        }

        const selected = this.runtime.vehicles[this.selectedIndex];

        for (let i = 0; i < this.runtime.vehicles.length; i++) {
            const vehicle = this.runtime.vehicles[i];
            for (const segment of vehicle.segments) {
                this.drawPolyline(
                    ctx,
                    segment.points,
                    phaseStyle[segment.phase].stroke + "55",
                    i === this.selectedIndex ? 2.4 : 1.5
                );
            }
        }

        if (selected) {
            // Full lifecycle route stays visible; the brighter dashed line is the
            // selected AGV's already-traversed history in the current cycle.
            for (const segment of selected.segments) {
                this.drawPolyline(ctx, segment.points, phaseStyle[segment.phase].stroke, 5);
            }
            const history = this.runtime.getHistoryPath(this.selectedIndex);
            this.drawPolyline(ctx, history, "rgba(255,255,255,0.96)", 3.4, true);
            this.drawCurrentProgress(ctx, selected);
        }

        // Draw containers already handed off to / being picked from the stack.
        // The stack position is geographic and comes from the uploaded container-yard polygons.
        for (let i = 0; i < this.runtime.vehicles.length; i++) {
            const state = this.runtime.vehicles[i].state;
            this.drawYardContainer(ctx, state, i === this.selectedIndex);
        }

        for (let i = 0; i < this.runtime.vehicles.length; i++) {
            const state = this.runtime.vehicles[i].state;
            this.drawVehicle(ctx, state, i === this.selectedIndex);
        }

        this.drawRegistrationMarker(ctx);
        this.renderSelectedGLB(selected?.state ?? null);
        this.updatePanel(selected?.state ?? null);
        const now = performance.now();
        if (now - this.dashboardLastUpdate > 250) {
            this.dashboardLastUpdate = now;
            this.updateDataDashboard(selected?.state ?? null);
        }
    }

    destroy(): void {
        if (this.frame) cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.glb.destroy();
        this.fleetCanvas.remove();
        this.glbCanvas.remove();
    }

    private drawSceneGeometry(ctx: CanvasRenderingContext2D): void {
        // Only uploaded GIS geometry is rendered. The legacy reference-frame
        // road graph / synthetic route layer is intentionally removed.
        this.drawUploadedGIS(ctx);
        this.drawQuayCranes(ctx);
    }

    private drawUploadedGIS(ctx: CanvasRenderingContext2D): void {
        // Operational polygon is the uploaded/derived driving envelope.
        for (const ring of this.operationalPolygons) {
            ctx.beginPath();
            ring.forEach(([lng, lat], index) => {
                const p = this.projectGeo(lng, lat);
                if (index === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            });
            ctx.closePath();
            ctx.fillStyle = "rgba(40, 180, 120, 0.035)";
            ctx.fill();
            ctx.strokeStyle = "rgba(70, 220, 160, 0.28)";
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Uploaded GIS source: jizhuangxiangport = container yard polygons.
        for (const ring of this.containerYards) {
            ctx.beginPath();
            ring.forEach(([lng, lat], index) => {
                const p = this.projectGeo(lng, lat);
                if (index === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            });
            ctx.closePath();
            ctx.fillStyle = "rgba(255, 174, 39, 0.055)";
            ctx.fill();
            ctx.strokeStyle = "rgba(255, 174, 39, 0.42)";
            ctx.lineWidth = 1.2;
            ctx.stroke();

            const center = ring.reduce(
                (acc, point) => ({ lng: acc.lng + point[0], lat: acc.lat + point[1] }),
                { lng: 0, lat: 0 }
            );
            const n = Math.max(1, ring.length);
            const label = this.projectGeo(center.lng / n, center.lat / n);
            ctx.save();
            ctx.font = "700 8px ui-monospace, SFMono-Regular, Menlo, monospace";
            ctx.fillStyle = "rgba(255, 222, 158, 0.82)";
            ctx.fillText("CNTR-YARD", label.x - 23, label.y);
            ctx.restore();
        }

        // Uploaded GIS lane data is kept visually quieter than the AGV routes.
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (const line of this.roadNetwork) {
            ctx.beginPath();
            line.forEach(([lng, lat], index) => {
                const p = this.projectGeo(lng, lat);
                if (index === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            });
            ctx.strokeStyle = "rgba(105, 190, 255, 0.34)";
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        ctx.restore();
    }

    private drawQuayCranes(ctx: CanvasRenderingContext2D): void {
        if (this.quayCranes.length === 0) return;
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        for (const crane of this.quayCranes) {
            const p = this.projectGeo(crane.longitude, crane.latitude);
            // Stylised quay-crane/岸桥 symbol anchored exactly at the uploaded point.
            // The crane is a lifecycle anchor only. The AGV free-space trajectory
            // begins/ends here and then moves through the broad operational area.
            ctx.strokeStyle = "rgba(255, 105, 105, 0.96)";
            ctx.fillStyle = "rgba(105, 22, 32, 0.86)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(p.x - 9, p.y + 7);
            ctx.lineTo(p.x - 6, p.y - 7);
            ctx.lineTo(p.x + 11, p.y - 7);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(p.x - 4, p.y - 7);
            ctx.lineTo(p.x + 7, p.y + 5);
            ctx.lineTo(p.x + 11, p.y - 7);
            ctx.stroke();
            ctx.fillRect(p.x - 10, p.y + 6, 7, 3);
            ctx.fillRect(p.x + 7, p.y + 6, 7, 3);

            ctx.beginPath();
            ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255, 236, 112, 0.98)";
            ctx.fill();
            ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.font = "800 8px ui-monospace, SFMono-Regular, Menlo, monospace";
            ctx.fillStyle = "rgba(255, 235, 235, 0.96)";
            ctx.shadowColor = "rgba(0,0,0,.9)";
            ctx.shadowBlur = 4;
            ctx.fillText(`QC-${String(crane.id).padStart(2, "0")}`, p.x + 14, p.y - 8);
        }
        ctx.restore();
    }

    private drawRegistrationMarker(ctx: CanvasRenderingContext2D): void {
        // Explicit registration control point supplied by the user:
        // QGIS EPSG:3857 (13583417, 3688475) <-> Baidu map (122.032598, 30.662465).
        const p = this.projectGeo(122.032598, 30.662465);
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,.9)";
        ctx.fillStyle = "rgba(7,20,34,.88)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x - 12, p.y);
        ctx.lineTo(p.x + 12, p.y);
        ctx.moveTo(p.x, p.y - 12);
        ctx.lineTo(p.x, p.y + 12);
        ctx.stroke();
        ctx.font = "700 9px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "rgba(0,0,0,.9)";
        ctx.shadowBlur = 4;
        ctx.fillText("GIS ↔ 百度 配准点", p.x + 10, p.y - 10);
        ctx.restore();
    }

    private drawCurrentProgress(ctx: CanvasRenderingContext2D, vehicle: { segments: Array<{ phase: AGVPhase; points: XY[] }>; state: AGVRuntimeState }): void {
        // Approximate the active phase progress using the current state projected onto its path.
        const active = vehicle.segments.find(segment => segment.phase === vehicle.state.phase);
        if (!active || active.points.length < 2) return;
        let nearestIndex = 1;
        let best = Number.POSITIVE_INFINITY;
        for (let i = 1; i < active.points.length; i++) {
            const d = Math.hypot(
                active.points[i].x - vehicle.state.x,
                active.points[i].y - vehicle.state.y
            );
            if (d < best) { best = d; nearestIndex = i; }
        }
        const progressPath = active.points.slice(0, nearestIndex);
        progressPath.push({ x: vehicle.state.x, y: vehicle.state.y });
        this.drawPolyline(ctx, progressPath, phaseStyle[vehicle.state.phase].stroke, 7);
    }

    private renderSelectedGLB(state: AGVRuntimeState | null): void {
        const gl = this.gl;
        gl.viewport(0, 0, this.glbCanvas.width, this.glbCanvas.height);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (!state || !this.glb.isLoaded()) return;

        const projection = this.buildGLBProjection(state.x, state.y);
        this.glb.setState({
            id: state.id,
            assetId: state.assetId,
            x: state.x,
            y: state.y,
            heading: state.heading,
            speed: state.speed,
            state: state.phase === "PARKING" || state.phase === "CHARGING" ? "idle" : "moving"
        });
        this.glb.render(projection);
    }

    private buildGLBProjection(x: number, y: number): AGVProjection {
        const center = this.map.getCenter();
        const centerPixel = this.map.pointToPixel(new BMapGL.Point(center.lng, center.lat));
        const geo = this.coordinateSystem.localToGeo({ x, y, z: 0 });
        const agvPixel = this.map.pointToPixel(new BMapGL.Point(geo.longitude, geo.latitude));
        const probe = 16;
        const eastGeo = this.coordinateSystem.localToGeo({ x: x + probe, y, z: 0 });
        const northGeo = this.coordinateSystem.localToGeo({ x, y: y + probe, z: 0 });
        const ep = this.map.pointToPixel(new BMapGL.Point(eastGeo.longitude, eastGeo.latitude));
        const np = this.map.pointToPixel(new BMapGL.Point(northGeo.longitude, northGeo.latitude));
        const w = this.glbCanvas.clientWidth;
        const h = this.glbCanvas.clientHeight;
        return {
            agvPixelX: w / 2 + (agvPixel.x - centerPixel.x),
            agvPixelY: h / 2 + (agvPixel.y - centerPixel.y),
            eastBasisX: (ep.x - agvPixel.x) / probe,
            eastBasisY: (ep.y - agvPixel.y) / probe,
            northBasisX: (np.x - agvPixel.x) / probe,
            northBasisY: (np.y - agvPixel.y) / probe,
            viewportWidth: Math.max(1, w),
            viewportHeight: Math.max(1, h)
        };
    }

    private drawPolyline(ctx: CanvasRenderingContext2D, points: XY[], color: string, width: number, dashed = false): void {
        if (points.length < 2) return;
        ctx.save();
        if (dashed) ctx.setLineDash([7, 5]);
        ctx.beginPath();
        points.forEach((point, index) => {
            const p = this.project(point);
            if (index === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
        ctx.restore();
    }

    private drawCargoTransfer(ctx: CanvasRenderingContext2D, state: AGVRuntimeState, selected: boolean): void {
        if (!state.cargoVisible) return;

        const agv = this.project({ x: state.x, y: state.y });
        const cargo = this.project({ x: state.cargoX, y: state.cargoY });
        const pulse = (Math.sin(performance.now() * 0.006) + 1) * 0.5;
        const active = state.cargoTransferKind !== "NONE";

        ctx.save();
        // Dashed hoist path during any transfer.
        if (active) {
            ctx.strokeStyle = state.cargoTransferKind === "AGV_TO_YARD"
                ? "rgba(255,209,102,0.82)"
                : "rgba(115,220,255,0.82)";
            ctx.lineWidth = selected ? 2 : 1.2;
            ctx.setLineDash([3, 4]);
            ctx.beginPath();
            ctx.moveTo(agv.x, agv.y);
            ctx.lineTo(cargo.x, cargo.y);
            ctx.stroke();
        }

        // The container itself moves continuously between the AGV and the stack.
        const size = selected ? 17 : 14;
        ctx.translate(cargo.x, cargo.y);
        ctx.globalAlpha = active ? 0.76 + pulse * 0.24 : 0.96;
        ctx.fillStyle = state.cargoTransferKind === "AGV_TO_YARD" ? "#ffd166" : "#f4a261";
        ctx.strokeStyle = selected ? "#ffffff" : "rgba(255,230,180,0.95)";
        ctx.lineWidth = selected ? 1.8 : 1;
        ctx.fillRect(-size / 2, -size * 0.32, size, size * 0.46);
        ctx.strokeRect(-size / 2, -size * 0.32, size, size * 0.46);
        ctx.restore();

        if (selected && active) {
            const label = state.cargoTransferKind === "CRANE_TO_AGV"
                ? "岸桥装箱 → AGV"
                : state.cargoTransferKind === "AGV_TO_YARD"
                    ? "AGV卸箱 → 堆场"
                    : "堆场取箱 → AGV";
            ctx.save();
            ctx.font = "800 9px ui-monospace, SFMono-Regular, Menlo, monospace";
            ctx.fillStyle = "rgba(255,245,205,0.98)";
            ctx.shadowColor = "rgba(0,0,0,.9)";
            ctx.shadowBlur = 4;
            ctx.fillText(label, cargo.x + 10, cargo.y - 12);
            ctx.restore();
        }
    }

    private drawYardContainer(ctx: CanvasRenderingContext2D, state: AGVRuntimeState, selected: boolean): void {
        // During AGV -> YARD, the box gradually appears at the stack position.
        // During YARD -> AGV, it gradually disappears from that position.
        let alpha = 0;
        if (state.phase === "YARD_STACK" && state.phaseProgress >= 0.78) {
            if (state.cargoTransferKind === "AGV_TO_YARD") {
                alpha = Math.max(0, Math.min(1, state.cargoTransferProgress));
            } else if (state.cargoTransferKind === "YARD_TO_AGV") {
                alpha = 1 - Math.max(0, Math.min(1, state.cargoTransferProgress));
            }
        }
        if (alpha <= 0.01) return;

        const p = this.project({ x: state.yardX, y: state.yardY });
        // Multiple simulated containers may share the same source polygon. Keep the
        // geographic anchor exact, but fan the visual stack by a few pixels.
        const stackIndex = this.numericId(state.id) % 5;
        p.x += (stackIndex - 2) * 4;
        p.y -= Math.floor(stackIndex / 3) * 3;
        const size = selected ? 15 : 12;
        ctx.save();
        ctx.globalAlpha = alpha * (selected ? 1 : 0.9);
        ctx.fillStyle = "#d88b34";
        ctx.strokeStyle = selected ? "#ffffff" : "rgba(255,222,160,0.92)";
        ctx.lineWidth = selected ? 1.8 : 1;
        ctx.fillRect(p.x - size / 2, p.y - size * 0.22, size, size * 0.44);
        ctx.strokeRect(p.x - size / 2, p.y - size * 0.22, size, size * 0.44);
        if (selected) {
            ctx.font = "700 8px ui-monospace, SFMono-Regular, Menlo, monospace";
            ctx.fillStyle = "#fff4d6";
            ctx.fillText("YARD", p.x + 8, p.y - 8);
        }
        ctx.restore();
    }

    private drawVehicle(ctx: CanvasRenderingContext2D, state: AGVRuntimeState, selected: boolean): void {
        const p = this.project({ x: state.x, y: state.y });
        const scale = Math.max(0.72, Math.min(1.45, 0.82 + (this.map.getZoom() - 14) * 0.10));
        const length = 11.5 * scale;
        const width = 6.3 * scale;
        const c = phaseStyle[state.phase];

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(-state.heading);
        ctx.beginPath();
        ctx.roundRect(-length, -width, length * 2, width * 2, 2.3);
        ctx.fillStyle = c.fill;
        ctx.globalAlpha = selected ? 1 : 0.90;
        ctx.fill();
        ctx.strokeStyle = selected ? "#ffffff" : c.stroke;
        ctx.lineWidth = selected ? 2.1 : 1.1;
        ctx.stroke();
        ctx.fillStyle = "#eef6ff";
        ctx.fillRect(0.8, -width * 0.56, 6.2 * scale, width * 1.12);
        ctx.fillStyle = "#112033";
        ctx.fillRect(3.8 * scale, -width * 0.40, 3.6 * scale, width * 0.80);
        ctx.restore();
        this.drawCargoTransfer(ctx, state, selected);

        if (selected) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(p.x, p.y, 17 * scale, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(255,255,255,0.88)";
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.font = "800 10px ui-monospace, SFMono-Regular, Menlo, monospace";
            ctx.fillStyle = "#ffffff";
            ctx.shadowColor = "rgba(0,0,0,0.85)";
            ctx.shadowBlur = 5;
            ctx.fillText(state.id, p.x + 11, p.y - 12);
            ctx.font = "700 8px ui-monospace, SFMono-Regular, Menlo, monospace";
            ctx.fillStyle = "rgba(220,240,255,.9)";
            ctx.fillText(`${state.phase} · ${state.cargoStatus}`, p.x + 11, p.y + 1);
            ctx.restore();
        }
    }

    private numericId(id: string): number {
        return Number.parseInt(id.match(/(\d+)$/)?.[1] ?? "0", 10) || 0;
    }

    private project(local: XY): ScreenPoint {
        const center = this.map.getCenter();
        const centerPixel = this.map.pointToPixel(new BMapGL.Point(center.lng, center.lat));
        const geo = this.coordinateSystem.localToGeo({ x: local.x, y: local.y, z: 0 });
        const pixel = this.map.pointToPixel(new BMapGL.Point(geo.longitude, geo.latitude));
        return {
            x: this.fleetCanvas.clientWidth / 2 + (pixel.x - centerPixel.x),
            y: this.fleetCanvas.clientHeight / 2 + (pixel.y - centerPixel.y)
        };
    }

    private projectGeo(longitude: number, latitude: number): ScreenPoint {
        const center = this.map.getCenter();
        const centerPixel = this.map.pointToPixel(new BMapGL.Point(center.lng, center.lat));
        const pixel = this.map.pointToPixel(new BMapGL.Point(longitude, latitude));
        return {
            x: this.fleetCanvas.clientWidth / 2 + (pixel.x - centerPixel.x),
            y: this.fleetCanvas.clientHeight / 2 + (pixel.y - centerPixel.y)
        };
    }

    private drawPill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
        ctx.save();
        ctx.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace";
        const width = ctx.measureText(text).width + 20;
        const height = 23;
        const left = x - width / 2;
        const top = y - height / 2;
        ctx.beginPath();
        ctx.roundRect(left, top, width, height, 11);
        ctx.fillStyle = "rgba(4, 24, 43, 0.88)";
        ctx.fill();
        ctx.strokeStyle = "rgba(109, 181, 242, 0.62)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = "#eef7ff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, x, y + 0.2);
        ctx.restore();
    }

    private resize(): void {
        const parent = this.fleetCanvas.parentElement;
        if (!parent) return;
        const width = Math.max(1, parent.clientWidth);
        const height = Math.max(1, parent.clientHeight);
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        const dpr = this.dpr;
        this.fleetCanvas.style.width = `${width}px`;
        this.fleetCanvas.style.height = `${height}px`;
        const fleetWidth = Math.max(1, Math.floor(width * dpr));
        const fleetHeight = Math.max(1, Math.floor(height * dpr));
        if (this.fleetCanvas.width !== fleetWidth || this.fleetCanvas.height !== fleetHeight) {
            this.fleetCanvas.width = fleetWidth;
            this.fleetCanvas.height = fleetHeight;
        }
        this.glbCanvas.style.width = `${width}px`;
        this.glbCanvas.style.height = `${height}px`;
        if (this.glbCanvas.width !== width || this.glbCanvas.height !== height) {
            this.glbCanvas.width = width;
            this.glbCanvas.height = height;
        }
        this.gl.viewport(0, 0, this.glbCanvas.width, this.glbCanvas.height);
    }

    private invalidate(): void { this.redraw?.(); }

    private updatePanel(state: AGVRuntimeState | null): void {
        const runtimeStats = this.runtime.getStats();
        const selectedTOS = state ? this.tosRows.get(state.id) : undefined;
        if (selectedTOS && state) {
            // Keep the in-memory TOS record synchronized with the simulated lifecycle.
            // The original source row remains the source-of-truth for static fields.
            selectedTOS.TAA_CSTATUSCD = state.cargoStatus === "LOADED" ? "F" :
                state.cargoStatus === "UNLOADING" ? "U" :
                state.cargoStatus === "EMPTY" ? "E" : "L";
            selectedTOS.TAA_VALIDFG = "1";
        }
        const mapStats: Record<string, string> = {
            // These five values are intentionally kept identical to the supplied dashboard scene.
            agvTotal: String(YANGSHAN_SCENE.summary.total),
            agvMoving: String(runtimeStats.moving),
            agvParking: String(runtimeStats.parking),
            agvCharging: String(runtimeStats.charging),
            agvFault: "0",
            agvBattery: `${runtimeStats.avgBattery.toFixed(0)}%`,
            agvRuntime: this.runtime.isRunning() ? `RUN · ${this.runtime.getSimulationSpeed().toFixed(1)}×` : "PAUSED",
            agvModel: this.glb.isLoaded() ? "GLB READY" : (this.glb.getLoadError() ? "GLB FALLBACK" : "GLB LOADING"),
            agv: state?.id ?? "NO AGV",
            agvPosition: state ? `${state.longitude.toFixed(6)}, ${state.latitude.toFixed(6)}` : "—",
            agvSpeed: state ? `${(state.speed * 3.6).toFixed(1)} km/h` : "—",
            agvTask: selectedTOS?.TAA_ID ?? state?.taskId ?? "N/A",
            agvContainer: selectedTOS?.TAA_CNTRNO ?? state?.containerNo ?? "N/A",
            agvPhase: state ? state.phase : "—",
            agvCargo: state ? state.cargoStatus : "—",
            agvTaskStatus: state ? state.taskStatus : "—",
            agvCargoTransfer: state ? ({
                NONE: "—",
                CRANE_TO_AGV: "岸桥 → AGV",
                AGV_TO_YARD: "AGV → YARD",
                YARD_TO_AGV: "YARD → AGV"
            } as Record<string, string>)[state.cargoTransferKind] : "—",
            agvCycleProgress: state ? `${(state.cycleProgress * 100).toFixed(0)}%` : "—",
            agvProgress: state ? `${(state.phaseProgress * 100).toFixed(0)}%` : "—",
            agvCrane: selectedTOS?.TAA_AGV_ID && state ? state.berthId : "—"
        };
        for (const [id, value] of Object.entries(mapStats)) {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        }
    }

    private updateDataDashboard(state: AGVRuntimeState | null): void {
        const set = (id: string, value: string) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        set("gisRoadCount", String(this.roadNetwork.length));
        set("gisPolygonCount", String(this.operationalPolygons.length));
        set("gisYardCount", String(this.containerYards.length));
        set("gisCraneCount", String(this.quayCranes.length));
        set("tosCount", String(this.tosRows.size));
        set("dataRefreshTime", new Date().toLocaleTimeString("zh-CN", { hour12: false }));

        const fleetBody = document.getElementById("fleetTableBody");
        const fleetHead = document.getElementById("fleetTableHead");
        if (!fleetBody || !fleetHead) return;

        const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".data-tab"));
        for (const tab of tabs) {
            tab.onclick = () => {
                this.dashboardTableMode = tab.dataset.table === "tos" ? "tos" : "agv";
                for (const other of tabs) other.classList.toggle("active", other === tab);
                this.dashboardLastUpdate = 0;
                this.updateDataDashboard(this.getSelectedState());
            };
        }

        if (this.dashboardTableMode === "tos") {
            fleetHead.innerHTML = "<tr><th style='width:16%'>AGV</th><th style='width:20%'>Task</th><th style='width:20%'>Container</th><th>状态</th><th>箱型</th><th>班次</th><th>有效</th></tr>";
            fleetBody.innerHTML = "";
            for (const row of this.tosRows.values()) {
                const tr = document.createElement("tr");
                tr.innerHTML = `<td>${this.escapeHtml(row.TAA_AGV_ID)}</td><td>${this.escapeHtml(row.TAA_ID)}</td><td>${this.escapeHtml(row.TAA_CNTRNO)}</td><td>${this.escapeHtml(row.TAA_CSTATUSCD)}</td><td>${this.escapeHtml(row.TAA_CTYPECD)}</td><td>${row.TAA_SHIFT}</td><td>${this.escapeHtml(row.TAA_VALIDFG)}</td>`;
                tr.onclick = () => {
                    const idx = this.runtime.vehicles.findIndex(v => v.state.id === row.TAA_AGV_ID);
                    if (idx >= 0) { this.selectedIndex = idx; this.dashboardTableMode = "agv"; this.invalidate(); }
                };
                fleetBody.appendChild(tr);
            }
            return;
        }

        fleetHead.innerHTML = "<tr><th style='width:13%'>AGV</th><th style='width:13%'>阶段</th><th style='width:12%'>货物</th><th style='width:15%'>Container</th><th style='width:15%'>位置</th><th style='width:9%'>速度</th><th style='width:8%'>电量</th><th>进度</th></tr>";
        fleetBody.innerHTML = "";
        for (let i = 0; i < this.runtime.vehicles.length; i++) {
            const s = this.runtime.vehicles[i].state;
            const tr = document.createElement("tr");
            if (i === this.selectedIndex) tr.className = "selected";
            tr.innerHTML = `<td>${this.escapeHtml(s.id)}</td><td>${this.escapeHtml(s.phase)}</td><td>${this.escapeHtml(s.cargoStatus)}</td><td>${this.escapeHtml(s.containerNo)}</td><td>${s.longitude.toFixed(5)},${s.latitude.toFixed(5)}</td><td>${(s.speed * 3.6).toFixed(1)}</td><td>${s.battery.toFixed(0)}%</td><td>${(s.cycleProgress * 100).toFixed(0)}%</td>`;
            tr.onclick = () => { this.selectedIndex = i; this.invalidate(); };
            fleetBody.appendChild(tr);
        }
    }

    private escapeHtml(value: string): string {
        return value.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch));
    }

    private handleMapClick(event: any): void {
        if (!this.loaded || this.runtime.vehicles.length === 0) return;
        const clickPoint = event?.point;
        if (!clickPoint || typeof clickPoint.lng !== "number" || typeof clickPoint.lat !== "number") return;

        const click = this.projectGeo(clickPoint.lng, clickPoint.lat);
        let bestIndex = -1;
        let bestDistance = 24;
        for (let i = 0; i < this.runtime.vehicles.length; i++) {
            const state = this.runtime.vehicles[i].state;
            const p = this.project({ x: state.x, y: state.y });
            const d = Math.hypot(p.x - click.x, p.y - click.y);
            if (d < bestDistance) {
                bestDistance = d;
                bestIndex = i;
            }
        }
        if (bestIndex < 0) return;

        this.selectedIndex = bestIndex;
        const panel = document.getElementById("agv-trajectory-panel");
        if (panel) {
            panel.classList.add("open");
            panel.setAttribute("aria-hidden", "false");
        }
        this.invalidate();
    }

    private drawBootstrap(ctx: CanvasRenderingContext2D, _w: number, h: number): void {
        ctx.save();
        ctx.fillStyle = "rgba(90, 200, 255, 0.95)";
        ctx.font = "700 13px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillText(this.error ? `AGV data error: ${this.error}` : "AGV simulation loading…", 22, h - 28);
        ctx.restore();
        this.updatePanel(null);
    }

    private createCanvas(parent: HTMLElement, className: string, zIndex: string): HTMLCanvasElement {
        const canvas = document.createElement("canvas");
        canvas.className = className;
        canvas.style.position = "absolute";
        canvas.style.left = "0";
        canvas.style.top = "0";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.pointerEvents = "none";
        canvas.style.zIndex = zIndex;
        parent.appendChild(canvas);
        return canvas;
    }
}
