import { BaiduMap } from "../map/BaiduMap";
import { BaiduWebGLLayerAdapter } from "../map/BaiduWebGLLayerAdapter";
import { WorkerPool } from "../worker/WorkerPool";
import { WebGPUCompute } from "../renderer/webgpu/WebGPUCompute";
import { DataPipeline, type PipelineTile } from "../data/pipeline/DataPipeline";
import { DataFormatMiddleware } from "../data/format/DataFormatMiddleware";
import { PortPointFormatAdapter } from "../data/format/PortPointFormat";
import { SpatialTileSelector } from "../spatial/SpatialTileSelector";
import type { GeoPoint } from "../map/CoordinateSystem";
import type { AGVRuntimeState } from "../data/runtime/AGVFleetRuntime";

export interface SpatialEngineOptions {
    map: BaiduMap;
    origin?: GeoPoint;
    tileUrlTemplate?: string;
    tileSize?: number;
    baseZoom?: number;
    maxTileLevel?: number;
}

export interface SpatialEngineStats {
    webgpu: boolean;
    visibleTiles: number;
    cachedTiles: number;
    pendingTasks: number;
    activeTasks: number;
    workerTasks: number;
    points: number;
    bytesFetched: number;
    level: number;
    agv: AGVRuntimeState | null;
    agvFleet: {
        total: number;
        moving: number;
        parking: number;
        charging: number;
        returnQuay: number;
        yardStack: number;
        avgBattery: number;
        loaded: boolean;
        error: string | null;
        simulationRunning: boolean;
        simulationSpeed: number;
        modelLoaded: boolean;
        modelError: string | null;
    };
}

/**
 * 空间运行时 Facade。
 *
 * 注意这里不再直接承担：
 * - HTTP
 * - Worker 调度
 * - 业务格式解析
 *
 * SpatialEngine 负责把 Spatial World 的状态串起来，
 * 各中间件负责自己的职责。
 */
export class SpatialEngine {

    private readonly workers: WorkerPool;
    private readonly pipeline: DataPipeline;
    private readonly webgpu: WebGPUCompute;
    private readonly baiduLayer: BaiduWebGLLayerAdapter;
    private readonly selector: SpatialTileSelector;

    private readonly runtimeCache =
        new Map<string, PipelineTile>();

    private readonly maxCachedTiles = 24;

    private initialized = false;
    private generation = 0;
    private activeAbortController: AbortController | null = null;

    private positions = new Float32Array();
    private colors = new Uint8Array();
    private visibleTiles = 0;
    private bytesFetched = 0;
    private currentLevel = 0;

    constructor(
        private readonly options: SpatialEngineOptions
    ) {
        const workerCount =
            Math.max(
                1,
                Math.min(
                    4,
                    (navigator.hardwareConcurrency ?? 4) - 1
                )
            );

        this.workers = new WorkerPool(workerCount);

        const format = new DataFormatMiddleware();
        // 保留业务格式 Adapter 注册点。
        // 真正的二进制解码仍在 Worker/WASM 中完成，
        // 这样主线程不会因为业务格式解析而阻塞。
        format.register(new PortPointFormatAdapter());

        this.pipeline = new DataPipeline(
            this.workers,
            {
                format,
                concurrency: Math.max(1, Math.min(4, workerCount))
            }
        );

        this.webgpu = new WebGPUCompute();

        const origin =
            options.origin ?? {
                longitude: 121.8,
                latitude: 29.95,
                height: 0
            };

        this.baiduLayer =
            new BaiduWebGLLayerAdapter(
                options.map.getMap(),
                origin
            );

        this.selector =
            new SpatialTileSelector(
                options.map,
                origin,
                {
                    tileSize:
                        options.tileSize ?? 5000,
                    baseZoom:
                        options.baseZoom ?? 12,
                    maxLevel:
                        options.maxTileLevel ?? 1,
                    urlTemplate:
                        options.tileUrlTemplate ??
                        "/data/tiles/{z}/{x}/{y}.bin",
                    radius: 1,
                    minTileX: -1,
                    maxTileX: 1,
                    minTileY: -1,
                    maxTileY: 1
                }
            );
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        // The visible Baidu/WebGL scene must not depend on WebGPU initialization.
        // Initialize the map overlay first so AGV/GIS rendering is available even on
        // browsers where WebGPU is disabled or unavailable.
        this.baiduLayer.initialize();
        this.initialized = true;

        const webgpuAvailable = await this.webgpu.initialize();
        console.log(
            "WebGPU:",
            webgpuAvailable ? "enabled" : "unavailable"
        );

        // Tile loading is an enhancement for the spatial benchmark. Failures here
        // must never tear down the already-visible AGV/GIS scene.
        try {
            await this.updateVisibleData();
        } catch (error) {
            console.warn("Spatial tile initialization skipped; AGV/GIS overlay remains visible:", error);
            this.baiduLayer.redraw();
        }
    }

