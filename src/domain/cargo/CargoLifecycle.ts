/** Pure domain module: no map SDK, timers, HTTP or DOM dependencies. */
export const CARGO_STAGES = [
    "PLANNED", "QC_PICKED", "ON_AGV", "AT_YARD_TRANSFER",
    "IN_YARD", "PICKUP_REQUESTED", "ON_TRUCK", "GATE_OUT"
] as const;
export type CargoStage = typeof CARGO_STAGES[number];
export type CargoEventType = Exclude<CargoStage, "PLANNED">;

export interface CargoJob {
    id: string;
    containerNo: string;
    agvId: string;
    craneId: string;
    yardId: string;
    vesselId: string;
    synthetic: boolean;
}
export interface CargoEvent {
    id: string;
    jobId: string;
    type: CargoEventType;
    sequence: number;
    occurredAt: string;
    equipmentId: string;
    synthetic: boolean;
}
export interface CargoSnapshot {
    job: CargoJob;
    stage: CargoStage;
    sequence: number;
    updatedAt: string | null;
    history: readonly CargoEvent[];
}

const NEXT: Record<CargoStage, CargoEventType | null> = {
    PLANNED: "QC_PICKED", QC_PICKED: "ON_AGV", ON_AGV: "AT_YARD_TRANSFER",
    AT_YARD_TRANSFER: "IN_YARD", IN_YARD: "PICKUP_REQUESTED",
    PICKUP_REQUESTED: "ON_TRUCK", ON_TRUCK: "GATE_OUT", GATE_OUT: null
};

/** Enforces causality, sequential versions and duplicate-event idempotency. */
export class CargoLifecycle {
    private snapshotValue: CargoSnapshot;
    constructor(job: CargoJob) {
        if (!job.id || !job.containerNo || !job.agvId) throw new Error("Invalid cargo job");
        this.snapshotValue = { job: { ...job }, stage: "PLANNED", sequence: 0, updatedAt: null, history: [] };
    }
    get snapshot(): CargoSnapshot { return this.snapshotValue; }
    get nextEvent(): CargoEventType | null { return NEXT[this.snapshotValue.stage]; }

    apply(event: CargoEvent): boolean {
        const current = this.snapshotValue;
        if (event.jobId !== current.job.id) throw new Error(`Wrong job: ${event.jobId}`);
        if (!event.id || !event.equipmentId || !Number.isFinite(Date.parse(event.occurredAt))) {
            throw new Error("Invalid cargo event fields");
        }
        if (event.sequence <= current.sequence) {
            if (current.history.some(previous => previous.id === event.id && previous.sequence === event.sequence)) return false;
            throw new Error(`Out-of-order/conflicting cargo event ${event.id}`);
        }
        if (event.sequence !== current.sequence + 1 || event.type !== NEXT[current.stage]) {
            throw new Error(`Invalid transition ${current.stage} -> ${event.type}, seq=${event.sequence}`);
        }
        if (event.synthetic !== current.job.synthetic) throw new Error("Synthetic/source provenance mismatch");
        this.snapshotValue = {
            ...current, stage: event.type, sequence: event.sequence,
            updatedAt: event.occurredAt, history: [...current.history, { ...event }]
        };
        return true;
    }
}

export class CargoRepository {
    private jobs = new Map<string, CargoLifecycle>();
    register(job: CargoJob): void {
        if (this.jobs.has(job.id)) throw new Error(`Duplicate cargo job ${job.id}`);
        this.jobs.set(job.id, new CargoLifecycle(job));
    }
    apply(event: CargoEvent): boolean {
        const lifecycle = this.jobs.get(event.jobId);
        if (!lifecycle) throw new Error(`Unknown cargo job ${event.jobId}`);
        return lifecycle.apply(event);
    }
    get(jobId: string): CargoSnapshot | undefined { return this.jobs.get(jobId)?.snapshot; }
    list(): CargoSnapshot[] { return [...this.jobs.values()].map(lifecycle => lifecycle.snapshot); }
    next(jobId: string): CargoEventType | null | undefined { return this.jobs.get(jobId)?.nextEvent; }
}

export const STAGE_LABELS: Record<CargoStage, string> = {
    PLANNED: "待卸船", QC_PICKED: "岸桥已吊取", ON_AGV: "已装载 AGV",
    AT_YARD_TRANSFER: "到达堆场海侧", IN_YARD: "已入堆场箱位",
    PICKUP_REQUESTED: "等待外集卡提箱", ON_TRUCK: "已装载外集卡", GATE_OUT: "闸口放行出港"
};
