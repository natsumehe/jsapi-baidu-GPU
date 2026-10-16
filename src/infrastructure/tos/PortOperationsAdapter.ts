import type { CargoEvent, CargoJob } from "../../domain/cargo/CargoLifecycle";
export interface PortOperationsSink {
    register(jobs: CargoJob[]): void;
    accept(event: CargoEvent): void;
    reportError(message: string): void;
}
/** Ports-and-adapters boundary. Both simulation and production send the same domain events. */
export interface PortOperationsAdapter {
    readonly mode: "simulation" | "remote";
    connect(sink: PortOperationsSink, signal: AbortSignal): Promise<void>;
    setRunning?(running: boolean): void;
    setSpeed?(speed: number): void;
    getDispatchStats?(): Record<string, number>;
    disconnect(): void;
}
