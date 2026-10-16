import { CargoRepository, type CargoEvent, type CargoJob, type CargoSnapshot } from "../../domain/cargo/CargoLifecycle";
import type { PortOperationsAdapter } from "../../infrastructure/tos/PortOperationsAdapter";

export interface PortOperationsView {
    mode: "simulation" | "remote";
    jobs: CargoSnapshot[];
    recent: CargoEvent[];
    error: string | null;
    dispatch: Record<string, number>;
}
/** Application boundary: external source -> validated domain changes -> UI projection. */
export class PortOperationsService {
    readonly repository = new CargoRepository();
    private recent: CargoEvent[] = [];
    private error: string | null = null;
    private listeners = new Set<(state: PortOperationsView) => void>();
    private abort = new AbortController();
    constructor(private readonly adapter: PortOperationsAdapter) {}
    async initialize(): Promise<void> {
        await this.adapter.connect({
            register: (jobs: CargoJob[]) => {
                for (const job of jobs) this.repository.register(job);
                this.notify();
            },
            accept: (event: CargoEvent) => {
                if (!this.repository.apply(event)) return;
                this.recent.unshift(event);
                this.recent = this.recent.slice(0, 40);
                this.error = null;
                this.notify();
            },
            reportError: message => { this.error = message; this.notify(); }
        }, this.abort.signal);
    }
    subscribe(listener: (state: PortOperationsView) => void): () => void {
        this.listeners.add(listener);
        listener(this.snapshot());
        return () => this.listeners.delete(listener);
    }
    snapshot(): PortOperationsView {
        return { mode: this.adapter.mode, jobs: this.repository.list(),
            recent: [...this.recent], error: this.error, dispatch: this.adapter.getDispatchStats?.() ?? {} };
    }
    setRunning(running: boolean): void { this.adapter.setRunning?.(running); }
    setSpeed(speed: number): void { this.adapter.setSpeed?.(speed); }
    destroy(): void { this.abort.abort(); this.adapter.disconnect(); this.listeners.clear(); }
    private notify(): void { const state = this.snapshot(); for (const listener of this.listeners) listener(state); }
}