    async cameraChanged(): Promise<void> {
        if (!this.initialized) return;
        this.baiduLayer.redraw();
        await this.updateVisibleData();
        this.baiduLayer.redraw();
    }

    beginBenchmark(capacity: number): void {
        this.baiduLayer.beginBenchmark(capacity);
    }

    appendBenchmarkChunk(
        positions: Float32Array,
        colors: Uint8Array,
        primitives: Uint8Array,
        objects: number
    ): number {
        return this.baiduLayer.appendBenchmarkChunk(positions, colors, primitives, objects);
    }

    endBenchmark(): void {
        this.baiduLayer.endBenchmark();
    }

    getBenchmarkGpuTimeMs(): number {
        return this.baiduLayer.getBenchmarkGpuTimeMs();
    }

    redraw(): void {
        this.baiduLayer.redraw();
    }

    getPointCount(): number {
        return this.baiduLayer.getPointCount();
    }

    setAGVSimulationRunning(running: boolean): void {
        this.baiduLayer.setAGVSimulationRunning(running);
    }

    setAGVSimulationSpeed(speed: number): void {
        this.baiduLayer.setAGVSimulationSpeed(speed);
    }

    isWebGPUAvailable(): boolean {
        return this.webgpu.isAvailable();
    }

    getStats(): SpatialEngineStats {
        const pipelineStats =
            this.pipeline.getStats();

        return {
            webgpu:
                this.webgpu.isAvailable(),
            visibleTiles:
                this.visibleTiles,
            cachedTiles:
                this.runtimeCache.size,
            pendingTasks:
                pipelineStats.pendingTasks,
            activeTasks:
                pipelineStats.activeTasks,
            workerTasks:
                this.workers.getPendingCount(),
            points:
                this.getPointCount(),
            bytesFetched:
                this.bytesFetched,
            level:
                this.currentLevel,
            agv:
                this.baiduLayer.getAGVState(),
            agvFleet:
                this.baiduLayer.getAGVFleetStats()
        };
    }

    destroy(): void {
        this.generation++;
        this.activeAbortController?.abort();
        this.activeAbortController = null;

        this.baiduLayer.destroy();
        this.webgpu.destroy();
        this.workers.destroy();

        this.runtimeCache.clear();
        this.initialized = false;
    }

    private async updateVisibleData(): Promise<void> {
        const generation = ++this.generation;

        // Camera 变化后，上一轮尚未完成的 HTTP Tile 请求立即取消。
        this.activeAbortController?.abort();
        const controller = new AbortController();
        this.activeAbortController = controller;

        const requests = this.selector.select();
        this.currentLevel = this.selector.getLevel();

        try {
            // requests 已经按距离/LOD 排序；Scheduler 会继续按 priority
            // 控制真正的并发执行。这里不再逐 Tile await，从而保持流水线并行。
            const loaded = await Promise.all(
                requests.map(async request => {
                    if (generation !== this.generation) return null;

                    const cached = this.runtimeCache.get(request.id);
                    if (cached) {
                        this.runtimeCache.delete(request.id);
                        this.runtimeCache.set(request.id, cached);
                        return cached;
                    }

                    try {
                        const tile = await this.pipeline.requestTile(
                            request,
                            controller.signal
                        );

                        if (generation !== this.generation) return null;

                        this.runtimeCache.set(request.id, tile);
                        return tile;
                    } catch (error) {
                        if (
                            error instanceof DOMException &&
                            error.name === "AbortError"
                        ) {
                            return null;
                        }

                        console.warn(
                            `Tile ${request.id} unavailable.`,
                            error
                        );
                        return null;
                    }
                })
            );

            if (generation !== this.generation || controller.signal.aborted) {
                return;
            }

            const tiles = loaded.filter(
                (tile): tile is PipelineTile => tile !== null
            );

            while (this.runtimeCache.size > this.maxCachedTiles) {
                const oldest = this.runtimeCache.keys().next().value;
                if (oldest === undefined) break;
                this.runtimeCache.delete(oldest);
            }

            this.visibleTiles = tiles.length;
            this.bytesFetched = this.pipeline.getStats().bytesFetched;

            if (tiles.length === 0) {
                this.useDemoData();
                return;
            }

            this.composeRuntimeTiles(tiles);
            await this.cullAndUpload(generation);
        } finally {
            if (this.activeAbortController === controller) {
                this.activeAbortController = null;
            }
        }
    }

