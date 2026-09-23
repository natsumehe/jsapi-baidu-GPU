import { BaiduMap } from "../map/BaiduMap";
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

        this.benchmark = new StreamingBenchmark(
            {
                beginBenchmark: size => this.engine.beginBenchmark(size),
                appendBenchmarkChunk: (positions, colors, primitives, objects) =>
                    this.engine.appendBenchmarkChunk(positions, colors, primitives, objects),
                endBenchmark: () => this.engine.endBenchmark(),
                redraw: () => this.engine.redraw(),
                getBenchmarkGpuTimeMs: () =>
                    this.engine.getBenchmarkGpuTimeMs()
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
        this.bindAGVTrajectoryPanel();
        this.installStreamingBenchmarkDevAPI();
        this.startMonitoring();

        this.map.onCameraChanged(() => {
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
            results: () => this.benchmark.getResults()
        };
        (window as any).__YANGSHAN_STREAMING_BENCHMARK__ = api;
    }

    private bindAGVTrajectoryPanel(): void {
        const panel = document.getElementById("agv-trajectory-panel");
        const open = document.getElementById("agv-trajectory-toggle");
        const close = document.getElementById("agv-trajectory-close");
        if (!panel || !open) return;

        const setOpen = (value: boolean) => {
            panel.classList.toggle("open", value);
            panel.setAttribute("aria-hidden", value ? "false" : "true");
        };
        open.addEventListener("click", () => setOpen(!panel.classList.contains("open")));
        close?.addEventListener("click", () => setOpen(false));
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
    }): void {
        console.info("[StreamingBenchmark] result", result);
    }

    private startMonitoring(): void {
        this.fps.start();

        const heartbeat = document.getElementById("uiHeartbeat");
        if (heartbeat) heartbeat.textContent = "RUNNING";

        window.setInterval(() => {
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
