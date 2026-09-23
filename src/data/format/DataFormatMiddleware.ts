import type { DecodedTile } from "../runtime/TileTypes";
import type {
    SpatialBounds,
    SpatialBuffer,
    SpatialBufferMetadata
} from "../runtime/SpatialBuffer";

export interface SpatialFormatAdapter<TBusiness = unknown> {
    readonly name: string;
    canHandle(input: ArrayBuffer): boolean;
    decode(input: ArrayBuffer, tileId: string): TBusiness;
    normalize(
        business: TBusiness,
        level: number
    ): SpatialBuffer;
}

/**
 * 数据格式中间件：
 *
 * 负责“业务/存储格式 -> Runtime Data”。
 * 不负责调度、网络、Worker 生命周期或 GPU API。
 */
export class DataFormatMiddleware {

    private readonly adapters: SpatialFormatAdapter[] = [];

    register(
        adapter: SpatialFormatAdapter
    ): void {
        this.adapters.push(adapter);
    }

    normalizeDecodedTile(
        tile: DecodedTile,
        level: number
    ): SpatialBuffer {
        const positions = tile.positions;
        const colors = tile.colors;

        if (positions.length % 3 !== 0) {
            throw new Error(
                `Tile ${tile.id} has invalid position stride.`
            );
        }

        const count = Math.floor(positions.length / 3);
        const rgba = colors.length === count * 4
            ? colors
            : this.expandColors(colors, count);

        const types = new Uint8Array(count);
        const bounds = this.calculateBounds(positions);

        const metadata: SpatialBufferMetadata = {
            tileId: tile.id,
            level,
            pointCount: count,
            bounds,
            byteLength:
                positions.byteLength +
                rgba.byteLength +
                types.byteLength,
            format: "port-point-runtime-v1"
        };

        return {
            metadata,
            positions,
            colors: rgba,
            types
        };
    }

    /**
     * GPU 数据侧的最终打包入口。
     * 当前 PointLayer 直接消费 SoA buffer，因此这里返回 TypedArray。
     *
     * 后续可在此增加：
     * quantization / interleaving / index buffer / texture packing。
     */
    packForGPU(
        data: SpatialBuffer
    ): SpatialBuffer {
        return data;
    }

    private expandColors(
        colors: Uint8Array,
        count: number
    ): Uint8Array {
        const result = new Uint8Array(count * 4);

        if (colors.length === count * 3) {
            for (let i = 0; i < count; i++) {
                result[i * 4] = colors[i * 3];
                result[i * 4 + 1] = colors[i * 3 + 1];
                result[i * 4 + 2] = colors[i * 3 + 2];
                result[i * 4 + 3] = 255;
            }
            return result;
        }

        result.fill(255);
        return result;
    }

    private calculateBounds(
        positions: Float32Array
    ): SpatialBounds {
        if (positions.length === 0) {
            return {
                minX: 0, minY: 0, minZ: 0,
                maxX: 0, maxY: 0, maxZ: 0
            };
        }

        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let minZ = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let maxZ = Number.NEGATIVE_INFINITY;

        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const y = positions[i + 1];
            const z = positions[i + 2];

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            minZ = Math.min(minZ, z);

            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            maxZ = Math.max(maxZ, z);
        }

        return {
            minX, minY, minZ,
            maxX, maxY, maxZ
        };
    }
}
