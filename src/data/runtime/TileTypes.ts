export interface TileRequest {

    id: string;

    url: string;

    z: number;

    x: number;

    y: number;

    priority: number;
}

export interface DecodedTile {

    id: string;

    count: number;

    positions: Float32Array;

    colors: Uint8Array;
}