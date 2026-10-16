import type { CargoSnapshot } from "../../domain/cargo/CargoLifecycle";
import type { GISAGVRoute, GISRoutePoint } from "../../data/source/AGVGisRouteSource";

/** Read-model overlay only; GIS route anchors are illustrative, never a TOS confirmation. */
export class CargoMapProjection {
    private canvas: HTMLCanvasElement;
    private context: CanvasRenderingContext2D;
    private routes = new Map<string, GISAGVRoute>();
    private selected: CargoSnapshot | null = null;
    private readonly redraw = () => this.draw();
    private readonly events = ["moving", "moveend", "zooming", "zoomend", "resize"];
    constructor(private readonly map: BMapGL.Map, container: HTMLElement) {
        this.canvas = document.createElement("canvas");
        this.canvas.className = "cargo-gis-projection";
        Object.assign(this.canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "10015" });
        container.appendChild(this.canvas);
        const context = this.canvas.getContext("2d");
        if (!context) throw new Error("Cargo overlay canvas unavailable");
        this.context = context;
        this.events.forEach(event => this.map.addEventListener(event, this.redraw));
        window.addEventListener("resize", this.redraw);
    }
    async load(signal?: AbortSignal): Promise<void> {
        const response = await fetch("/data/simulation/yangshan_phase4/agv_routes_gis.json", { signal });
        if (!response.ok) throw new Error("Cargo GIS route anchors unavailable");
        const payload = await response.json() as { routes?: GISAGVRoute[] };
        if (!Array.isArray(payload.routes)) throw new Error("Invalid cargo route dataset");
        this.routes = new Map(payload.routes.map(route => [route.agvId, route]));
        this.draw();
    }
    focus(job: CargoSnapshot): void { this.selected = job; this.draw(); }
    destroy(): void {
        this.events.forEach(event => this.map.removeEventListener?.(event, this.redraw));
        window.removeEventListener("resize", this.redraw);
        this.canvas.remove();
    }
    private draw(): void {
        const { canvas, context: ctx } = this;
        const parent = canvas.parentElement;
        if (!parent) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.max(1, parent.clientWidth), h = Math.max(1, parent.clientHeight);
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        if (!this.selected) return;
        const route = this.routes.get(this.selected.job.agvId);
        if (!route) return;
        const quay = route.phases.find(phase => phase.phase === "QUAY_PICKUP")?.points;
        const yard = route.phases.find(phase => phase.phase === "YARD_STACK")?.points;
        const outbound = route.phases.find(phase => phase.phase === "RETURN_BUFFER")?.points;
        if (!quay?.length || !yard?.length) return;
        const first = quay[0], handoff = quay[quay.length - 1];
        const storage = yard[yard.length - 1];
        const truck = outbound?.[0] ?? storage;
        const stages = [first, first, handoff, yard[0], storage, storage, truck, truck];
        const index = Math.max(0, ["PLANNED", "QC_PICKED", "ON_AGV", "AT_YARD_TRANSFER", "IN_YARD", "PICKUP_REQUESTED", "ON_TRUCK", "GATE_OUT"].indexOf(this.selected.stage));
        const toPx = (p: GISRoutePoint) => this.map.pointToPixel(new BMapGL.Point(p.longitude, p.latitude));
        const a = toPx(first), b = toPx(storage), current = toPx(stages[index]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.strokeStyle = "rgba(255,215,86,.8)"; ctx.stroke(); ctx.setLineDash([]);
        this.pin(ctx, a.x, a.y, "QC 海侧", "#39eb75");
        this.pin(ctx, b.x, b.y, "ASC 堆场", "#57b9ff");
        ctx.beginPath(); ctx.arc(current.x, current.y, 9, 0, Math.PI * 2);
        ctx.fillStyle = "#ffbe3b"; ctx.fill(); ctx.lineWidth = 2;
        ctx.strokeStyle = "#10243d"; ctx.stroke();
        ctx.font = "bold 11px sans-serif";
        const text = `${this.selected.job.containerNo} · ${this.selected.stage}`;
        const width = ctx.measureText(text).width;
        ctx.fillStyle = "rgba(8,24,42,.93)";
        ctx.fillRect(current.x + 13, current.y - 21, width + 14, 24);
        ctx.fillStyle = "#f6faff"; ctx.fillText(text, current.x + 20, current.y - 5);
    }
    private pin(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, color: string): void {
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
        ctx.font = "bold 11px sans-serif"; ctx.fillStyle = color; ctx.fillText(label, x + 9, y + 4);
    }
}