    private composeRuntimeTiles(
        tiles: PipelineTile[]
    ): void {
        let totalPoints = 0;
        let totalColorBytes = 0;

        for (const tile of tiles) {
            totalPoints += tile.metadata.pointCount;
            totalColorBytes += tile.colors.byteLength;
        }

        const positions =
            new Float32Array(totalPoints * 3);

        const colors =
            new Uint8Array(totalColorBytes);

        let positionOffset = 0;
        let colorOffset = 0;

        for (const tile of tiles) {
            positions.set(
                tile.positions,
                positionOffset
            );

            colors.set(
                tile.colors,
                colorOffset
            );

            positionOffset += tile.positions.length;
            colorOffset += tile.colors.length;
        }

        this.positions = positions;
        this.colors = colors;
    }

    private async cullAndUpload(
        generation: number
    ): Promise<void> {
        if (generation !== this.generation) return;

        if (!this.webgpu.isAvailable()) {
            this.baiduLayer.upload(
                this.positions,
                this.colors
            );
            return;
        }

        const bounds =
            this.options.map.getLocalViewportBounds(
                this.baiduLayer.getOrigin()
            );

        // 稍微扩展边界，避免拖动/缩放时边缘点闪烁。
        const paddingX =
            (bounds.maxX - bounds.minX) * 0.08;
        const paddingY =
            (bounds.maxY - bounds.minY) * 0.08;

        const visibility =
            await this.webgpu.cullPositions(
                this.positions,
                {
                    minX: bounds.minX - paddingX,
                    maxX: bounds.maxX + paddingX,
                    minY: bounds.minY - paddingY,
                    maxY: bounds.maxY + paddingY,
                    minZ: bounds.minZ,
                    maxZ: bounds.maxZ
                }
            );

        if (generation !== this.generation) return;

        let visibleCount = 0;
        for (const value of visibility) {
            visibleCount += value;
        }

        if (visibleCount === this.positions.length / 3) {
            this.baiduLayer.upload(
                this.positions,
                this.colors
            );
            return;
        }

        const visiblePositions =
            new Float32Array(
                visibleCount * 3
            );

        const visibleColors =
            new Uint8Array(
                visibleCount * 4
            );

        let dst = 0;

        for (
            let i = 0;
            i < visibility.length;
            i++
        ) {
            if (visibility[i] === 0) continue;

            visiblePositions[dst * 3] =
                this.positions[i * 3];

            visiblePositions[dst * 3 + 1] =
                this.positions[i * 3 + 1];

            visiblePositions[dst * 3 + 2] =
                this.positions[i * 3 + 2];

            visibleColors[dst * 4] =
                this.colors[i * 4] ?? 0;

            visibleColors[dst * 4 + 1] =
                this.colors[i * 4 + 1] ?? 0;

            visibleColors[dst * 4 + 2] =
                this.colors[i * 4 + 2] ?? 0;

            visibleColors[dst * 4 + 3] =
                this.colors[i * 4 + 3] ?? 255;

            dst++;
        }

        this.baiduLayer.upload(
            visiblePositions,
            visibleColors
        );
    }

    private useDemoData(): void {
        const count = 12000;

        const positions =
            new Float32Array(count * 3);

        const colors =
            new Uint8Array(count * 4);

        let seed = 20260904;

        const random = () => {
            seed =
                (seed * 1664525 + 1013904223) >>> 0;
            return seed / 4294967296;
        };

        for (let i = 0; i < count; i++) {
            const angle =
                random() * Math.PI * 2;

            const radius =
                Math.sqrt(random()) * 5000;

            positions[i * 3] =
                Math.cos(angle) * radius;

            positions[i * 3 + 1] =
                Math.sin(angle) * radius;

            positions[i * 3 + 2] =
                random() * 20;

            colors[i * 4] =
                40 + Math.floor(random() * 80);

            colors[i * 4 + 1] =
                150 + Math.floor(random() * 90);

            colors[i * 4 + 2] =
                190 + Math.floor(random() * 65);

            colors[i * 4 + 3] = 220;
        }

        this.positions = positions;
        this.colors = colors;

        void this.cullAndUpload(this.generation);
    }
}
