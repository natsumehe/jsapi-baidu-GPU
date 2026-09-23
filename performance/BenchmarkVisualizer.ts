export interface BenchmarkVisualProgress {
    size: number;
    loaded: number;
    chunks: number;
    phase: string;
    loadingFPS?: number;
    interactionFPS?: number;
    ttfrMs?: number;
}

export class BenchmarkVisualizer {
    private readonly canvas: HTMLCanvasElement | null;
    private readonly ctx: CanvasRenderingContext2D | null;
    private readonly points: Array<{ x: number; y: number }> = [];
    private readonly fpsHistory: number[] = [];
    private loaded = 0;
    private total = 0;
    private phase = "IDLE";
    private chunks = 0;
    private ttfr = 0;

    constructor(canvasId = "benchmarkCanvas") {
        this.canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
        this.ctx = this.canvas?.getContext("2d") ?? null;
        this.resize();
        window.addEventListener("resize", () => this.resize());
    }

    appendChunk(positions: Float32Array): void {
        // Visual preview samples every Nth point; the benchmark itself still uploads all points.
        const count = Math.floor(positions.length / 3);
        const stride = Math.max(1, Math.floor(count / 180));
        for (let i = 0; i < count; i += stride) {
            this.points.push({
                x: positions[i * 3],
                y: positions[i * 3 + 1]
            });
        }
        if (this.points.length > 1600) {
            this.points.splice(0, this.points.length - 1600);
        }
        this.draw();
    }

    update(progress: BenchmarkVisualProgress): void {
        this.loaded = progress.loaded;
        this.total = progress.size;
        this.phase = progress.phase.toUpperCase();
        this.chunks = progress.chunks;
        if (progress.ttfrMs !== undefined && progress.ttfrMs > 0) this.ttfr = progress.ttfrMs;

        const fps = progress.loadingFPS ?? progress.interactionFPS;
        if (fps !== undefined && Number.isFinite(fps)) {
            this.fpsHistory.push(fps);
            if (this.fpsHistory.length > 90) this.fpsHistory.shift();
        }
        this.draw();
    }

    reset(size: number): void {
        this.points.length = 0;
        this.fpsHistory.length = 0;
        this.loaded = 0;
        this.total = size;
        this.phase = "LOADING";
        this.chunks = 0;
        this.ttfr = 0;
        this.draw();
    }

    private resize(): void {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
        this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
        this.draw();
    }

    private draw(): void {
        if (!this.canvas || !this.ctx) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = this.canvas.width / dpr;
        const h = this.canvas.height / dpr;
        const ctx = this.ctx;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        ctx.fillStyle = "rgba(3, 14, 26, 0.78)";
        ctx.fillRect(0, 0, w, h);

        // Left: actual streaming point preview.
        const plotW = w * 0.62;
        const plotH = h - 30;
        ctx.strokeStyle = "rgba(110, 175, 220, 0.16)";
        ctx.lineWidth = 1;
        ctx.strokeRect(8, 22, plotW - 16, plotH);

        const pct = this.total > 0 ? Math.min(1, this.loaded / this.total) : 0;
        ctx.fillStyle = "rgba(57, 235, 117, 0.72)";
        ctx.fillRect(8, 12, (plotW - 16) * pct, 4);

        if (this.points.length) {
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const p of this.points) {
                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            }
            const sx = Math.max(1, maxX - minX);
            const sy = Math.max(1, maxY - minY);
            ctx.fillStyle = "rgba(74, 181, 255, 0.78)";
            for (const p of this.points) {
                const x = 12 + ((p.x - minX) / sx) * (plotW - 24);
                const y = 28 + (1 - (p.y - minY) / sy) * (plotH - 36);
                ctx.fillRect(x, y, 1.5, 1.5);
            }
        }

        ctx.fillStyle = "#cfe6f8";
        ctx.font = "700 9px Inter, sans-serif";
        ctx.fillText(`STREAM RENDER  ${this.loaded.toLocaleString()} / ${this.total.toLocaleString()}`, 10, h - 7);

        // Right: FPS sparkline.
        const x0 = plotW + 8;
        const x1 = w - 8;
        const y0 = 22;
        const y1 = h - 30;
        ctx.strokeStyle = "rgba(110, 175, 220, 0.16)";
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

        const fps = this.fpsHistory;
        if (fps.length > 1) {
            const maxFPS = Math.max(60, ...fps);
            ctx.beginPath();
            fps.forEach((v, i) => {
                const x = x0 + (i / (fps.length - 1)) * (x1 - x0);
                const y = y1 - Math.min(1, v / maxFPS) * (y1 - y0);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.strokeStyle = "#66baff";
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        const currentFPS = fps.length ? fps[fps.length - 1] : 0;
        ctx.fillStyle = "#eaf5ff";
        ctx.font = "800 12px ui-monospace, monospace";
        ctx.fillText(`${currentFPS.toFixed(1)} FPS`, x0 + 7, y0 + 17);
        ctx.font = "700 9px ui-monospace, monospace";
        ctx.fillStyle = "#91a9c4";
        ctx.fillText(`PHASE ${this.phase}`, x0 + 7, y0 + 33);
        ctx.fillText(`CHUNKS ${this.chunks}`, x0 + 7, y0 + 48);
        ctx.fillText(`TTFR ${this.ttfr ? this.ttfr.toFixed(0) + " ms" : "—"}`, x0 + 7, y0 + 63);
    }
}
