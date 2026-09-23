import type { TileRequest } from "../runtime/TileTypes";
import type { TileSource } from "./TileSource";

const PORT_MAGIC = 0x504f5254;

/**
 * 浏览器侧 Tile 数据源。
 *
 * 只负责“取数据”，不负责业务格式解码。
 * 在进入 Worker 前做最基本的传输完整性校验，避免
 * 404/SPA fallback 返回 index.html 后被误送进 WASM。
 */
export class HttpTileSource implements TileSource {
    async load(
        request: TileRequest,
        signal?: AbortSignal
    ): Promise<ArrayBuffer> {
        const response = await fetch(request.url, {
            signal,
            cache: "force-cache",
            headers: {
                Accept: "application/octet-stream"
            }
        });

        if (!response.ok) {
            throw new Error(
                `Failed to load tile ${request.url}: ` +
                `${response.status} ${response.statusText}`
            );
        }

        const buffer = response.body
            ? await this.readStream(response.body)
            : await response.arrayBuffer();

        this.validatePortEnvelope(buffer, request.url);
        return buffer;
    }

    private async readStream(
        body: ReadableStream<Uint8Array>
    ): Promise<ArrayBuffer> {
        const reader = body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                if (value) {
                    chunks.push(value);
                    total += value.byteLength;
                }
            }
        } finally {
            reader.releaseLock();
        }

        const result = new Uint8Array(total);
        let offset = 0;

        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.byteLength;
        }

        return result.buffer;
    }

    private validatePortEnvelope(
        buffer: ArrayBuffer,
        url: string
    ): void {
        if (buffer.byteLength < 24) {
            throw new Error(
                `Tile ${url} is not a valid PORT tile: ` +
                `payload is smaller than the 24-byte header.`
            );
        }

        const view = new DataView(buffer);
        const magic = view.getUint32(0, true);

        if (magic !== PORT_MAGIC) {
            throw new Error(
                `Tile ${url} returned a non-PORT payload. ` +
                `Check tile coverage/path instead of sending the response to WASM.`
            );
        }

        const version = view.getUint32(4, true);
        if (version !== 1) {
            throw new Error(
                `Tile ${url} uses unsupported PORT version ${version}.`
            );
        }
    }
}
