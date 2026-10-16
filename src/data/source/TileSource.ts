import type { TileRequest } from "../runtime/TileTypes";

/**
 * 空间数据源只负责传输，不负责业务解码。
 * loadStream 是竞赛版主链路：Fetch ReadableStream -> Worker。
 */
export interface TileSource {
    load(request: TileRequest, signal?: AbortSignal): Promise<ArrayBuffer>;
    loadStream?(
        request: TileRequest,
        signal?: AbortSignal
    ): Promise<AsyncIterable<Uint8Array>>;
}
