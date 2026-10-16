import type { CargoEvent, CargoEventType, CargoJob } from "../../domain/cargo/CargoLifecycle";
import { CARGO_STAGES } from "../../domain/cargo/CargoLifecycle";
import type { PortOperationsAdapter, PortOperationsSink } from "./PortOperationsAdapter";

interface FeedPage { jobs?: CargoJob[]; events?: CargoEvent[]; cursor?: string; }
/** Explicit opt-in HTTP event feed. No silent fallback to simulated events on failure. */
export class RemotePortOperationsAdapter implements PortOperationsAdapter {
    readonly mode = "remote" as const;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private cursor = "";
    private initialized = false;
    private cancelled = false;
    constructor(private readonly url: string, private readonly pollMs = 2000) {
        if (!url.startsWith("/") && !url.startsWith("https://")) throw new Error("Event endpoint must use HTTPS or a relative URL");
    }
    async connect(sink: PortOperationsSink, signal: AbortSignal): Promise<void> {
        this.disconnect(); this.cancelled = false;
        const poll = async () => {
            if (signal.aborted || this.cancelled) return;
            try {
                const endpoint = new URL(this.url, window.location.origin);
                if (this.cursor) endpoint.searchParams.set("cursor", this.cursor);
                const response = await fetch(endpoint, { signal, cache: "no-store", headers: { Accept: "application/json" } });
                if (!response.ok) throw new Error(`TOS event endpoint returned ${response.status}`);
                const data = await response.json() as FeedPage;
                if (!data || !Array.isArray(data.events) || (typeof data.cursor !== "string" && data.cursor !== undefined)) {
                    throw new Error("Invalid TOS feed page");
                }
                if (!this.initialized) {
                    if (!Array.isArray(data.jobs) || !data.jobs.length) throw new Error("First feed page must include jobs");
                    sink.register(data.jobs.map(validateJob));
                    this.initialized = true;
                }
                // Apply before advancing cursor: a state mismatch must not silently discard events.
                for (const event of data.events) sink.accept(validateEvent(event));
                this.cursor = data.cursor ?? this.cursor;
            } catch (error) {
                if (!signal.aborted && !this.cancelled) sink.reportError(`Remote TOS feed: ${String(error)}`);
            } finally {
                if (!signal.aborted && !this.cancelled) this.timer = setTimeout(() => void poll(), this.pollMs);
            }
        };
        await poll();
        signal.addEventListener("abort", () => this.disconnect(), { once: true });
    }
    disconnect(): void { this.cancelled = true; if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
}
function validateJob(job: CargoJob): CargoJob {
    if (!job || !job.id || !job.containerNo || !job.agvId || !job.craneId || !job.yardId || !job.vesselId || typeof job.synthetic !== "boolean") {
        throw new Error("Malformed cargo job");
    }
    return job;
}
function validateEvent(event: CargoEvent): CargoEvent {
    if (!event || !event.id || !event.jobId || !event.equipmentId ||
        !CARGO_STAGES.slice(1).includes(event.type as CargoEventType) ||
        !Number.isSafeInteger(event.sequence) || event.sequence <= 0 ||
        !Number.isFinite(Date.parse(event.occurredAt)) || typeof event.synthetic !== "boolean") {
        throw new Error("Malformed cargo event");
    }
    return event;
}
