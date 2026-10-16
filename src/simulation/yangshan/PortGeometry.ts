/** GIS-derived visual scenario. BD09 coordinates; local XY in metres. */
export interface PortPoint {
    longitude: number;
    latitude: number;
    x: number;
    y: number;
}
export interface ISOContainer {
    id: string;
    center: PortPoint;
    level: number;
    length: number;
    width: number;
    height: number;
}
export interface YardGeometry {
    id: string;
    name: string;
    boundary: PortPoint[];
    center: PortPoint;
    unload: PortPoint;
    sourceUnload: PortPoint;
    quayId: number;
    axis: [number, number];
    heading: number;
    gantry: {position: PortPoint; scale: number; railStart: PortPoint; railEnd: PortPoint};
    containers: ISOContainer[];
    unloadSource?: string;
    hookReachMeters?: number;
    handoffReachable?: boolean;
}
export interface PortGeometry {
    synthetic: boolean;
    coordinateSystem: string;
    standardContainer: {length: number; width: number; height: number};
    quayCranes: {id: number; name: string; position: PortPoint}[];
    yards: YardGeometry[];
    parkingBuffer: {name: string; boundary: PortPoint[]; spots: PortPoint[]};
    agvTransferZone: {name: string; boundary: PortPoint[]};
}
export async function loadPortGeometry(signal?: AbortSignal): Promise<PortGeometry> {
    const response = await fetch('/data/simulation/yangshan_phase4/port_layout.json', {signal});
    if (!response.ok) throw new Error(`Port geometry request failed: ${response.status}`);
    const data = await response.json() as PortGeometry;
    if (!data.synthetic || data.coordinateSystem !== 'BD09/local-meter' || data.yards.length !== 61 || data.quayCranes.length !== 28 || data.parkingBuffer.spots.length !== 155) {
        throw new Error('Invalid GIS-derived terminal layout');
    }
    return data;
}
