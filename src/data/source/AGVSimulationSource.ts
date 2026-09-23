export interface AGVDefinition {
    id: string;
    assetId: string;
    berthId: string;
    yardId: string;
    parkingZoneId: string;
    parkingSlot: number;
    energyStationId: string;
    speedMps: number;
    battery: number;
    phaseOffset: number;
    initialLongitude: number;
    initialLatitude: number;
    taskId: string;
    routeId: string;
}

export interface AGVSimulationDataset {
    scenario: string;
    vehicleCount: number;
    synthetic: boolean;
    coordinateSystem: {
        type: string;
        origin: {
            longitude: number;
            latitude: number;
            height?: number;
        };
    };
    anchor: {
        longitude: number;
        latitude: number;
    };
    vehicles: AGVDefinition[];
}

export class AGVSimulationSource {
    constructor(
        private readonly url = "/data/simulation/yangshan_phase4/agv_fleet.json"
    ) {}

    async load(signal?: AbortSignal): Promise<AGVSimulationDataset> {
        try {
            const response = await fetch(this.url, {
                signal,
                cache: "no-cache"
            });

            if (!response.ok) {
                throw new Error(
                    `AGV simulation request failed: ${response.status}`
                );
            }

            const data = await response.json() as AGVSimulationDataset;

            if (
                !Array.isArray(data.vehicles) ||
                data.vehicles.length !== data.vehicleCount
            ) {
                throw new Error("Invalid AGV simulation dataset.");
            }

            if (
                !data.anchor ||
                typeof data.anchor.longitude !== "number" ||
                typeof data.anchor.latitude !== "number"
            ) {
                throw new Error("AGV dataset has no geographic anchor.");
            }

            return data;
        } catch (error) {
            if (signal?.aborted) throw error;

            console.warn(
                "AGV simulation dataset unavailable; using deterministic local fallback.",
                error
            );

            return this.createFallbackDataset();
        }
    }

    private createFallbackDataset(): AGVSimulationDataset {
        const anchor = {
            longitude: 122.032598,
            latitude: 30.662465
        };

        const vehicles: AGVDefinition[] = [];

        for (let i = 0; i < 155; i++) {
            vehicles.push({
                id: `AGV-${String(i + 1).padStart(3, "0")}`,
                assetId: "agv-glb",
                berthId: `QC-${String((i % 29) + 1).padStart(2, "0")}`,
                yardId: `YARD-${String((i % 12) + 1).padStart(2, "0")}`,
                parkingZoneId: `PARK-${String(Math.floor(i / 31) + 1).padStart(2, "0")}`,
                parkingSlot: i + 1,
                energyStationId: `BAY-${String((i % 3) + 1).padStart(2, "0")}`,
                speedMps: 5.5 + (i % 6) * 0.35,
                battery: 45 + (i % 50),
                phaseOffset: i / 155,
                initialLongitude: anchor.longitude,
                initialLatitude: anchor.latitude,
                taskId: `TAA-FALLBACK-${String(i + 1).padStart(6, "0")}`,
                routeId: `ROUTE-AGV-${String(i + 1).padStart(3, "0")}-001`
            });
        }

        return {
            scenario: "yangshan_phase4_demo_fallback",
            vehicleCount: 155,
            synthetic: true,
            coordinateSystem: {
                type: "local-enu",
                origin: { ...anchor, height: 0 }
            },
            anchor,
            vehicles
        };
    }
}
