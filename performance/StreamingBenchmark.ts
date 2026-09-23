export type BenchmarkSize = 10_000 | 100_000 | 500_000 | 1_000_000;

export interface BenchmarkResult {
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
}

export interface BenchmarkSink {
    beginBenchmark(size: number): void;
    appendBenchmarkChunk(
        positions: Float32Array,
        colors: Uint8Array,
        primitives: Uint8Array,
        objects: number
    ): number;
    endBenchmark(): void;
    redraw(): void;
    getBenchmarkGpuTimeMs?: () => number;
}

interface WorkerChunk {
    type: "generated";
    start: number;
    count: number;
    positions: ArrayBuffer;
    colors: ArrayBuffer;
    primitives: ArrayBuffer;
}

const SIZES: BenchmarkSize[] = [10_000, 100_000, 500_000, 1_000_000];

export class StreamingBenchmark {
    private readonly worker = new Worker(
        new URL("../src/worker/benchmark.worker.ts", import.meta.url),
        { type: "module" }
    );

    private readonly loadingFrameSamples: number[] = [];
    private readonly interactionFrameSamples: number[] = [];
    private benchmarkPhase: "loading" | "interaction" | "done" = "loading";
    private running = false;
    private activeSize = 0;
    private chunkSize = 10_000;
    private chunkIndex = 0;
    private startedAt = 0;
    private firstRenderAt = 0;
    private loadingEndedAt = 0;
    private receivedBytes = 0;
    private cpuBusyMs = 0;
    private lastFrameAt = 0;
    private frameRaf = 0;
    private workerResolve: ((chunk: WorkerChunk) => void) | null = null;

    private results = new Map<number, BenchmarkResult>();

    constructor(
        private readonly sink: BenchmarkSink,
        private readonly onProgress: (progress: {
            size: number;
            loaded: number;
            chunks: number;
            phase: "idle" | "loading" | "interaction" | "done";
        }) => void,
        private readonly onResult: (result: BenchmarkResult) => void,
        private readonly onVisualChunk?: (positions: Float32Array, progress: {
            size: number; loaded: number; chunks: number;
        }) => void
    ) {
        this.worker.onmessage = (event: MessageEvent<WorkerChunk>) => {
            this.workerResolve?.(event.data);
            this.workerResolve = null;
        };
    }

    async run(size: BenchmarkSize): Promise<BenchmarkResult> {
        if (this.running) {
            throw new Error("Benchmark is already running.");
        }

        this.running = true;
        this.activeSize = size;
        this.chunkIndex = 0;
        this.startedAt = performance.now();
        this.firstRenderAt = 0;
        this.loadingEndedAt = 0;
        this.receivedBytes = 0;
        this.cpuBusyMs = 0;
        this.loadingFrameSamples.length = 0;
        this.interactionFrameSamples.length = 0;
        this.benchmarkPhase = "loading";

        this.sink.beginBenchmark(size);
        this.startFrameProbe();
        this.onProgress({
            size,
            loaded: 0,
            chunks: 0,
            phase: "loading"
        });

        try {
            for (let start = 0; start < size; start += this.chunkSize) {
                const count = Math.min(this.chunkSize, size - start);
                const before = performance.now();

                const chunk = await this.generate(start, count, size);

                // worker -> main -> GPU upload. Each chunk yields back to requestAnimationFrame below,
                // so large datasets remain incrementally visible instead of blocking the browser.
                this.receivedBytes +=
                    chunk.positions.byteLength +
                    chunk.colors.byteLength +
                    chunk.primitives.byteLength;

                const positions = new Float32Array(chunk.positions);
                const colors = new Uint8Array(chunk.colors);
                const primitives = new Uint8Array(chunk.primitives);
                const accepted = this.sink.appendBenchmarkChunk(positions, colors, primitives, count);
                this.onVisualChunk?.(positions, {
                    size,
                    loaded: Math.min(size, start + count),
                    chunks: this.chunkIndex + 1
                });

                const after = performance.now();
                this.cpuBusyMs += after - before;

                if (!this.firstRenderAt && accepted > 0) {
                    this.firstRenderAt = after;
                }

                this.chunkIndex++;
                this.onProgress({
                    size,
                    loaded: Math.min(size, start + count),
                    chunks: this.chunkIndex,
                    phase: "loading"
                });

                this.sink.redraw();

                // 让浏览器完成一次绘制/合成，使“边解析边显示”可观察。
                await this.nextFrame();
            }

            this.loadingEndedAt = performance.now();
            this.benchmarkPhase = "interaction";
            this.onProgress({
                size,
                loaded: size,
                chunks: this.chunkIndex,
                phase: "interaction"
            });

            // 固定 2 秒交互采样窗口。
            const interactionStart = performance.now();
            while (performance.now() - interactionStart < 2000) {
                await this.nextFrame();
            }

            const result = this.buildResult();
            this.results.set(size, result);
            this.onResult(result);
            this.onProgress({
                size,
                loaded: size,
                chunks: this.chunkIndex,
                phase: "done"
            });
            return result;
        } finally {
            this.stopFrameProbe();
            this.sink.endBenchmark();
            this.running = false;
        }
    }

