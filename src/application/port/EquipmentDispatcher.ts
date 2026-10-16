import { CargoRepository, type CargoEvent, type CargoEventType, type CargoJob } from "../../domain/cargo/CargoLifecycle";

/** Discrete-event demo dispatcher. Holds a resource until the relevant handoff is acknowledged. */
export class EquipmentDispatcher {
    readonly repository = new CargoRepository();
    private jobs: CargoJob[] = [];
    private ticks = new Map<string, number>();
    private qcBusy = new Set<string>();
    private agvBusy = new Set<string>();
    private ascBusy = new Set<string>();
    private truckBusy = new Set<string>();
    private serial = 0;
    constructor(private readonly emit: (event: CargoEvent) => void, private readonly maxActiveJobs = 6) {}

    load(jobs: CargoJob[]): void {
        this.jobs = jobs.map(job => ({ ...job }));
        for (const job of this.jobs) { this.repository.register(job); this.ticks.set(job.id, 0); }
    }
    /** The scheduler never infers completion from a rendering animation. */
    tick(): void {
        let active = this.jobs.filter(job => {
            const stage = this.repository.get(job.id)?.stage;
            return stage !== "PLANNED" && stage !== "GATE_OUT";
        }).length;
        for (const job of this.jobs) {
            const snapshot = this.repository.get(job.id)!;
            if (snapshot.stage === "GATE_OUT") continue;
            if (snapshot.stage === "PLANNED" && active >= this.maxActiveJobs) continue;
            const elapsed = (this.ticks.get(job.id) ?? 0) + 1;
            this.ticks.set(job.id, elapsed);
            const next = this.repository.next(job.id);
            if (!next || elapsed < this.dwell(snapshot.stage)) continue;
            if (!this.reserve(job, next)) continue;
            this.ticks.set(job.id, 0);
            const event: CargoEvent = {
                id: `${job.id}:${snapshot.sequence + 1}`, jobId: job.id, type: next,
                sequence: snapshot.sequence + 1, occurredAt: new Date().toISOString(),
                equipmentId: this.equipmentFor(job, next), synthetic: true
            };
            this.repository.apply(event);
            this.release(job, next);
            this.serial++;
            this.emit(event);
            if (snapshot.stage === "PLANNED") active++;
        }
    }
    getStats(): { active: number; completed: number; pending: number; qcBusy: number; agvBusy: number; ascBusy: number; emitted: number } {
        const stages = this.repository.list().map(item => item.stage);
        return {
            active: stages.filter(s => s !== "PLANNED" && s !== "GATE_OUT").length,
            completed: stages.filter(s => s === "GATE_OUT").length,
            pending: stages.filter(s => s === "PLANNED").length,
            qcBusy: this.qcBusy.size, agvBusy: this.agvBusy.size,
            ascBusy: this.ascBusy.size, emitted: this.serial
        };
    }
    private dwell(stage: string): number {
        switch (stage) {
            case "ON_AGV": return 5; // travel
            case "IN_YARD": return 10; // storage/pickup delay
            case "ON_TRUCK": return 4; // gate check
            default: return 2;
        }
    }
    private reserve(job: CargoJob, next: CargoEventType): boolean {
        if (next === "QC_PICKED") {
            if (this.qcBusy.size >= 2 || this.qcBusy.has(job.craneId)) return false;
            this.qcBusy.add(job.craneId);
        }
        if (next === "ON_AGV") {
            if (this.agvBusy.size >= 4 || this.agvBusy.has(job.agvId)) return false;
            this.agvBusy.add(job.agvId);
        }
        if (next === "IN_YARD" || next === "ON_TRUCK") {
            if (this.ascBusy.size >= 2 || this.ascBusy.has(job.yardId)) return false;
            this.ascBusy.add(job.yardId);
        }
        if (next === "ON_TRUCK") {
            const truckId = `TRUCK-${job.id}`;
            if (this.truckBusy.size >= 2) { this.ascBusy.delete(job.yardId); return false; }
            this.truckBusy.add(truckId);
        }
        return true;
    }
    private release(job: CargoJob, next: CargoEventType): void {
        if (next === "ON_AGV") this.qcBusy.delete(job.craneId);
        if (next === "IN_YARD") { this.agvBusy.delete(job.agvId); this.ascBusy.delete(job.yardId); }
        if (next === "ON_TRUCK") this.ascBusy.delete(job.yardId);
        if (next === "GATE_OUT") this.truckBusy.delete(`TRUCK-${job.id}`);
    }
    private equipmentFor(job: CargoJob, type: CargoEventType): string {
        switch (type) {
            case "QC_PICKED": return job.craneId;
            case "ON_AGV": case "AT_YARD_TRANSFER": return job.agvId;
            case "IN_YARD": case "ON_TRUCK": return `ASC-${job.yardId}`;
            case "PICKUP_REQUESTED": return "TOS-YARD";
            case "GATE_OUT": return `GATE-TRUCK-${job.id}`;
        }
    }
}
