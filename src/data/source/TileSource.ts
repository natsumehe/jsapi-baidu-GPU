import type { TileRequest } from "../runtime/TileTypes";

export interface TileSource {
    load(
        request: TileRequest,
        signal?: AbortSignal
    ): Promise<ArrayBuffer>;
}
