import { CoordinateSystem, type GeoPoint } from "../../map/CoordinateSystem";
import { AGVFleetRuntime, type AGVRuntimeState, type AGVPhase, type XY } from "../../data/runtime/AGVFleetRuntime";
import { AGVSimulationSource } from "../../data/source/AGVSimulationSource";
import { AGVGisRouteSource } from "../../data/source/AGVGisRouteSource";
import { TOSAGVTaskSource, type TOSAGVTaskRecord } from "../../data/source/TOSAGVTaskSource";
import { YANGSHAN_SCENE } from "../../simulation/yangshan/YangshanSceneConfig";
import { GLBAGVLayer, type AGVProjection } from "./GLBAGVLayer";
import { loadPortGeometry, type PortGeometry } from "../../simulation/yangshan/PortGeometry";
import { EntityInspectionPanel, type InspectionField } from "../../presentation/inspection/EntityInspectionPanel";

interface ScreenPoint { x: number; y: number; }
interface PhaseStyle { stroke: string; fill: string; }

const phaseStyle: Record<AGVPhase, PhaseStyle> = {
    QUAY_PICKUP: { stroke: "#39eb75", fill: "#22c55e" },
    YARD_STACK: { stroke: "#ffae27", fill: "#f59e0b" },
    PARKING: { stroke: "#2f8cff", fill: "#3b82f6" },
    CHARGING: { stroke: "#66baff", fill: "#38bdf8" },
    RETURN_BUFFER: { stroke: "#d15dec", fill: "#c026d3" },
    RETURN_QUAY: { stroke: "#f6cb5c", fill: "#c98d2b" }
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
    private portLayout: PortGeometry | null = null;

    // Static GIS geometry precomputed in local meters, so per-frame drawing only
    // applies the cached affine basis instead of re-projecting geo coordinates.
    private operationalLocal: XY[][] = [];
    private containerYardsLocal: XY[][] = [];
    private containerYardLabels: XY[] = [];
    private roadNetworkLocal: XY[][] = [];
    private quayCranesLocal: Array<{ id: number; xy: XY }> = [];

    private readonly runtime: AGVFleetRuntime;
    private readonly inspector = new EntityInspectionPanel();
    private readonly modelYawCorrection = Math.PI / 2;
    private gantryPositions: XY[] = [];
    private gantryClock = 0;
    private autoWorkload = true;
    private workloadClock = 0;
    private readonly workloadTarget = 0.80;
    private browserRoot: HTMLElement | null = null;
    private browserTab: 'AGV'|'QC'|'ASC'|'CONTAINER' = 'AGV';
    private browserFilter = '';
    private selectedInspection: { kind: 'AGV'|'QC'|'ASC'|'CONTAINER'; index: number; yardIndex?:number; containerIndex?:number; layer?:number } | null = null;
    private lastInspectorRefresh = 0;
    private lastScreenPick = 0;

    private readonly fleetCanvas: HTMLCanvasElement;
    private readonly glbCanvas: HTMLCanvasElement;
    private readonly fleetContext: CanvasRenderingContext2D;
    private readonly gl: WebGLRenderingContext | null;
    private readonly glb: GLBAGVLayer | null;
    private readonly quayGLB: GLBAGVLayer | null;
    private readonly gantryGLB: GLBAGVLayer | null;
    private dpr = 1;

    private loaded = false;
    private error: string | null = null;
    private modelLoaded = false;
    private modelError: string | null = null;
    private frame = 0;
    private lastTime = 0;
    private selectedIndex = 2;
    private trafficVerified=new Set<string>();
    private redraw: (() => void) | null = null;
    private dashboardLastUpdate = 0;
    private dashboardTableMode: "agv" | "tos" = "agv";
    private lastInteraction = 0;

    // Per-frame local(meter)->screen(pixel) affine basis. Recomputed once per frame
    // from three map.pointToPixel probes; every vertex is then projected with cheap
    // arithmetic so the vector layer tracks Baidu's GPU zoom without stutter.
    private pbCenterX = 0;
    private pbCenterY = 0;
    private pbOriginX = 0;
    private pbOriginY = 0;
    private pbEastX = 1;
    private pbEastY = 0;
    private pbNorthX = 0;
    private pbNorthY = 1;
    private prevPbEastX = Number.NaN;
    private prevPbEastY = Number.NaN;
    private prevPbOriginX = Number.NaN;
    private prevPbOriginY = Number.NaN;

    // Static GIS geometry (polygons + roads) is rasterized once to an offscreen canvas
    // and blitted with a single affine transform during pan/zoom, so thousands of
    // GeoJSON vertices become one drawImage and the vector layer keeps pace with the
    // basemap. The bitmap is refreshed (crisply) whenever the map settles at a new zoom.
    private gisCanvas: HTMLCanvasElement | null = null;
    private gisReady = false;
    private gisScale = 0;
    private gisRasterPxPerMeter = 0;
    private gisMinX = 0;
    private gisMaxY = 0;
    private gisWidthM = 0;
    private gisHeightM = 0;

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
        // The 3D GLB truck model is an enhancement. On GPU-constrained environments
        // that refuse app-created WebGL contexts, fall back to the 2D fleet rendering
        // (all 155 AGVs, routes and GIS geometry) instead of tearing the overlay down.
        if (gl) {
            this.gl = gl;
            this.glb = new GLBAGVLayer(gl);
            this.glb.setModelAxisScales(7.2/1667.6943,2.2/250.2114,3.0/373.0405);
            this.quayGLB = new GLBAGVLayer(gl);
            this.gantryGLB = new GLBAGVLayer(gl);
            this.quayGLB.setModelScale(5.2);
        } else {
            this.gl = null;
            this.glb = null;
            this.quayGLB = null;
            this.gantryGLB = null;
            this.modelError = "WebGL unavailable";
            console.warn("[AGVWorldOverlay] GLB WebGL 上下文不可用，AGV 改用 2D 渲染。");
        }

        this.map.addEventListener("moving", () => this.onInteract());
        this.map.addEventListener("dragging", () => this.onInteract());
        this.map.addEventListener("zoomstart", () => this.onInteract());
        this.map.addEventListener("zoomend", () => this.onInteract());
        this.map.addEventListener("resize", () => this.resize());
        this.map.addEventListener("click", (event: any) => this.handleMapClick(event));
        // Reliable on overlay/canvas and BMapGL drawing surfaces; capture doesn't
        // prevent default map pan/zoom. Ignore gestures and double delivery.
        let pointerDown: {x:number;y:number}|null=null;
        container.addEventListener('pointerdown',e=>{pointerDown={x:e.clientX,y:e.clientY};},true);
        container.addEventListener('pointerup',e=>{
            if(!pointerDown||Math.hypot(e.clientX-pointerDown.x,e.clientY-pointerDown.y)>7)return;
            const bounds=container.getBoundingClientRect();
            this.handleScreenClick({x:e.clientX-bounds.left,y:e.clientY-bounds.top});
        },true);
        this.installEntityBrowser();
        window.addEventListener("resize", () => this.resize());
        this.resize();

    }

    async initialize(redraw: () => void): Promise<void> {
        this.redraw = redraw;
        try {
            const [dataset, tosRows, gisRoutes, containerGeo, roadGeo, operationalGeo, portLayout] = await Promise.all([
                this.source.load(),
                this.tosSource.load(),
                this.gisRouteSource.load(),
                fetch("/data/gis/container_yards.geojson").then(r => r.json()),
                fetch("/data/gis/road_network.geojson").then(r => r.json()),
                fetch("/data/gis/operational_polygons.geojson").then(r => r.json()),
                loadPortGeometry()
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
            this.portLayout = portLayout;
            this.quayCranes = portLayout.quayCranes.map(c => ({
                id: c.id, name: c.name, longitude: c.position.longitude, latitude: c.position.latitude
            }));
            this.precomputeGISLocal();
            this.yardSlots = portLayout.yards.map(y => ({x:y.center.x,y:y.center.y}));
            // Actual ISO slot inside each source polygon; the AGV never drives here.
            const expandedYardSlots = dataset.vehicles.map((_, index) => {
                const yard = portLayout.yards[index % portLayout.yards.length];
                const cell = yard.containers[Math.floor(index / portLayout.yards.length) % yard.containers.length];
                return { x: cell?.center.x ?? yard.center.x, y: cell?.center.y ?? yard.center.y };
            });
            this.runtime.load(dataset.vehicles, gisRoutes, expandedYardSlots,portLayout.yards.map(y=>y.boundary));
            this.trafficVerified=new Set([...gisRoutes.values()].filter(r=>r.trafficVerified).map(r=>r.agvId));
            this.gantryPositions=portLayout.yards.map(y=>({...y.gantry.position}));
            // Target is assigned *simulated tasks*, not a claim that 80% are
            // continuously moving: intersections and crane service cause waits.
            // All routes are synthetic; unverified lanes remain clearly labelled.
            this.runtime.setContinuousWorkload(this.autoWorkload);
            // Start at multiple points of the same complete lifecycle routes.
            // The synthetic initial snapshot distributes the entire 155-vehicle
            // fleet across QC approaches, Gantry approaches and surveyed buffer
            // parking slots. Once shown, all AGVs move only by the existing
            // kinematics and collision avoidance; the snapshot is not GPS data.
            const snapshot=this.runtime.seedLifecycleScene();
            console.info('[Yangshan] simulated lifecycle spatial distribution',snapshot);

            this.loaded = true;
            console.info(`[Yangshan AGV] 155-vehicle GIS-constrained runtime ready; anchor=${YANGSHAN_SCENE.anchor.longitude},${YANGSHAN_SCENE.anchor.latitude}`);
            this.invalidate();

            void this.quayGLB?.load("/assets/cranes/quay_crane.glb").then(() => this.invalidate());
            void this.gantryGLB?.load("/assets/cranes/gantry_crane.glb").then(() => this.invalidate());
            void this.glb?.load("/assets/agv/agv.glb").then(() => {
                this.modelLoaded = this.glb?.isLoaded() ?? false;
                this.modelError = this.glb?.getLoadError() ?? this.modelError;
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
            if (this.loaded) {
                this.runtime.update(dt);
                this.updateGantryMotion(dt);
                this.workloadClock += dt;
                if(this.autoWorkload && this.workloadClock >= 1){this.workloadClock=0;this.refillWorkload(false);}
                if(this.selectedInspection && now-this.lastInspectorRefresh>750){
                    this.lastInspectorRefresh=now;this.inspectCurrentSelection();
                }
            }
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
        this.updateProjectionBasis();
        const ctx = this.fleetContext;
        const w = this.fleetCanvas.clientWidth;
        const h = this.fleetCanvas.clientHeight;
        const now = performance.now();
        const interacting = now - this.lastInteraction < 220;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.fleetCanvas.width, this.fleetCanvas.height);
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        this.drawSceneGeometry(ctx, interacting);

        if (!this.loaded || this.runtime.vehicles.length === 0) {
            this.drawBootstrap(ctx, w, h);
            return;
        }

        const selected = this.runtime.vehicles[this.selectedIndex];

        // All 155 current planned routes remain visible. Selected AGV also shows
        // its sampled historical positions (150 pre-generated simulation records
        // minimum, then live samples), decoupled from the old trajectory HUD.
        // Full lifecycle plans and already-travelled positions are always visible;
        // the old trajectory-control HUD is intentionally gone.
        this.drawAllTaskRoutes(ctx);
        this.drawAllTravelledPaths(ctx);
        this.drawSelectedHistory(ctx);

        for (let i = 0; i < this.runtime.vehicles.length; i++) {
            const state = this.runtime.vehicles[i].state;
            this.drawCargoTransfer(ctx, state, i === this.selectedIndex);
            this.drawVehicle(ctx, state, i === this.selectedIndex);
        }

        this.drawSelectionHighlight(ctx);
        this.renderSelectedGLB(selected?.state ?? null);
        this.updatePanel(selected?.state ?? null);
        // The 155-row dashboard table rebuild is heavy DOM work; skip it while the
        // user is actively panning/zooming so those interactions stay smooth, then
        // refresh once the map settles.
        if (!interacting && now - this.dashboardLastUpdate > 250) {
            this.dashboardLastUpdate = now;
            this.updateDataDashboard(selected?.state ?? null);
        }
    }

    destroy(): void {
        if (this.frame) cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.glb?.destroy();
        this.quayGLB?.destroy();
        this.gantryGLB?.destroy();
        this.fleetCanvas.remove();
        this.glbCanvas.remove();
        this.inspector.destroy();
    }

    private drawSceneGeometry(ctx: CanvasRenderingContext2D, interacting: boolean): void {
        // Only uploaded GIS geometry is rendered. The legacy reference-frame
        // road graph / synthetic route layer is intentionally removed.
        const pxPerMeter = Math.hypot(this.pbEastX, this.pbEastY);
        if (interacting && this.gisReady) {
            // Fast path during pan/zoom: one affine blit of the pre-rasterized GIS.
            this.blitGIS(ctx);
        } else {
            // At rest: crisp vector GIS, and refresh the offscreen cache so the next
            // gesture blits a bitmap matched to the current zoom.
            this.drawUploadedGIS(ctx);
            this.maybeRasterizeGIS(pxPerMeter);
        }
        this.drawContainerStacks(ctx);
        this.drawPortEquipment(ctx);
    }

    private maybeRasterizeGIS(pxPerMeter: number): void {
        if (this.gisWidthM <= 0 || this.gisHeightM <= 0 || pxPerMeter <= 0) return;
        if (this.gisReady && this.gisRasterPxPerMeter > 0 &&
            Math.abs(pxPerMeter - this.gisRasterPxPerMeter) / this.gisRasterPxPerMeter < 0.05) {
            return;
        }
        this.rasterizeGIS(pxPerMeter);
    }

    private rasterizeGIS(pxPerMeter: number): void {
        const dpr = this.dpr;
        let scale = Math.max(1e-4, pxPerMeter * dpr);
        const maxDim = 4096;
        const shrink = Math.min(1, maxDim / Math.max(this.gisWidthM * scale, this.gisHeightM * scale, 1));
        scale *= shrink;
        const cw = Math.max(1, Math.ceil(this.gisWidthM * scale));
        const ch = Math.max(1, Math.ceil(this.gisHeightM * scale));

        if (!this.gisCanvas) this.gisCanvas = document.createElement("canvas");
        this.gisCanvas.width = cw;
        this.gisCanvas.height = ch;
        const g = this.gisCanvas.getContext("2d");
        if (!g) { this.gisReady = false; return; }
        g.clearRect(0, 0, cw, ch);

        const unit = dpr;
        const off = (p: XY, out: ScreenPoint) => {
            out.x = (p.x - this.gisMinX) * scale;
            out.y = (this.gisMaxY - p.y) * scale;
        };
        const q: ScreenPoint = { x: 0, y: 0 };
        const trace = (ring: XY[]) => {
            g.beginPath();
            for (let i = 0; i < ring.length; i++) {
                off(ring[i], q);
                if (i === 0) g.moveTo(q.x, q.y);
                else g.lineTo(q.x, q.y);
            }
        };

        for (const ring of this.operationalLocal) {
            trace(ring);
            g.closePath();
            g.fillStyle = "rgba(40, 180, 120, 0.035)";
            g.fill();
            g.strokeStyle = "rgba(70, 220, 160, 0.28)";
            g.lineWidth = 1 * unit;
            g.stroke();
        }
        for (const ring of this.containerYardsLocal) {
            trace(ring);
            g.closePath();
            g.fillStyle = "rgba(255, 174, 39, 0.055)";
            g.fill();
            g.strokeStyle = "rgba(255, 174, 39, 0.42)";
            g.lineWidth = 1.2 * unit;
            g.stroke();
        }
        g.lineCap = "round";
        g.lineJoin = "round";
        for (const line of this.roadNetworkLocal) {
            trace(line);
            g.strokeStyle = "rgba(105, 190, 255, 0.34)";
            g.lineWidth = 2 * unit;
            g.stroke();
        }

        this.gisScale = scale;
        this.gisRasterPxPerMeter = pxPerMeter;
        this.gisReady = true;
    }

    private blitGIS(ctx: CanvasRenderingContext2D): void {
        if (!this.gisCanvas || !this.gisReady || this.gisScale <= 0) {
            this.drawUploadedGIS(ctx);
            return;
        }
        const dpr = this.dpr;
        const s = this.gisScale;
        // Screen position (CSS px) of the offscreen bitmap's top-left (local minX/maxY).
        const origin = this.project({ x: this.gisMinX, y: this.gisMaxY });
        // Map offscreen pixels -> device pixels: compose the per-frame local->screen
        // affine with the offscreen's fixed local->pixel scale, then bake in dpr.
        ctx.setTransform(
            dpr * this.pbEastX / s,
            dpr * this.pbEastY / s,
            -dpr * this.pbNorthX / s,
            -dpr * this.pbNorthY / s,
            dpr * origin.x,
            dpr * origin.y
        );
        ctx.drawImage(this.gisCanvas, 0, 0);
        // Restore the base transform the rest of render() draws under.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    private drawUploadedGIS(ctx: CanvasRenderingContext2D): void {
        // Operational polygon is the uploaded/derived driving envelope.
        for (const ring of this.operationalLocal) {
            ctx.beginPath();
            ring.forEach((point, index) => {
                const p = this.project(point);
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
        for (let i = 0; i < this.containerYardsLocal.length; i++) {
            const ring = this.containerYardsLocal[i];
            ctx.beginPath();
            ring.forEach((point, index) => {
                const p = this.project(point);
                if (index === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            });
            ctx.closePath();
            ctx.fillStyle = "rgba(255, 174, 39, 0.055)";
            ctx.fill();
            ctx.strokeStyle = "rgba(255, 174, 39, 0.42)";
            ctx.lineWidth = 1.2;
            ctx.stroke();

            const label = this.project(this.containerYardLabels[i]);
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
        for (const line of this.roadNetworkLocal) {
            ctx.beginPath();
            line.forEach((point, index) => {
                const p = this.project(point);
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
        if (this.quayCranesLocal.length === 0) return;
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        for (const crane of this.quayCranesLocal) {
            const p = this.project(crane.xy);
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

    /** Five-level ISO20 stack rendered as extruded box faces in a cached
     * camera-aligned 2.5D basis. Footprints remain georeferenced to GIS slots.
     * Visual elevation is an overlay approximation (not a terrain-calibrated 3D engine).
     */
    private drawContainerStacks(ctx: CanvasRenderingContext2D): void {
        if (!this.portLayout) return;
        const mpp = Math.hypot(this.pbEastX, this.pbEastY);
        if (mpp < 0.18) return;
        const viewportW=this.fleetCanvas.clientWidth,viewportH=this.fleetCanvas.clientHeight;
        const skip=mpp<0.32?4:mpp<0.48?2:1;
        const reserved=new Set(this.runtime.vehicles.filter(v=>v.taskCompleted===0)
            .map(v=>`${v.state.yardX.toFixed(3)}:${v.state.yardY.toFixed(3)}`));
        const colors=['#d36e48','#448ead','#d8af54','#56a38b','#c98757'];
        const polygon=(corners:ScreenPoint[],fill:string,stroke='rgba(7,25,35,.6)')=>{
            ctx.beginPath();corners.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
            ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=.65;ctx.stroke();
        };
        for(const yard of this.portLayout.yards){
            const [ax,ay]=yard.axis,nx=-ay,ny=ax;
            for(let k=0;k<yard.containers.length;k++){
                if(k%skip)continue;
                const box=yard.containers[k];
                if(reserved.has(`${box.center.x.toFixed(3)}:${box.center.y.toFixed(3)}`))continue;
                const p=this.project(box.center),levels=Math.max(1,Math.min(5,box.level));
                if(p.x < -36||p.x>viewportW+36||p.y<-65||p.y>viewportH+65)continue;
                const u={x:(ax*this.pbEastX+ay*this.pbNorthX)*3.029,y:(ax*this.pbEastY+ay*this.pbNorthY)*3.029};
                const v={x:(nx*this.pbEastX+ny*this.pbNorthX)*1.219,y:(nx*this.pbEastY+ny*this.pbNorthY)*1.219};
                const base=[{x:p.x-u.x-v.x,y:p.y-u.y-v.y},{x:p.x+u.x-v.x,y:p.y+u.y-v.y},
                    {x:p.x+u.x+v.x,y:p.y+u.y+v.y},{x:p.x-u.x+v.x,y:p.y-u.y+v.y}];
                // 2.591 m height per ISO box. Move all vertices vertically by the
                // same local world-Z projection, never mutate the ground footprint.
                const dz=Math.min(18,2.591*mpp*.52);
                for(let level=0;level<levels;level++){
                    const z0=level*dz,z1=(level+1)*dz;
                    const low=base.map(q=>({x:q.x,y:q.y-z0}));
                    const high=base.map(q=>({x:q.x,y:q.y-z1}));
                    const shade=colors[(k+level)%colors.length];
                    polygon([low[1],low[2],high[2],high[1]],'#295567');
                    polygon([low[2],low[3],high[3],high[2]],'#1e4152');
                    polygon(high,shade,'rgba(238,245,242,.4)');
                    if(mpp>.7){
                        const a=high[1],b=high[2];ctx.strokeStyle='rgba(230,241,239,.5)';ctx.lineWidth=.6;
                        ctx.beginPath();ctx.moveTo(a.x+(b.x-a.x)*.18,a.y+(b.y-a.y)*.18);
                        ctx.lineTo(a.x+(b.x-a.x)*.82,a.y+(b.y-a.y)*.82);ctx.stroke();
                    }
                }
            }
        }
    }

    /** Finite-speed crane motion along the yard's validated rail segment.
     * When not servicing an AGV the gantry continuously returns through its
     * initial position; it never disappears after reaching an endpoint.
     */
    private updateGantryMotion(dt:number):void {
        if(!this.portLayout)return;
        this.gantryClock+=dt;
        for(let i=0;i<this.portLayout.yards.length;i++){
            const yard=this.portLayout.yards[i];
            const a=yard.gantry.railStart,b=yard.gantry.railEnd;
            const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
            const projection=(p:XY)=>Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(len*len)));
            const job=this.runtime.vehicles.find(v=>v.state.yardId===yard.id &&
                v.state.cargoTransferKind==='AGV_TO_YARD' && yard.handoffReachable);
            let t:number;
            if(job){
                const from=projection(yard.unload);
                const to=projection({x:job.state.yardX,y:job.state.yardY});
                t=from+(to-from)*job.state.cargoTransferProgress;
            }else{
                // 0.5 is the initial centre. ±0.38 never reaches a rail endpoint.
                t=0.5+0.38*Math.sin(this.gantryClock*2*Math.PI/120+i*.15);
            }
            const target={x:a.x+t*dx,y:a.y+t*dy};
            const previous=this.gantryPositions[i]??yard.gantry.position;
            const d=Math.hypot(target.x-previous.x,target.y-previous.y);
            const maxStep=2.0*dt;
            const portion=d>0?Math.min(1,maxStep/d):1;
            this.gantryPositions[i]={x:previous.x+(target.x-previous.x)*portion,
                y:previous.y+(target.y-previous.y)*portion};
        }
    }
    private movingGantryPosition(index:number):XY {
        const yard=this.portLayout!.yards[index];
        return this.gantryPositions[index]??yard.gantry.position;
    }

    private drawPortEquipment(ctx: CanvasRenderingContext2D): void {
        if (!this.portLayout) return;
        const buffer=this.portLayout.parkingBuffer;
        ctx.save();ctx.beginPath();
        buffer.boundary.forEach((pt,i)=>{const p=this.project(pt);if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});
        ctx.closePath();ctx.fillStyle='rgba(40,110,220,.12)';ctx.strokeStyle='rgba(68,185,250,.9)';ctx.lineWidth=2;ctx.fill();ctx.stroke();
        const mid=this.project(buffer.spots[Math.floor(buffer.spots.length/2)]);
        ctx.font='700 11px sans-serif';ctx.fillStyle='#9cdeff';
        ctx.fillText('AGV 缓冲区 · 无任务停车',mid.x+8,mid.y-12);ctx.restore();
        const w=this.fleetCanvas.clientWidth,h=this.fleetCanvas.clientHeight;
        for(let yardIndex=0;yardIndex<this.portLayout.yards.length;yardIndex++){
            const yard=this.portLayout.yards[yardIndex];
            const g=this.project(this.movingGantryPosition(yardIndex)),u=this.project(yard.unload);
            if(g.x< -110||g.x>w+110||g.y< -110||g.y>h+110)continue;
            const a=this.project(yard.gantry.railStart),b=this.project(yard.gantry.railEnd);
            ctx.save();ctx.strokeStyle='rgba(255,205,70,.9)';ctx.lineWidth=1.5;
            ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
            ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(g.x-6,g.y-5);ctx.lineTo(g.x+6,g.y-5);ctx.moveTo(g.x-6,g.y+5);ctx.lineTo(g.x+6,g.y+5);ctx.stroke();
            ctx.fillStyle=yard.handoffReachable?'#00e9d0':'#ff6273';ctx.beginPath();ctx.arc(u.x,u.y,3.5,0,Math.PI*2);ctx.fill();ctx.restore();
        }
        this.drawQuayCranes(ctx);
    }

    /** Reuses the single GLB mesh/buffers for each instance. Overview uses cheap
     * symbols; at close zoom renders only the first few visible models per frame.
     */
    private renderFixedGLBModels(): void {
        if(!this.portLayout||!this.gl)return;
        const w=this.glbCanvas.clientWidth,h=this.glbCanvas.clientHeight;
        if(Math.hypot(this.pbEastX,this.pbEastY)<.35 || performance.now()-this.lastInteraction<220)return;
        const visible=(p:{x:number;y:number})=>{const v=this.project(p);return v.x>-100&&v.x<w+100&&v.y>-100&&v.y<h+100;};
        if(this.quayGLB?.isLoaded()){
            let count=0;
            for(const c of this.portLayout.quayCranes){if(count>=3)break;if(!visible(c.position))continue;
                this.quayGLB.setState({x:c.position.x,y:c.position.y,heading:-.24+this.modelYawCorrection,speed:0,state:'idle'});
                this.quayGLB.render(this.fastGLBProjection(c.position));count++;
            }
        }
        if(this.gantryGLB?.isLoaded()){
            let count=0;
            for(let i=0;i<this.portLayout.yards.length;i++){
                if(count>=24)break;
                const y=this.portLayout.yards[i],position=this.movingGantryPosition(i);
                if(!visible(position))continue;
                this.gantryGLB.setModelScale(y.gantry.scale);
                this.gantryGLB.setState({x:position.x,y:position.y,heading:y.heading+this.modelYawCorrection,speed:0,state:'idle'});
                this.gantryGLB.render(this.fastGLBProjection(position));count++;
            }
        }
    }

    private fastGLBProjection(p:{x:number;y:number}):AGVProjection{
        const s=this.project(p);
        return {agvPixelX:s.x,agvPixelY:s.y,eastBasisX:this.pbEastX,eastBasisY:this.pbEastY,
            northBasisX:this.pbNorthX,northBasisY:this.pbNorthY,
            viewportWidth:Math.max(1,this.glbCanvas.clientWidth),viewportHeight:Math.max(1,this.glbCanvas.clientHeight)};
    }

    private renderSelectedGLB(state: AGVRuntimeState | null): void {
        const gl = this.gl;
        if (!gl || !this.glb) return;
        gl.viewport(0, 0, this.glbCanvas.width, this.glbCanvas.height);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        this.renderFixedGLBModels();
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

    /** Show all QC-to-ASC synthetic corridor choices as a separate planning layer. */
    private drawCorridorNetwork(ctx:CanvasRenderingContext2D):void {
        ctx.save();ctx.lineWidth=.65;ctx.strokeStyle='rgba(143,233,197,.14)';
        const keys=new Set<string>();
        for(const vehicle of this.runtime.vehicles){
            for(const variant of vehicle.variants){
                const key=`${vehicle.quayCraneId}:${variant.yardId}`;
                if(keys.has(key))continue;keys.add(key);
                const pts=variant.segment.points;
                if(pts.length<2)continue;
                ctx.beginPath();for(let i=0;i<pts.length;i++){
                    const p=this.project(pts[i]);if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);
                }ctx.stroke();
            }
        }
        ctx.restore();
    }
    /** Render recorded travelled traces for all AGVs, with screen-space
     * downsampling to protect the main thread when 155 histories grow. */
    private drawAllTravelledPaths(ctx:CanvasRenderingContext2D):void {
        ctx.save();ctx.lineWidth=1.5;ctx.strokeStyle='rgba(255,83,240,.62)';
        for(let i=0;i<this.runtime.vehicles.length;i++){
            const samples=this.runtime.getTravelledPath(i,2400);
            if(samples.length<2)continue;
            const stride=Math.max(1,Math.ceil(samples.length/350));
            ctx.beginPath();let first=true;
            for(let j=0;j<samples.length;j+=stride){const p=this.project(samples[j]);
                if(first){ctx.moveTo(p.x,p.y);first=false;}else ctx.lineTo(p.x,p.y);}
            const last=this.project(samples.at(-1)!);ctx.lineTo(last.x,last.y);ctx.stroke();
        }
        ctx.restore();
    }
    /** Render all 155 *whole mission* routes, not just the quay-to-yard leg.
     * Bright distinct hues show parking→QC, loaded QC→ASC, empty ASC→QC,
     * and QC→parking. Selected AGV is drawn on top with a dark halo.
     */
    private drawAllTaskRoutes(ctx:CanvasRenderingContext2D):void {
        const palette:Record<string,string>={
            QUAY_PICKUP:'#1dd6ff',YARD_STACK:'#3cff8e',
            RETURN_QUAY:'#ffce3e',RETURN_BUFFER:'#d18cff'
        };
        ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
        const selected=this.selectedInspection?.kind==='AGV'?this.selectedIndex:-1;
        for(let i=0;i<this.runtime.vehicles.length;i++){
            if(i===selected)continue;
            const state=this.runtime.vehicles[i].state;
            const legs=this.runtime.getLifecycleLegs(i);
            ctx.globalAlpha=state.hasTask?.58:.26;
            ctx.lineWidth=state.hasTask?1.65:1.15;
            for(const leg of legs){
                if(leg.points.length<2)continue;
                ctx.strokeStyle=palette[leg.phase]??'#b2d9f5';
                this.strokeRouteLeg(ctx,leg.points);
            }
        }
        if(selected>=0){
            // High-contrast underlay keeps the selected mission readable even
            // where many vehicles use the same road corridor.
            const legs=this.runtime.getLifecycleLegs(selected);
            ctx.globalAlpha=.97;
            for(const leg of legs){
                if(leg.points.length<2)continue;
                ctx.strokeStyle='rgba(3,11,26,.98)';ctx.lineWidth=5.8;
                this.strokeRouteLeg(ctx,leg.points);
                ctx.strokeStyle=palette[leg.phase]??'#fff5a2';ctx.lineWidth=3.5;
                this.strokeRouteLeg(ctx,leg.points);
            }
        }
        ctx.restore();
    }
    private strokeRouteLeg(ctx:CanvasRenderingContext2D,points:XY[]):void {
        ctx.beginPath();
        for(let j=0;j<points.length;j++){
            const p=this.project(points[j]);
            if(j===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);
        }
        ctx.stroke();
    }

    /** A persistent selection ring is drawn for every inspectable equipment
     * type, including stacked containers at their visual elevation. */
    private drawSelectionHighlight(ctx:CanvasRenderingContext2D):void {
        const hit=this.selectedInspection;if(!hit||!this.portLayout)return;
        let world:XY|undefined,label='',heightOffset=0;
        if(hit.kind==='AGV'){
            const v=this.runtime.vehicles[hit.index]?.state;
            if(v){world=v;label=v.id;}
        }else if(hit.kind==='QC'){
            const q=this.portLayout.quayCranes[hit.index];
            if(q){world=q.position;label=`QC-${q.id}`;}
        }else if(hit.kind==='ASC'){
            const y=this.portLayout.yards[hit.index];
            if(y){world=this.movingGantryPosition(hit.index);label=`Gantry ${y.id}`;}
        }else if(hit.yardIndex!==undefined&&hit.containerIndex!==undefined){
            const c=this.portLayout.yards[hit.yardIndex]?.containers[hit.containerIndex];
            if(c){world=c.center;label=c.id;
                heightOffset=(hit.layer??c.level-.5)*Math.min(18,2.591*Math.hypot(this.pbEastX,this.pbEastY)*.52);
            }
        }
        if(!world)return;
        const p=this.project(world),x=p.x,y=p.y-heightOffset;
        const radius=hit.kind==='CONTAINER'?16:hit.kind==='AGV'?17:21;
        ctx.save();ctx.globalAlpha=1;
        ctx.shadowColor='#ffec75';ctx.shadowBlur=16;
        ctx.strokeStyle='#fff176';ctx.lineWidth=3;
        ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.stroke();
        ctx.shadowBlur=0;ctx.strokeStyle='#08233b';ctx.lineWidth=1.2;
        ctx.beginPath();ctx.arc(x,y,radius+4,0,Math.PI*2);ctx.stroke();
        ctx.beginPath();ctx.moveTo(x-radius-8,y);ctx.lineTo(x-radius+5,y);
        ctx.moveTo(x+radius-5,y);ctx.lineTo(x+radius+8,y);
        ctx.moveTo(x,y-radius-8);ctx.lineTo(x,y-radius+5);
        ctx.moveTo(x,y+radius-5);ctx.lineTo(x,y+radius+8);ctx.stroke();
        ctx.font='bold 12px sans-serif';const tw=ctx.measureText(label).width;
        ctx.fillStyle='rgba(6,25,42,.93)';ctx.fillRect(x-tw/2-7,y-radius-29,tw+14,18);
        ctx.fillStyle='#fff7ab';ctx.fillText(label,x-tw/2,y-radius-16);
        ctx.restore();
    }

    /** Historical samples are intentionally different from planned routes. */
    private drawSelectedHistory(ctx:CanvasRenderingContext2D):void {
        if(this.selectedInspection?.kind!=='AGV')return;
        const samples=this.runtime.getHistoryRecords(this.selectedIndex,2400);
        if(samples.length<2)return;
        ctx.save();ctx.strokeStyle='rgba(255,126,246,.99)';ctx.lineWidth=3.1;
        ctx.beginPath();
        const stride=Math.max(1,Math.ceil(samples.length/1100));
        for(let i=0;i<samples.length;i+=stride){
            const p=this.project(samples[i]);if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);
        }
        const last=this.project(samples.at(-1)!);ctx.lineTo(last.x,last.y);
        ctx.stroke();ctx.fillStyle='#fdd1fb';
        // Sample markers are thinned at far zoom, history values remain intact.
        const step=Math.max(1,Math.ceil(samples.length/150));
        for(let i=0;i<samples.length;i+=step){const p=this.project(samples[i]);ctx.beginPath();ctx.arc(p.x,p.y,1.7,0,Math.PI*2);ctx.fill();}
        ctx.restore();
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

    /** A 7.2m x 3.0m AGV platform, carrying an ISO 20ft (6.058 x 2.438m) box.
     * Uses the SAME georeferenced affine basis as the crane and static containers.
     */
    private drawMetricRectangle(ctx:CanvasRenderingContext2D, center:XY, heading:number,
        length:number,width:number,fill:string,stroke:string,lineWidth=1):void {
        const forward={x:Math.cos(heading),y:Math.sin(heading)};
        const side={x:-forward.y,y:forward.x};
        const corners:[[number,number],[number,number],[number,number],[number,number]]=[
            [-length/2,-width/2],[length/2,-width/2],[length/2,width/2],[-length/2,width/2]
        ];
        ctx.beginPath();
        corners.forEach(([u,v],i)=>{
            const p=this.project({x:center.x+u*forward.x+v*side.x,y:center.y+u*forward.y+v*side.y});
            if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);
        });
        ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=lineWidth;ctx.stroke();
    }

    /** The spreader and its 20ft cargo share one georeferenced hook position.
     * During a reachable handoff, the crane moves longitudinally on rails and
     * its trolley translates transversely. No independent pixel-offset box.
     */
    private drawCargoTransfer(ctx:CanvasRenderingContext2D,state:AGVRuntimeState,selected:boolean):void {
        if(!state.cargoVisible)return;
        const yard=this.portLayout?.yards.find(y=>y.id===state.yardId);
        if(state.cargoTransferKind==='AGV_TO_YARD'&&yard&&!yard.handoffReachable){
            // GIS cannot prove that the crane can pick this box. Do not show a
            // physically impossible hoist; inspector explains the blocker.
            return;
        }
        const position={x:state.cargoX,y:state.cargoY};
        let heading=state.heading;
        if(state.cargoTransferKind==='AGV_TO_YARD'&&yard){
            heading=Math.atan2(yard.axis[1],yard.axis[0]);
            const index=this.portLayout!.yards.indexOf(yard);
            const g=this.project(this.movingGantryPosition(index));
            const hook=this.project(position);
            ctx.save();ctx.strokeStyle=selected?'#ffe9a0':'rgba(240,194,96,.65)';ctx.lineWidth=selected?2:1;
            ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(g.x,g.y);ctx.lineTo(hook.x,hook.y);ctx.stroke();ctx.restore();
            // The cable is attached to the box's own projected centre.
            const hoist=Math.sin(Math.PI*state.cargoTransferProgress)*Math.max(1,3*Math.hypot(this.pbEastX,this.pbEastY));
            ctx.save();ctx.strokeStyle='#fff0aa';ctx.beginPath();ctx.moveTo(hook.x,hook.y-hoist-7);ctx.lineTo(hook.x,hook.y-hoist);ctx.stroke();ctx.restore();
        }
        this.drawMetricRectangle(ctx,position,heading,6.058,2.438,
            state.cargoTransferKind==='AGV_TO_YARD'?'#ffd166':'#d77948',selected?'#ffffff':'#ffe2b1',selected?1.7:1);
        if(selected&&state.cargoTransferKind!=='NONE'){
            const p=this.project(position);ctx.save();ctx.font='700 10px sans-serif';ctx.fillStyle='#fff5cb';
            ctx.fillText(state.cargoTransferKind==='AGV_TO_YARD'?'Gantry 吊具 / 20ft 标准箱':'QC 吊具 / 20ft 标准箱',p.x+10,p.y-13);ctx.restore();
        }
    }

    private drawVehicle(ctx:CanvasRenderingContext2D,state:AGVRuntimeState,selected:boolean):void {
        const p=this.project({x:state.x,y:state.y});
        const colors=phaseStyle[state.phase];
        ctx.save();
        this.drawMetricRectangle(ctx,{x:state.x,y:state.y},state.heading,7.2,3.0,colors.fill,
            selected?'#ffffff':colors.stroke,selected?2:1);
        // A small nose shows real heading. A standard 20ft container fits on deck.
        const nose=this.project({x:state.x+Math.cos(state.heading)*3,y:state.y+Math.sin(state.heading)*3});
        ctx.beginPath();ctx.arc(nose.x,nose.y,Math.max(1,Math.min(3,Math.hypot(this.pbEastX,this.pbEastY))),0,Math.PI*2);
        ctx.fillStyle='#effaff';ctx.fill();ctx.restore();
        if(selected){
            ctx.save();ctx.font='800 11px sans-serif';ctx.fillStyle='#ffffff';ctx.shadowColor='#000';ctx.shadowBlur=5;
            ctx.fillText(`${state.id} · ${state.taskStatus}${state.waitingForTraffic?' · 避让':''}`,p.x+11,p.y-11);ctx.restore();
        }
    }

    private numericId(id: string): number {
        return Number.parseInt(id.match(/(\d+)$/)?.[1] ?? "0", 10) || 0;
    }

    private updateProjectionBasis(): void {
        const center = this.map.getCenter();
        const centerPixel = this.map.pointToPixel(new BMapGL.Point(center.lng, center.lat));
        const centerLocal = this.coordinateSystem.geoToLocal({ longitude: center.lng, latitude: center.lat, height: 0 });
        const probe = 128;
        const eastGeo = this.coordinateSystem.localToGeo({ x: centerLocal.x + probe, y: centerLocal.y, z: 0 });
        const northGeo = this.coordinateSystem.localToGeo({ x: centerLocal.x, y: centerLocal.y + probe, z: 0 });
        const eastPixel = this.map.pointToPixel(new BMapGL.Point(eastGeo.longitude, eastGeo.latitude));
        const northPixel = this.map.pointToPixel(new BMapGL.Point(northGeo.longitude, northGeo.latitude));
        this.pbCenterX = this.fleetCanvas.clientWidth / 2;
        this.pbCenterY = this.fleetCanvas.clientHeight / 2;
        this.pbOriginX = centerLocal.x;
        this.pbOriginY = centerLocal.y;
        this.pbEastX = (eastPixel.x - centerPixel.x) / probe;
        this.pbEastY = (eastPixel.y - centerPixel.y) / probe;
        this.pbNorthX = (northPixel.x - centerPixel.x) / probe;
        this.pbNorthY = (northPixel.y - centerPixel.y) / probe;

        // Detect real map motion (pan changes origin, zoom changes the pixel/meter
        // scale) independent of which Baidu events fire, so interaction LOD stays
        // active for the whole gesture — not just when zoomstart/zoomend happen to fire.
        const moved =
            Math.abs(this.pbEastX - this.prevPbEastX) > 1e-4 ||
            Math.abs(this.pbEastY - this.prevPbEastY) > 1e-4 ||
            Math.abs(this.pbOriginX - this.prevPbOriginX) > 1e-3 ||
            Math.abs(this.pbOriginY - this.prevPbOriginY) > 1e-3;
        if (moved) this.lastInteraction = performance.now();
        this.prevPbEastX = this.pbEastX;
        this.prevPbEastY = this.pbEastY;
        this.prevPbOriginX = this.pbOriginX;
        this.prevPbOriginY = this.pbOriginY;
    }

    private precomputeGISLocal(): void {
        const toLocal = (lng: number, lat: number): XY => {
            const p = this.coordinateSystem.geoToLocal({ longitude: lng, latitude: lat, height: 0 });
            return { x: p.x, y: p.y };
        };
        this.operationalLocal = this.operationalPolygons.map(ring => ring.map(([lng, lat]) => toLocal(lng, lat)));
        this.containerYardsLocal = this.containerYards.map(ring => ring.map(([lng, lat]) => toLocal(lng, lat)));
        this.containerYardLabels = this.containerYardsLocal.map(ring => {
            const c = ring.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
            const n = Math.max(1, ring.length);
            return { x: c.x / n, y: c.y / n };
        });
        this.roadNetworkLocal = this.roadNetwork.map(line => line.map(([lng, lat]) => toLocal(lng, lat)));
        this.quayCranesLocal = this.quayCranes.map(crane => ({ id: crane.id, xy: toLocal(crane.longitude, crane.latitude) }));

        // Local-space bounding box of the static GIS layers, used to size the offscreen
        // GIS bitmap. Invalidate any previous raster so it re-renders for the new data.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const scan = (rings: XY[][]) => {
            for (const ring of rings) for (const p of ring) {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
            }
        };
        scan(this.operationalLocal);
        scan(this.containerYardsLocal);
        scan(this.roadNetworkLocal);
        if (Number.isFinite(minX) && maxX > minX && maxY > minY) {
            const pad = 24;
            this.gisMinX = minX - pad;
            this.gisMaxY = maxY + pad;
            this.gisWidthM = (maxX - minX) + pad * 2;
            this.gisHeightM = (maxY - minY) + pad * 2;
        }
        this.gisReady = false;
    }

    private project(local: XY): ScreenPoint {
        const dx = local.x - this.pbOriginX;
        const dy = local.y - this.pbOriginY;
        return {
            x: this.pbCenterX + dx * this.pbEastX + dy * this.pbNorthX,
            y: this.pbCenterY + dx * this.pbEastY + dy * this.pbNorthY
        };
    }

    private projectGeo(longitude: number, latitude: number): ScreenPoint {
        const p = this.coordinateSystem.geoToLocal({ longitude, latitude, height: 0 });
        return this.project({ x: p.x, y: p.y });
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
        this.gl?.viewport(0, 0, this.glbCanvas.width, this.glbCanvas.height);
    }

    private invalidate(): void { this.redraw?.(); }

    private onInteract(): void {
        this.lastInteraction = performance.now();
        this.invalidate();
    }

    private updatePanel(state: AGVRuntimeState | null): void {
        const runtimeStats = this.runtime.getStats();
        const selectedTOS = state ? this.tosRows.get(state.id) : undefined;
        // Never overwrite the imported record with animation values. The source
        // dataset and the simulated current state remain separate data layers.
        const mapStats: Record<string, string> = {
            // Live fleet counters; idle vehicles stay in their actual GIS buffer slots.
            agvTotal: String(runtimeStats.total),
            agvMoving: String(runtimeStats.moving),
            agvParking: String(runtimeStats.parking),
            agvCharging: String(runtimeStats.charging),
            agvFault: "0",
            agvBattery: `${runtimeStats.avgBattery.toFixed(0)}%`,
            agvRuntime: this.runtime.isRunning() ? `RUN · ${this.runtime.getSimulationSpeed().toFixed(1)}×` : "PAUSED",
            agvModel: (this.glb?.isLoaded() ?? false) ? "GLB READY" : ((this.glb?.getLoadError() ?? this.modelError) ? "GLB FALLBACK" : "GLB LOADING"),
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
        set("gisContainerCount", String(this.portLayout?.yards.reduce((n,y)=>n+y.containers.reduce((sum,c)=>sum+c.level,0),0) ?? 0));
        set("gisGantryCount", String(this.portLayout?.yards.length ?? 0));
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

    private installEntityBrowser():void {
        const summary=document.getElementById('top-left');
        const root=document.createElement('section');root.className='entity-browser';root.id='entity-browser';
        root.setAttribute('aria-label','设备和堆场集装箱浏览器');root.hidden=true;
        const header=document.createElement('div');header.className='browser-head';
        const title=document.createElement('strong');title.textContent='当前设备与集装箱信息';
        const close=document.createElement('button');close.type='button';close.textContent='关闭 ×';close.onclick=()=>root.hidden=true;
        header.append(title,close);
        const tabs=document.createElement('div');tabs.className='browser-tabs';
        for(const [kind,name] of [['AGV','AGV · 155 辆'],['QC','岸桥 QC'],['ASC','轨道吊 Gantry'],['CONTAINER','集装箱']] as const){
            const button=document.createElement('button');button.textContent=name;button.dataset.kind=kind;
            button.onclick=()=>{this.browserTab=kind;this.refreshEntityBrowser();};tabs.append(button);
        }
        const toggle=document.createElement('button');toggle.type='button';toggle.id='auto-workload-toggle';
        toggle.style.cssText='padding:7px 9px;margin-bottom:8px;background:#155778;color:#fff;border:1px solid #4a8ca8;border-radius:6px;cursor:pointer';
        toggle.onclick=()=>{this.autoWorkload=!this.autoWorkload;
          this.runtime.setContinuousWorkload(this.autoWorkload);this.refreshEntityBrowser();};
        const input=document.createElement('input');input.type='search';input.className='browser-search';input.placeholder='按设备编号、箱号或堆场检索';
        input.addEventListener('input',()=>{this.browserFilter=input.value.trim().toLowerCase();this.refreshEntityBrowser();});
        const list=document.createElement('div');list.className='browser-list';list.id='entity-browser-list';
        const notice=document.createElement('p');notice.id='entity-browser-note';notice.style.color='#9cc5dc';
        root.append(header,tabs,toggle,input,notice,list);document.body.append(root);this.browserRoot=root;
        const open=()=>{root.hidden=!root.hidden;if(!root.hidden)this.refreshEntityBrowser();};
        summary?.addEventListener('click',open);
        summary?.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
    }

    private refillWorkload(initial:boolean):number {
        if(!this.autoWorkload)return 0;
        const movingTarget=Math.ceil(this.runtime.vehicles.length*this.workloadTarget);
        const active=this.runtime.vehicles.filter(v=>v.active).length;
        const moving=this.runtime.getStats().moving;
        // Controllers compensate for cars currently servicing gantries / waiting
        // at intersections. Actual moving remains measured, not invented.
        const target=initial?movingTarget:Math.min(this.runtime.vehicles.length,
            Math.max(movingTarget,active+Math.max(0,movingTarget-moving)));
        const desired=Math.max(0,target-active);
        let dispatched=0;
        // Evenly distribute jobs across 61 yards, rather than saturating a
        // handful of crane bays. Unverified simulated lanes are NOT certified.
        // Limit each wave even if many tasks are pending; subsequent updates
        // launch cars from the least congested GIS buffer sections and QCs.
        dispatched=this.runtime.dispatchDistributed(Math.min(desired,initial?10:7));
        return dispatched;
    }

    private refreshEntityBrowser():void {
        if(!this.browserRoot||!this.loaded||!this.portLayout)return;
        this.browserRoot.querySelectorAll<HTMLButtonElement>('.browser-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.kind===this.browserTab));
        const toggle=this.browserRoot.querySelector<HTMLButtonElement>('#auto-workload-toggle');
        if(toggle)toggle.textContent=this.autoWorkload?'自动任务负载：开（暂停后车辆完成任务返回缓冲）':'自动任务负载：关（车辆完成现有任务后待命）';
        const info=this.browserRoot.querySelector<HTMLElement>('#entity-browser-note');
        if(info)info.textContent=`目标：约 ${Math.round(this.workloadTarget*100)}% 车辆实际行驶；当前移动 ${this.runtime.getStats().moving}/155，执行任务 ${this.runtime.vehicles.filter(v=>v.active).length}/155。自动派工动态补偿等待车辆；路线为模拟，未获工业安全认证。`;
        const list=this.browserRoot.querySelector<HTMLElement>('#entity-browser-list');if(!list)return;
        list.replaceChildren();const filter=this.browserFilter;
        type Entry={kind:'AGV'|'QC'|'ASC'|'CONTAINER';index:number;yardIndex?:number;containerIndex?:number;name:string;detail:string};
        const entries:Entry[]=[];
        if(this.browserTab==='AGV')this.runtime.vehicles.forEach((v,i)=>entries.push({kind:'AGV',index:i,name:v.state.id,detail:`${v.state.taskStatus} · ${(v.state.speed*3.6).toFixed(1)} km/h · ${v.state.taskId}`}));
        if(this.browserTab==='QC')this.portLayout.quayCranes.forEach((q,i)=>entries.push({kind:'QC',index:i,name:`QC-${String(q.id).padStart(2,'0')}`,detail:'岸桥位置 · GIS'}));
        if(this.browserTab==='ASC')this.portLayout.yards.forEach((y,i)=>entries.push({kind:'ASC',index:i,name:`ASC-${y.id}`,detail:`${y.name} · ${y.handoffReachable?'可作业':'待标定'}`}));
        if(this.browserTab==='CONTAINER')this.portLayout.yards.forEach((y,yi)=>y.containers.forEach((c,ci)=>entries.push({kind:'CONTAINER',index:ci,yardIndex:yi,containerIndex:ci,name:c.id,detail:`${y.id} · ${c.level} 层 · 20ft`})));
        let shown=0;for(const entry of entries){if(filter&&!`${entry.name} ${entry.detail}`.toLowerCase().includes(filter))continue;if(shown++>=250)break;
            const row=document.createElement('button');row.type='button';row.className='browser-item';
            const name=document.createElement('span');name.textContent=entry.name;const detail=document.createElement('small');detail.textContent=entry.detail;
            row.append(name,detail);row.onclick=()=>{this.inspectEntity(entry);this.invalidate();};list.append(row);
        }
        if(shown>250){const more=document.createElement('small');more.textContent=`仅显示前 250 条，请输入箱号或区域过滤（共匹配 ${shown} 条）`;list.append(more);}
    }

    private handleMapClick(event:any):void {
        const point=event?.point;if(!point||typeof point.lng!=='number')return;
        this.updateProjectionBasis();this.handleScreenClick(this.projectGeo(point.lng,point.lat));
    }
    private handleScreenClick(click:ScreenPoint):void {
        if(!this.loaded||!this.portLayout||performance.now()-this.lastScreenPick<130)return;
        this.updateProjectionBasis();
        type Hit={kind:'AGV'|'QC'|'ASC'|'CONTAINER';index:number;yardIndex?:number;containerIndex?:number;layer?:number;score:number};
        let best:Hit|null=null;
        const tryHit=(p:XY,kind:Hit['kind'],index:number,threshold:number,priority:number,yardIndex?:number,containerIndex?:number,layer?:number)=>{
            const screen=this.project(p);
            if(layer)screen.y-=(layer-.5)*Math.min(18,2.591*Math.hypot(this.pbEastX,this.pbEastY)*.52);
            const d=Math.hypot(click.x-screen.x,click.y-screen.y);
            const score=d/threshold+priority*.10;if(d<=threshold&&(!best||score<best.score))best={kind,index,yardIndex,containerIndex,layer,score};
        };
        this.runtime.vehicles.forEach((v,i)=>tryHit(v.state,'AGV',i,26,0));
        this.portLayout.quayCranes.forEach((q,i)=>tryHit(q.position,'QC',i,22,1));
        this.portLayout.yards.forEach((y,yi)=>{
            tryHit(this.movingGantryPosition(yi),'ASC',yi,26,1,yi);
            if(Math.hypot(this.pbEastX,this.pbEastY)>.18)y.containers.forEach((c,ci)=>{
                for(let layer=1;layer<=Math.max(1,Math.min(5,c.level));layer++)tryHit(c.center,'CONTAINER',ci,Math.max(8,Math.min(17,Math.hypot(this.pbEastX,this.pbEastY)*4)),2,yi,ci,layer);
            });
        });
        if(best){this.lastScreenPick=performance.now();this.inspectEntity(best as Hit);this.invalidate();}
    }
    private inspectCurrentSelection():void {
        if(this.selectedInspection)this.inspectEntity(this.selectedInspection,false);
    }
    private inspectEntity(hit:{kind:'AGV'|'QC'|'ASC'|'CONTAINER';index:number;yardIndex?:number;containerIndex?:number;layer?:number},remember=true):void {
        if(!this.portLayout)return;
        if(remember)this.selectedInspection={kind:hit.kind,index:hit.index,yardIndex:hit.yardIndex,containerIndex:hit.containerIndex,layer:hit.layer};
        const field=(key:string,label:string,value:string|number,source:'simulation'|'GIS'='simulation'):InspectionField=>({key,label,value,source});
        const position=(p:XY)=>`${p.x.toFixed(2)} m, ${p.y.toFixed(2)} m`;
        if(hit.kind==='AGV'){
            const v=this.runtime.vehicles[hit.index]?.state;if(!v)return;
            this.selectedIndex=hit.index;
            this.inspector.show('AGV',v.id,[field('TAA_AGV_ID','AGV 编号',v.id),field('TAA_WI_ID','任务',v.hasTask?v.taskId:'当前无任务'),field('TAA_AGO_GROUP_ID','指令组',v.routeId),field('TAA_CNTRNO','集装箱',v.hasTask?v.containerNo:'—'),field('TAA_CSIZECD','箱型尺寸','20ft · 6.058 × 2.438 × 2.591m'),field('TAA_CSTATUSCD','货物状态',v.cargoStatus),field('','实时速度',`${(v.speed*3.6).toFixed(2)} km/h`),field('','加速度',`${v.acceleration.toFixed(2)} m/s²`),field('','运动状态',v.taskStatus),field('','完成任务数',v.taskCompleted),field('','历史轨迹采样记录',this.runtime.getHistoryRecords(hit.index,3600).length),field('','车辆避让',v.waitingForTraffic?'安全停车让行':'正常'),field('TAA_FREE_PB_ID','缓冲区待命位',v.parkingSlotId,'GIS'),field('','电量',`${v.battery.toFixed(0)} %`),field('TAA_MILEAGE','GIS 局部位置',position(v),'GIS'),field('','路线性质',v.routeId.startsWith('SYN-')?'合成岸桥连接：只验证堆场边界，车道仍待核实':this.trafficVerified.has(v.id)?'原路线通过局部几何验证':'模拟路线，尚未经道路安全验证')]);
            this.inspector.showTrack(this.runtime.getHistoryRecords(hit.index,3600));
        }else if(hit.kind==='QC'){
            const q=this.portLayout.quayCranes[hit.index];if(!q)return;
            const count=this.runtime.vehicles.filter(v=>v.state.berthId===`QC-${String(q.id).padStart(2,'0')}`&&v.active).length;
            this.inspector.show('QC',`QC-${String(q.id).padStart(2,'0')}`,[field('TSC_STS_ID','桥吊编号',q.id,'GIS'),field('TSC_WI_ID','关联模拟作业数量',count),field('TSC_CNTRNO','当前箱号','无真实记录'),field('TSC_CSIZECD','模拟箱型','ISO 20ft'),field('TSC_WK_STTIME','真实开始时间','未提供 CSV'),field('','模型朝向','基于 GIS 的 90° 修正'),field('','GIS 位置',position(q.position),'GIS')]);
        }else if(hit.kind==='ASC'){
            const yard=this.portLayout.yards[hit.index];if(!yard)return;
            const current=this.runtime.vehicles.find(v=>v.state.yardId===yard.id&&v.state.cargoTransferKind==='AGV_TO_YARD');
            this.inspector.show('ASC',`ASC-${yard.id}`,[field('TAC_ASC_ID','轨道吊编号',`ASC-${yard.id}`),field('TAC_AREANO','堆区',yard.name,'GIS'),field('TAC_SIDETYPE','设备接箱方式','AGV 直取交接（非地面卸箱）'),field('TAC_FROMLOC','直取交接位',position(yard.unload),'GIS'),field('TAC_TOLOC','目标箱位',current?position({x:current.state.yardX,y:current.state.yardY}):'当前无箱'),field('TAC_CNTRNO','正在搬运的箱',current?.state.containerNo??'无'),field('','轨道吊行走位置',position(this.movingGantryPosition(hit.index)),'GIS'),field('','交接几何核验',yard.handoffReachable?'模拟几何检查通过':'待真实轨道/交接线校准')]);
        }else if(hit.yardIndex!==undefined && hit.containerIndex!==undefined){
            const yard=this.portLayout.yards[hit.yardIndex],c=yard.containers[hit.containerIndex];if(!c)return;
            const occupied=Math.max(0,Math.min(5,c.level));
            const layer=hit.layer??occupied;
            const serial=`${c.id}-L${String(layer).padStart(2,'0')}`;
            this.inspector.show('CONTAINER',serial,[field('TSC_CNTRNO','模拟箱号',serial),field('TSC_YLOCATION','堆区',yard.id,'GIS'),field('TSC_CSIZECD','ISO 规格','20ft'),field('','标准长 × 宽 × 高','6.058 × 2.438 × 2.591 m'),field('','所点选的层',`${layer} / ${occupied}`),field('','最大允许层数',5),field('','堆垛总高度',`${(occupied*2.591).toFixed(3)} m`),field('TSC_CSTATUSCD','状态','模拟在场'),field('TAC_ASC_ID','服务轨道吊',`ASC-${yard.id}`),field('','平面箱位',position(c.center),'GIS')]);
        }
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
