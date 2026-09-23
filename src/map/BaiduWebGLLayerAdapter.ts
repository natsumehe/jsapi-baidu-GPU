import { CoordinateSystem, type GeoPoint } from "./CoordinateSystem";
import { PointLayer } from "../renderer/webgl/PointLayer";
import { AGVWorldOverlay } from "../renderer/webgl/AGVWorldOverlay";
import { StreamingSpatialLayer } from "../renderer/webgl/StreamingSpatialLayer";
import type { AGVState } from "../data/runtime/AGVRuntime";
import type { AGVRuntimeState } from "../data/runtime/AGVFleetRuntime";

export interface LayerData {
    positions: Float32Array;
    colors: Uint8Array;
}

export class BaiduWebGLLayerAdapter {
    private readonly map: BMapGL.Map;
    private canvas: HTMLCanvasElement | null = null;
    private gl: WebGLRenderingContext | null = null;
    private pointLayer: PointLayer | null = null;
    private benchmarkLayer: StreamingSpatialLayer | null = null;
    private benchmarkCapacity = 0;
    private agvOverlay: AGVWorldOverlay | null = null;
    private data: LayerData = { positions: new Float32Array(), colors: new Uint8Array() };
    private readonly origin: GeoPoint;
    private readonly coordinateSystem: CoordinateSystem;
    private initialized = false;
    private mapContainer: HTMLElement | null = null;
    private resizeObserver: ResizeObserver | null = null;

    constructor(map: BMapGL.Map, origin: GeoPoint = { longitude: 121.8, latitude: 29.95, height: 0 }) {
        this.map = map;
        this.origin = { ...origin };
        this.coordinateSystem = new CoordinateSystem(this.origin);
    }

    initialize(): void {
        if (this.initialized) return;
        this.mapContainer = document.getElementById("map_container");
        if (!this.mapContainer) throw new Error("Baidu map container #map_container was not found.");
        if (getComputedStyle(this.mapContainer).position === "static") this.mapContainer.style.position = "relative";

        const canvas = document.createElement("canvas");
        canvas.className = "baidu-custom-point-layer";
        Object.assign(canvas.style, {
            position: "absolute",
            left: "0",
            top: "0",
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            zIndex: "9990"
        });
        this.mapContainer.appendChild(canvas);
        this.canvas = canvas;

        const gl = canvas.getContext("webgl", { alpha: true, antialias: true, depth: false, preserveDrawingBuffer: false });
        if (!gl) {
            canvas.remove();
            this.canvas = null;
            throw new Error("Failed to create WebGL context for point overlay.");
        }
        this.gl = gl;
        this.pointLayer = new PointLayer(gl);
        // Benchmark layer 使用独立 VBO，避免影响现有 AGV / 场景数据。
        this.agvOverlay = new AGVWorldOverlay(this.map, this.origin);

        this.resizeObserver = new ResizeObserver(() => this.render());
        this.resizeObserver.observe(this.mapContainer);
        this.initialized = true;

        void this.agvOverlay.initialize(() => this.render());
        this.agvOverlay.start();
        this.render();
    }

    setAGVState(_state: Partial<AGVState>): void { this.render(); }

    getAGVState(): AGVRuntimeState | null {
        const state = this.agvOverlay?.getSelectedState();
        if (!state) return null;
        return {
            id: state.id,
            assetId: state.assetId,
            x: state.x,
            y: state.y,
            longitude: state.longitude,
            latitude: state.latitude,
            heading: state.heading,
            speed: state.speed,
            battery: state.battery,
            phase: state.phase,
            berthId: state.berthId,
            yardId: state.yardId,
            parkingSlotId: state.parkingSlotId,
            energyStationId: state.energyStationId,
            taskId: state.taskId,
            routeId: state.routeId,
            containerId: state.containerId,
            containerNo: state.containerNo,
            cargoStatus: state.cargoStatus,
            phaseProgress: state.phaseProgress,
            taskStatus: state.taskStatus,
            cycleProgress: state.cycleProgress,
            yardX: state.yardX,
            yardY: state.yardY,
            cargoX: state.cargoX,
            cargoY: state.cargoY,
            cargoVisible: state.cargoVisible,
            cargoAtYard: state.cargoAtYard,
            cargoTransferProgress: state.cargoTransferProgress,
            cargoTransferKind: state.cargoTransferKind
        };
    }

    getAGVFleetStats() {
        return this.agvOverlay?.getStats() ?? {
            total: 0, moving: 0, parking: 0, charging: 0, returnQuay: 0, yardStack: 0,
            avgBattery: 0, loaded: false, error: "not initialized", simulationRunning: false,
            simulationSpeed: 1, modelLoaded: false, modelError: null
        };
    }

    setAGVSimulationRunning(running: boolean): void { this.agvOverlay?.setRunning(running); }
    setAGVSimulationSpeed(speed: number): void { this.agvOverlay?.setSpeed(speed); }

    upload(positions: Float32Array, colors: Uint8Array): void {
        this.data = { positions: new Float32Array(positions), colors: new Uint8Array(colors) };
        this.render();
    }

    clear(): void {
        this.data = { positions: new Float32Array(), colors: new Uint8Array() };
        this.render();
    }

    getOrigin(): GeoPoint { return { ...this.origin }; }
    getPointCount(): number { return Math.floor(this.data.positions.length / 3); }
    redraw(): void { this.render(); }

    destroy(): void {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.pointLayer?.destroy();
        this.pointLayer = null;
        this.benchmarkLayer?.destroy();
        this.benchmarkLayer = null;
        this.benchmarkCapacity = 0;
        this.agvOverlay?.destroy();
        this.agvOverlay = null;
        this.canvas?.remove();
        this.canvas = null;
        this.gl = null;
        this.mapContainer = null;
        this.initialized = false;
    }

