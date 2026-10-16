import { BaiduMap } from "../map/BaiduMap";
import { PortOperationsService } from "../application/port/PortOperationsService";
import { SimulatedTOSAdapter } from "../infrastructure/tos/SimulatedTOSAdapter";
import { RemotePortOperationsAdapter } from "../infrastructure/tos/RemotePortOperationsAdapter";
import { CargoOperationsPanel } from "../presentation/port/CargoOperationsPanel";
import { CargoMapProjection } from "../presentation/port/CargoMapProjection";
import { SpatialEngine } from "../engine/SpatialEngine";
import { FPSMonitor } from "../../performance/FPSMonitor";
import { StreamingBenchmark, type BenchmarkSize } from "../../performance/StreamingBenchmark";

export interface PortApplicationOptions {
    container: string;
    longitude: number;
    latitude: number;
    zoom: number;
}

export class PortApplication {

    private map: BaiduMap;
    private engine: SpatialEngine;
    private fps: FPSMonitor;
    private benchmark: StreamingBenchmark;
    private portService: PortOperationsService;
    private cargoPanel: CargoOperationsPanel | null = null;
    private cargoProjection: CargoMapProjection | null = null;
    private cargoAbort = new AbortController();
    private cameraUnsubscribe: (() => void) | null = null;
    private monitoringTimer: number | null = null;

    constructor(
        private readonly options: PortApplicationOptions
    ) {
        this.map = new BaiduMap({
            container: options.container,
            center: {
                lng: options.longitude,
                lat: options.latitude
            },
            zoom: options.zoom
        });

        this.engine = new SpatialEngine({
            map: this.map,
            origin: {
                longitude: options.longitude,
                latitude: options.latitude,
                height: 0
            },
            tileSize: 5000,
            baseZoom: 12,
            maxTileLevel: 1
        });

        this.fps = new FPSMonitor();
        // Explicit configuration selects the source; remote errors NEVER turn into synthetic confirmations.
        const eventUrl = (window as Window & { __APP_CONFIG__?: { portEventUrl?: string } }).__APP_CONFIG__?.portEventUrl;
        this.portService = new PortOperationsService(eventUrl
            ? new RemotePortOperationsAdapter(eventUrl)
            : new SimulatedTOSAdapter());

        this.benchmark = new StreamingBenchmark(
            {
                beginBenchmark: size => this.engine.beginBenchmark(size),
                appendBenchmarkChunk: (positions, colors, primitives, objects) =>
                    this.engine.appendBenchmarkChunk(positions, colors, primitives, objects),
                endBenchmark: () => this.engine.endBenchmark(),
                redraw: () => this.engine.redraw(),
                getBenchmarkGpuTimeMs: () =>
                    this.engine.getBenchmarkGpuTimeMs(),
                getBenchmarkStats: () => this.engine.getBenchmarkStats()
            },
            progress => this.updateBenchmarkProgress(progress),
            result => this.updateBenchmarkResult(result)
        );
    }

    async initialize(): Promise<void> {
        this.map.initialize(
            this.options.longitude,
            this.options.latitude,
            this.options.zoom
        );

        // UI 与 AGV 信息先启动；空间 Tile 网络出现问题时也不能把整个 Demo 变成空白页。
        // The old trajectory HUD has been replaced by the clickable fleet browser.
        this.installStreamingBenchmarkDevAPI();
        this.startMonitoring();
        // Port lifecycle is a scenario plug-in, not an engine dependency.
        if (new URLSearchParams(window.location.search).get("business") === "1") {
            await this.initializeCargoLifecycle();
        } else {
            document.getElementById("cargo-operations")?.remove();
        }

        this.cameraUnsubscribe = this.map.onCameraChanged(() => {
            void this.engine.cameraChanged().catch(error => {
                console.warn("Spatial tile update skipped:", error);
            });
        });

        try {
            await this.engine.initialize();
        } catch (error) {
            console.error("Spatial engine initialization failed; AGV overlay remains active:", error);
        }
    }

    /**
     * Benchmark UI is intentionally removed from the production scene.
     * The streaming benchmark remains a real code path and can be triggered from DevTools:
     *   await window.__YANGSHAN_STREAMING_BENCHMARK__.run(100000)
     *   await window.__YANGSHAN_STREAMING_BENCHMARK__.runAll()
     * This keeps the competition proof in code without occupying the map viewport.
     */
    private installStreamingBenchmarkDevAPI(): void {
        const api = {
            run: (size: BenchmarkSize) => this.benchmark.run(size),
            runAll: () => this.benchmark.runAll(),
            runAB: (size: BenchmarkSize) => this.benchmark.runAB(size),
            results: () => this.benchmark.getResults()
        };
        (window as any).__YANGSHAN_STREAMING_BENCHMARK__ = api;
        (window as any).__YANGSHAN_ENGINE_METRICS__ = () => ({
            engine: this.engine.getStats(),
            benchmark: this.engine.getBenchmarkStats(),
            fps: this.fps.getFPS()
        });
    }

