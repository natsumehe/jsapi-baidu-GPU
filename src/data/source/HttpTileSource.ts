import type { TileRequest } from "../runtime/TileTypes";
import type { TileSource } from "./TileSource";

const PORT_MAGIC = 0x504f5254;
const PORT_HEADER_SIZE = 24;

/**
 * Fetch Stream 数据源。
 *
 * 关键点：这里不再把 ReadableStream 在主线程拼成一个大 ArrayBuffer。
 * DataPipeline 会把每个 chunk 直接 transfer 给 Worker，Worker 再负责最终拼接。
 */
export class HttpTileSource implements TileSource {
    async load(
        request: TileRequest,
        signal?: AbortSignal
    ): Promise<ArrayBuffer> {
        const stream = await this.loadStream(request, signal);
        const chunks: Uint8Array[] = [];
        let total = 0;
        for await (const chunk of stream) {
            chunks.push(chunk);
            total += chunk.byteLength;
        }
        const result = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return result.buffer;
    }

    async loadStream(
        request: TileRequest,
        signal?: AbortSignal
    ): Promise<AsyncIterable<Uint8Array>> {
        const response = await fetch(request.url, {
            signal,
            cache: "force-cache",
            headers: { Accept: "application/octet-stream" }
        });

        if (!response.ok) {
            throw new Error(
                `Failed to load tile ${request.url}: ${response.status} ${response.statusText}`
            );
        }

        if (!response.body) {
            const buffer = await response.arrayBuffer();
            this.validateHeader(buffer, request.url);
            return this.singleChunk(buffer);
        }

        return this.createValidatedStream(response.body, request.url);
    }

    private async *createValidatedStream(
        body: ReadableStream<Uint8Array>,
        url: string
    ): AsyncGenerator<Uint8Array> {
        const reader = body.getReader();
        let header = new Uint8Array(0);
        let headerValidated = false;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!value || value.byteLength === 0) continue;

                if (!headerValidated) {
                    const merged = new Uint8Array(header.byteLength + value.byteLength);
                    merged.set(header, 0);
                    merged.set(value, header.byteLength);
                    header = merged;

                    if (header.byteLength >= PORT_HEADER_SIZE) {
                        this.validateHeader(header.buffer, url);
                        headerValidated = true;
                        yield header;
                        header = new Uint8Array(0);
                    }
                    continue;
                }

                yield value;
            }

            if (!headerValidated) {
                throw new Error(`Tile ${url} ended before the ${PORT_HEADER_SIZE}-byte PORT header was received.`);
            }
        } finally {
            reader.releaseLock();
        }
    }

    private validateHeader(buffer: ArrayBuffer, url: string): void {
        if (buffer.byteLength < PORT_HEADER_SIZE) {
            throw new Error(`Tile ${url} is not a valid PORT tile: header is incomplete.`);
        }

        const view = new DataView(buffer);
        const magic = view.getUint32(0, true);
        if (magic !== PORT_MAGIC) {
            throw new Error(
                `Tile ${url} returned a non-PORT payload. Check tile coverage/path.`
            );
        }

        const version = view.getUint32(4, true);
        if (version !== 1) {
            throw new Error(`Tile ${url} uses unsupported PORT version ${version}.`);
        }
    }

    private async *singleChunk(buffer: ArrayBuffer): AsyncGenerator<Uint8Array> {
        yield new Uint8Array(buffer);
    }
}