    private render(): void {
        if (!this.initialized || !this.canvas || !this.gl || !this.pointLayer) return;
        this.resizeCanvas();
        const gl = this.gl;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        const clipPositions = this.projectToClipSpace();
        if (this.data.positions.length > 0) {
            this.pointLayer.upload(clipPositions, this.data.colors);
            this.pointLayer.render();
        }

        // 流式 benchmark 数据独立绘制；AGV/道路/分区保持原样。
        this.benchmarkLayer?.render();
    }

    beginBenchmark(capacity: number): void {
        if (!this.gl) throw new Error("WebGL layer is not initialized.");

        if (!this.benchmarkLayer || this.benchmarkCapacity !== capacity) {
            this.benchmarkLayer?.destroy();
            this.benchmarkLayer = new StreamingSpatialLayer(this.gl, capacity);
            this.benchmarkCapacity = capacity;
        }

        this.benchmarkLayer.allocate();
        this.render();
    }

    appendBenchmarkChunk(
        positions: Float32Array,
        colors: Uint8Array,
        primitives: Uint8Array,
        objects: number
    ): number {
        if (!this.benchmarkLayer) {
            throw new Error("Benchmark layer has not been initialized.");
        }

        const clipPositions = this.projectPositionsToClipSpace(positions);
        const accepted = this.benchmarkLayer.append(clipPositions, colors, primitives, objects);
        // The benchmark loop calls redraw() once after each chunk. Avoid a duplicate
        // full-buffer render here, which becomes expensive at 500K/1M objects.
        return accepted;
    }

    endBenchmark(): void {
        this.render();
    }

    getBenchmarkGpuTimeMs(): number {
        return this.benchmarkLayer?.getStats().gpuTimeMs ?? 0;
    }

    private projectPositionsToClipSpace(
        positions: Float32Array
    ): Float32Array {
        const count = Math.floor(positions.length / 3);
        const result = new Float32Array(count * 2);
        if (count === 0 || !this.canvas) return result;

        const center = this.map.getCenter();
        const centerPixel = this.map.pointToPixel(
            new BMapGL.Point(center.lng, center.lat)
        );
        const centerLocal = this.coordinateSystem.geoToLocal({
            longitude: center.lng,
            latitude: center.lat,
            height: 0
        });
        const eastGeo = this.coordinateSystem.localToGeo({ x: 1, y: 0, z: 0 });
        const northGeo = this.coordinateSystem.localToGeo({ x: 0, y: 1, z: 0 });
        const eastPixel = this.map.pointToPixel(
            new BMapGL.Point(eastGeo.longitude, eastGeo.latitude)
        );
        const northPixel = this.map.pointToPixel(
            new BMapGL.Point(northGeo.longitude, northGeo.latitude)
        );
        const ex = eastPixel.x - centerPixel.x;
        const ey = eastPixel.y - centerPixel.y;
        const nx = northPixel.x - centerPixel.x;
        const ny = northPixel.y - centerPixel.y;
        const w = Math.max(1, this.canvas.clientWidth);
        const h = Math.max(1, this.canvas.clientHeight);

        for (let i = 0; i < count; i++) {
            const x = positions[i * 3];
            const y = positions[i * 3 + 1];
            const dx = x - centerLocal.x;
            const dy = y - centerLocal.y;
            const px = w / 2 + dx * ex + dy * nx;
            const py = h / 2 + dx * ey + dy * ny;
            result[i * 2] = px / w * 2 - 1;
            result[i * 2 + 1] = 1 - py / h * 2;
        }
        return result;
    }

    private resizeCanvas(): void {
        if (!this.canvas || !this.mapContainer) return;
        const width = Math.max(1, this.mapContainer.clientWidth);
        const height = Math.max(1, this.mapContainer.clientHeight);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.max(1, Math.floor(width * dpr));
        this.canvas.height = Math.max(1, Math.floor(height * dpr));
    }

    private projectToClipSpace(): Float32Array {
        const count = Math.floor(this.data.positions.length / 3);
        const result = new Float32Array(count * 2);
        if (count === 0 || !this.canvas) return result;

        const center = this.map.getCenter();
        const centerPixel = this.map.pointToPixel(new BMapGL.Point(center.lng, center.lat));
        const centerLocal = this.coordinateSystem.geoToLocal({ longitude: center.lng, latitude: center.lat, height: 0 });
        const eastGeo = this.coordinateSystem.localToGeo({ x: 1, y: 0, z: 0 });
        const northGeo = this.coordinateSystem.localToGeo({ x: 0, y: 1, z: 0 });
        const eastPixel = this.map.pointToPixel(new BMapGL.Point(eastGeo.longitude, eastGeo.latitude));
        const northPixel = this.map.pointToPixel(new BMapGL.Point(northGeo.longitude, northGeo.latitude));
        const ex = eastPixel.x - centerPixel.x;
        const ey = eastPixel.y - centerPixel.y;
        const nx = northPixel.x - centerPixel.x;
        const ny = northPixel.y - centerPixel.y;
        const w = Math.max(1, this.canvas.clientWidth);
        const h = Math.max(1, this.canvas.clientHeight);

        for (let i = 0; i < count; i++) {
            const x = this.data.positions[i * 3];
            const y = this.data.positions[i * 3 + 1];
            const dx = x - centerLocal.x;
            const dy = y - centerLocal.y;
            const px = w / 2 + dx * ex + dy * nx;
            const py = h / 2 + dx * ey + dy * ny;
            result[i * 2] = px / w * 2 - 1;
            result[i * 2 + 1] = 1 - py / h * 2;
        }
        return result;
    }
}