    private updateBenchmarkProgress(progress: {
        size: number;
        loaded: number;
        chunks: number;
        phase: "idle" | "loading" | "interaction" | "done";
    }): void {
        // No production HUD is updated here. The benchmark is intentionally code-only;
        // progress remains observable from the returned BenchmarkResult and console.
        if (progress.phase === "done") {
            console.info(`[StreamingBenchmark] ${progress.size.toLocaleString()} objects, ${progress.chunks} chunks`);
        }
    }

    private updateBenchmarkResult(result: {
        datasetSize: number;
        firstRenderMs: number;
        loadTimeMs: number;
        loadingFPS: number;
        interactionFPS: number;
        minFPS: number;
        p1FPS: number;
        receivedMB: number;
        chunks: number;
        objectsPerSecond: number;
        cpuMainThreadPct: number;
        gpuTimeMs: number;
        memoryMB: number | null;
        mode?: "streaming" | "monolithic";
        render?: { drawCalls: number; bufferUploadMs: number; bufferBytes: number; gpuTimeMs: number; pointObjects: number; lineObjects: number; polygonObjects: number };
    }): void {
        console.info("[StreamingBenchmark] result", result);
    }

    private startMonitoring(): void {
        this.fps.start();

        const heartbeat = document.getElementById("uiHeartbeat");
        if (heartbeat) heartbeat.textContent = "RUNNING";

        this.monitoringTimer = window.setInterval(() => {
            const stats = this.engine.getStats();

            this.setText(
                "webgpu",
                stats.webgpu ? "enabled" : "fallback"
            );
            this.setText("lod", String(stats.level));
            this.setText("tiles", String(stats.visibleTiles));
            this.setText("cache", String(stats.cachedTiles));
            this.setText("worker", String(stats.workerTasks));
            this.setText(
                "tasks",
                `${stats.activeTasks} active / ${stats.pendingTasks} pending`
            );
            this.setText(
                "points",
                stats.points.toLocaleString()
            );
            this.setText(
                "bytes",
                `${(stats.bytesFetched / 1024).toFixed(1)} KB`
            );

            const fleet = stats.agvFleet;
            this.setText("agvTotal", String(fleet.total));
            this.setText("agvMoving", String(fleet.moving));
            this.setText("agvAssigned", String(fleet.active));
            this.setText("agvParking", String(fleet.parking));
            this.setText("agvCharging", String(fleet.charging));
            this.setText("agvBattery", `${fleet.avgBattery.toFixed(0)}%`);
            this.setText(
                "agvRuntime",
                fleet.loaded
                    ? "RUNNING"
                    : (fleet.error ? "ERROR" : "LOADING")
            );
            this.setText(
                "agvModel",
                fleet.modelLoaded
                    ? "GLB READY"
                    : (fleet.modelError ? `GLB ERROR: ${fleet.modelError}` : "GLB LOADING")
            );

            const agvElement =
                document.getElementById("agv");

            if (agvElement && stats.agv) {
                agvElement.textContent =
                    `${stats.agv.id} · ${stats.agv.longitude.toFixed(6)}, ${stats.agv.latitude.toFixed(6)} · ${stats.agv.speed.toFixed(1)} m/s`;
            }
            this.setText("agvTask", stats.agv?.taskId ?? "N/A");
            this.setText("agvContainer", stats.agv?.containerNo ?? "N/A");

            const fpsElement =
                document.getElementById("fps");

            if (fpsElement) {
                fpsElement.textContent =
                    String(Math.round(this.fps.getFPS()));
            }
        }, 500);
    }


    private async initializeCargoLifecycle(): Promise<void> {
        const element = document.getElementById("cargo-operations");
        const container = document.getElementById("map_container");
        if (!element || !container) return;
        this.cargoPanel = new CargoOperationsPanel(element, this.portService);
        this.cargoPanel.initialize();
        try {
            this.cargoProjection = new CargoMapProjection(this.map.getMap(), container);
            const projection = this.cargoProjection;
            this.cargoPanel.onFocus(job => projection.focus(job));
            void projection.load(this.cargoAbort.signal).catch(error => console.warn("Cargo GIS projection disabled", error));
            await this.portService.initialize();
        } catch (error) {
            element.setAttribute("data-error", "true");
            console.error("Cargo lifecycle service failed to initialize:", error);
            const message = document.getElementById("cargo-error");
            if (message) message.textContent = `业务链路初始化失败：${String(error)}`;
        }
    }

    destroy(): void {
        this.cargoAbort.abort();
        this.cargoPanel?.destroy();
        this.cargoProjection?.destroy();
        this.portService.destroy();
        this.engine.destroy();
        this.cameraUnsubscribe?.();
        if (this.monitoringTimer !== null) clearInterval(this.monitoringTimer);
        this.fps.stop();
    }

    private setText(
        id: string,
        value: string
    ): void {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    }
}
