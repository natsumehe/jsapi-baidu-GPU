export interface AGVTrajectoryRecord {
    agvId: string;
    taskId: string;
    routeId: string;
    timestamp: string;
    longitude: number;
    latitude: number;
    heading: number;
    speedMps: number;
    phase: string;
    battery: number;
}

interface Payload {
    synthetic: boolean;
    rowCount: number;
    rows: AGVTrajectoryRecord[];
}

export class AGVTrajectorySource {
    constructor(
        private readonly url = "/data/simulation/yangshan_phase4/AGV_TRAJECTORY.json"
    ) {}

    async load(signal?: AbortSignal): Promise<AGVTrajectoryRecord[]> {
        const response = await fetch(this.url, { signal, cache: "no-cache" });
        if (!response.ok) {
            throw new Error(`AGV trajectory request failed: ${response.status}`);
        }
        const payload = await response.json() as Payload;
        if (!Array.isArray(payload.rows)) {
            throw new Error("Invalid AGV_TRAJECTORY dataset.");
        }
        return payload.rows;
    }
}