    async runAll(): Promise<BenchmarkResult[]> {
        const results: BenchmarkResult[] = [];
        for (const size of SIZES) {
            results.push(await this.run(size));
        }
        return results;
    }

    getResults(): BenchmarkResult[] {
        return SIZES
            .map(size => this.results.get(size))
            .filter((value): value is BenchmarkResult => Boolean(value));
    }

    destroy(): void {
        this.stopFrameProbe();
        this.worker.terminate();
    }

    private generate(
        start: number,
        count: number,
        total: number
    ): Promise<WorkerChunk> {
        return new Promise(resolve => {
            this.workerResolve = resolve;
            this.worker.postMessage({
                type: "generate",
                start,
                count,
                total,
                seed: 20260918,
                extent: {
                    minX: -3200,
                    maxX: 3200,
                    minY: -1500,
                    maxY: 1500
                }
            });
        });
    }

    private startFrameProbe(): void {
        this.lastFrameAt = performance.now();

        const tick = (now: number) => {
            const dt = now - this.lastFrameAt;
            this.lastFrameAt = now;

            if (dt > 0 && dt < 1000) {
                if (this.benchmarkPhase === "loading") {
                    this.loadingFrameSamples.push(dt);
                } else if (this.benchmarkPhase === "interaction") {
                    this.interactionFrameSamples.push(dt);
                }
                // 以 16.67ms 为 60FPS 基线，作为“主线程帧时间压力”代理。
                this.cpuBusyMs += Math.min(dt, 50);
            }

            this.frameRaf = requestAnimationFrame(tick);
        };

        this.frameRaf = requestAnimationFrame(tick);
    }

    private stopFrameProbe(): void {
        if (this.frameRaf) {
            cancelAnimationFrame(this.frameRaf);
            this.frameRaf = 0;
        }
    }

    private buildResult(): BenchmarkResult {
        const loadDuration =
            Math.max(0.001, this.loadingEndedAt - this.startedAt);

        const loadingFPSValues = this.loadingFrameSamples.map(dt => 1000 / dt);
        const interactionFPSValues = this.interactionFrameSamples.map(dt => 1000 / dt);
        const fps = loadingFPSValues;
        const sorted = [...fps].sort((a, b) => a - b);
        const minFPS = sorted.length ? sorted[0] : 0;
        const p1Index = Math.min(
            sorted.length - 1,
            Math.floor(sorted.length * 0.01)
        );
        const p1FPS = sorted.length ? sorted[p1Index] : 0;
        const avgFPS = fps.length
            ? fps.reduce((a, b) => a + b, 0) / fps.length
            : 0;
        const interactionFPS = interactionFPSValues.length
            ? interactionFPSValues.reduce((a, b) => a + b, 0) / interactionFPSValues.length
            : 0;

        // 浏览器无法可靠获得系统级 CPU/GPU 百分比。
        // 这里输出“主线程帧时间压力代理”和 GPU timer 时间。
        const cpuMainThreadPct = Math.min(
            100,
            Math.max(0, this.cpuBusyMs / loadDuration * 100)
        );

        const memoryMB =
            "memory" in performance
                ? ((performance as Performance & {
                    memory?: { usedJSHeapSize: number }
                }).memory?.usedJSHeapSize ?? 0) / 1024 / 1024
                : null;

        return {
            datasetSize: this.activeSize,
            firstRenderMs: Math.max(
                0,
                (this.firstRenderAt || this.loadingEndedAt) - this.startedAt
            ),
            loadTimeMs: this.loadingEndedAt - this.startedAt,
            loadingFPS: avgFPS,
            interactionFPS,
            minFPS,
            p1FPS,
            receivedMB: this.receivedBytes / 1024 / 1024,
            chunks: this.chunkIndex,
            objectsPerSecond: this.activeSize / (loadDuration / 1000),
            cpuMainThreadPct,
            gpuTimeMs: this.getGpuTime(),
            memoryMB
        };
    }

    private getGpuTime(): number {
        const layer = this.sink as BenchmarkSink & {
            getBenchmarkGpuTimeMs?: () => number;
        };
        return layer.getBenchmarkGpuTimeMs?.() ?? 0;
    }

    private nextFrame(): Promise<void> {
        return new Promise(resolve => {
            requestAnimationFrame(() => resolve());
        });
    }
}
