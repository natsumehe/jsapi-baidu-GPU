import type {
    DecodedTile,
    TileRequest
} from "../runtime/TileTypes";
import type { WorkerPool } from "../../worker/WorkerPool";
import { DataFormatMiddleware } from "../format/DataFormatMiddleware";
import { HttpTileSource } from "../source/HttpTileSource";
import { TaskScheduler } from "../scheduler/TaskScheduler";
import type { SpatialBuffer } from "../runtime/SpatialBuffer";
import type { TileSource } from "../source/TileSource";

export interface PipelineTile extends SpatialBuffer {
    readonly request: TileRequest;
}

export interface DataPipelineStats {
    pendingTasks: number;
    activeTasks: number;
    loadedTiles: number;
    decodedTiles: number;
    bytesFetched: number;
    streamChunks: number;
}

/**
 * 数据处理管线：
 *
 * Tile Request
 *   -> HTTP/Stream
 *   -> Worker/WASM Decode
 *   -> Format Middleware
 *   -> Runtime Data
 *
 * 调度由 Scheduler 控制，数据语义由 Format Middleware 控制。
 */
export class DataPipeline {

    private readonly scheduler: TaskScheduler;
    private readonly source: TileSource;
    private readonly format: DataFormatMiddleware;

    private loadedTiles = 0;
    private decodedTiles = 0;
    private bytesFetched = 0;
    private streamChunks = 0;

    constructor(
        private readonly workers: WorkerPool,
        options: {
            source?: TileSource;
            format?: DataFormatMiddleware;
            concurrency?: number;
        } = {}
    ) {
        this.scheduler = new TaskScheduler(options.concurrency);
        this.source = options.source ?? new HttpTileSource();
        this.format = options.format ?? new DataFormatMiddleware();
    }

    requestTile(
        request: TileRequest,
        signal?: AbortSignal,
        onPartial?: (tile: PipelineTile) => void
    ): Promise<PipelineTile> {
        return this.scheduler.schedule({
            id: request.id,
            priority: request.priority,
            run: async () => {
                if (signal?.aborted) {
                    throw new DOMException(
                        "Tile request was aborted.",
                        "AbortError"
                    );
                }

                let decoded: DecodedTile;

                if (this.source.loadStream) {
                    const stream = await this.source.loadStream(request, signal);
                    const countedStream = this.countStream(stream);
                    decoded = await this.workers.decodeTileStream(request.id, countedStream, signal, chunk => {
                        if (signal?.aborted || !onPartial) return;
                        const partial = this.format.packForGPU(this.format.normalizeDecodedTile({
                            id: request.id, count: chunk.count, positions: chunk.positions, colors: chunk.colors
                        }, request.z));
                        onPartial({ ...partial, request });
                    });
                } else {
                    const raw = await this.source.load(request, signal);
                    this.bytesFetched += raw.byteLength;
                    this.streamChunks += 1;
                    decoded = await this.workers.decodeTile(request.id, raw);
                }

                this.decodedTiles++;

                const normalized =
                    this.format.normalizeDecodedTile(
                        decoded,
                        request.z
                    );

                const runtime =
                    this.format.packForGPU(normalized);

                this.loadedTiles++;

                return {
                    ...runtime,
                    request
                };
            }
        });
    }

    getStats(): DataPipelineStats {
        return {
            pendingTasks:
                this.scheduler.getPendingCount(),
            activeTasks:
                this.scheduler.getActiveCount(),
            loadedTiles:
                this.loadedTiles,
            decodedTiles:
                this.decodedTiles,
            bytesFetched: this.bytesFetched,
            streamChunks: this.streamChunks
        };
    }

    private async *countStream(
        stream: AsyncIterable<Uint8Array>
    ): AsyncGenerator<Uint8Array> {
        for await (const chunk of stream) {
            this.bytesFetched += chunk.byteLength;
            this.streamChunks += 1;
            yield chunk;
        }
    }
}
