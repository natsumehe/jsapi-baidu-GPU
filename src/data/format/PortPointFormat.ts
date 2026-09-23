import type { SpatialFormatAdapter } from "./DataFormatMiddleware";
import type { SpatialBuffer } from "../runtime/SpatialBuffer";

export interface PortPointBusinessData {
    tileId: string;
    positions: Float32Array;
    colors: Uint8Array;
    types: Uint8Array;
}

/**
 * 宁波舟山港当前演示数据格式：
 * PORT header + PackedPoint。
 *
 * 这里是“业务格式适配器”，以后 AIS/AGV/管线/雷达等
 * 可以各自实现自己的 Adapter，而不是统一成一个业务 Entity。
 */
export class PortPointFormatAdapter
    implements SpatialFormatAdapter<PortPointBusinessData> {

    readonly name = "port-point-binary-v1";

    canHandle(input: ArrayBuffer): boolean {
        if (input.byteLength < 4) return false;
        const view = new DataView(input);
        return view.getUint32(0, true) === 0x504f5254;
    }

    decode(
        input: ArrayBuffer,
        tileId: string
    ): PortPointBusinessData {
        const view = new DataView(input);
        const headerSize = 24;
        const recordSize = 16;

        if (input.byteLength < headerSize) {
            throw new Error("PORT tile header is incomplete.");
        }

        const magic = view.getUint32(0, true);
        if (magic !== 0x504f5254) {
            throw new Error("Invalid PORT tile magic.");
        }

        const count = view.getUint32(8, true);
        const required = headerSize + count * recordSize;

        if (required > input.byteLength) {
            throw new Error("PORT tile payload is truncated.");
        }

        const positions = new Float32Array(count * 3);
        const colors = new Uint8Array(count * 4);
        const types = new Uint8Array(count);

        let offset = headerSize;

        for (let i = 0; i < count; i++) {
            positions[i * 3] = view.getFloat32(offset, true);
            positions[i * 3 + 1] = view.getFloat32(offset + 4, true);
            positions[i * 3 + 2] = view.getFloat32(offset + 8, true);

            colors[i * 4] = view.getUint8(offset + 12);
            colors[i * 4 + 1] = view.getUint8(offset + 13);
            colors[i * 4 + 2] = view.getUint8(offset + 14);
            colors[i * 4 + 3] = 255;
            types[i] = view.getUint8(offset + 15);

            offset += recordSize;
        }

        return {
            tileId,
            positions,
            colors,
            types
        };
    }

    normalize(
        business: PortPointBusinessData,
        level: number
    ): SpatialBuffer {
        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;

        for (let i = 0; i < business.positions.length; i += 3) {
            const x = business.positions[i];
            const y = business.positions[i + 1];
            const z = business.positions[i + 2];

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            minZ = Math.min(minZ, z);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            maxZ = Math.max(maxZ, z);
        }

        if (business.positions.length === 0) {
            minX = minY = minZ = 0;
            maxX = maxY = maxZ = 0;
        }

        return {
            metadata: {
                tileId: business.tileId,
                level,
                pointCount: business.positions.length / 3,
                bounds: {
                    minX, minY, minZ,
                    maxX, maxY, maxZ
                },
                byteLength:
                    business.positions.byteLength +
                    business.colors.byteLength +
                    business.types.byteLength,
                format: this.name
            },
            positions: business.positions,
            colors: business.colors,
            types: business.types
        };
    }
}
