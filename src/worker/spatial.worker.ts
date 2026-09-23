import { WasmEngine } from "../wasm/WasmEngine";
import type { DecodedTile } from "../data/runtime/TileTypes";

const wasm = new WasmEngine();
let wasmReady = false;

self.onmessage = async (
    event: MessageEvent
) => {
    const message = event.data;

    if (message?.type !== "decode-tile") {
        return;
    }

    try {
        if (!wasmReady) {
            wasmReady = await wasm.initialize();
        }

        const result: DecodedTile =
            wasmReady
                ? wasm.decodeTile(
                    message.buffer,
                    message.tileId
                )
                : decodeTileFallback(
                    message.buffer,
                    message.tileId
                );

        ((self as unknown) as { postMessage(message: unknown, transfer?: Transferable[]): void }).postMessage(
            {
                type: "decoded",
                id: message.id,
                tileId: result.id,
                count: result.count,
                positions: result.positions.buffer,
                colors: result.colors.buffer
            },
            [
                result.positions.buffer,
                result.colors.buffer
            ]
        );
    } catch (error) {
        self.postMessage({
            type: "error",
            id: message.id,
            error:
                error instanceof Error
                    ? error.message
                    : String(error)
        });
    }
};

function decodeTileFallback(
    buffer: ArrayBuffer,
    id: string
): DecodedTile {
    const view = new DataView(buffer);
    const HEADER_SIZE = 24;
    const RECORD_SIZE = 16;
    const MAGIC = 0x504f5254;

    if (buffer.byteLength < HEADER_SIZE) {
        throw new Error(
            "Tile is smaller than the 24-byte header."
        );
    }

    if (view.getUint32(0, true) !== MAGIC) {
        throw new Error("Invalid PORT tile magic.");
    }

    const count = view.getUint32(8, true);
    const required =
        HEADER_SIZE +
        count * RECORD_SIZE;

    if (required > buffer.byteLength) {
        throw new Error("Tile is truncated.");
    }

    const positions =
        new Float32Array(count * 3);

    const colors =
        new Uint8Array(count * 4);

    let offset = HEADER_SIZE;

    for (let i = 0; i < count; i++) {
        positions[i * 3] =
            view.getFloat32(offset, true);

        positions[i * 3 + 1] =
            view.getFloat32(offset + 4, true);

        positions[i * 3 + 2] =
            view.getFloat32(offset + 8, true);

        colors[i * 4] =
            view.getUint8(offset + 12);

        colors[i * 4 + 1] =
            view.getUint8(offset + 13);

        colors[i * 4 + 2] =
            view.getUint8(offset + 14);

        colors[i * 4 + 3] = 255;

        offset += RECORD_SIZE;
    }

    return {
        id,
        count,
        positions,
        colors
    };
}
