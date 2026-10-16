import { TOSAGVTaskSource } from "../../data/source/TOSAGVTaskSource";
import { EquipmentDispatcher } from "../../application/port/EquipmentDispatcher";
import type { CargoJob } from "../../domain/cargo/CargoLifecycle";
import type { PortOperationsAdapter, PortOperationsSink } from "./PortOperationsAdapter";

export class SimulatedTOSAdapter implements PortOperationsAdapter {
    readonly mode = "simulation" as const;
    private dispatcher: EquipmentDispatcher | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private running = true;
    private speed = 1;
    private inTick = false;
    private signal: AbortSignal | null = null;
    private sink: PortOperationsSink | null = null;
    constructor(private readonly source = new TOSAGVTaskSource()) {}
    async connect(sink: PortOperationsSink, signal: AbortSignal): Promise<void> {
        this.disconnect();
        this.signal = signal;
        this.sink = sink;
        const rows = await this.source.load(signal);
        if (signal.aborted) return;
        // Preserve traceability to the supplied (synthetic) TOS rows; select unique AGVs.
        const uniqueAGV = new Set<string>();
        const jobs: CargoJob[] = [];
        for (const row of rows) {
            const agvId = row.TAA_AGV_ID?.trim(), containerNo = (row.TAA_CNTRNO || row.TAA_CNTRID)?.trim();
            if (!agvId || !containerNo || uniqueAGV.has(agvId)) continue;
            uniqueAGV.add(agvId);
            jobs.push({
                id: row.TAA_ID || `TOS-${jobs.length + 1}`, containerNo, agvId,
                craneId: `QC-${String((jobs.length % 3) + 1).padStart(2, "0")}`,
                yardId: `YARD-${String((jobs.length % 4) + 1).padStart(2, "0")}`,
                vesselId: row.TAA_VOY_ID || "DEMO-VESSEL", synthetic: true
            });
            if (jobs.length === 24) break;
        }
        if (!jobs.length) throw new Error("No valid import discharge work orders in TOS data");
        this.dispatcher = new EquipmentDispatcher(event => sink.accept(event));
        this.dispatcher.load(jobs);
        sink.register(jobs);
        this.startLoop();
        signal.addEventListener("abort", () => this.disconnect(), { once: true });
    }
    private startLoop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => {
            if (this.signal?.aborted) { this.disconnect(); return; }
            if (!this.running || this.inTick) return;
            this.inTick = true;
            try { this.dispatcher?.tick(); }
            catch (error) { this.sink?.reportError(String(error)); }
            finally { this.inTick = false; }
        }, 900 / this.speed);
    }
    setRunning(running: boolean): void { this.running = running; }
    setSpeed(speed: number): void {
        this.speed = Math.max(0.5, Math.min(4, speed));
        if (this.timer) {
            this.startLoop();
        }
    }
    getDispatchStats(): Record<string, number> { return this.dispatcher?.getStats() ?? {}; }
    disconnect(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
