export interface SpatialBounds {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
}

export interface SpatialBufferMetadata {
    tileId: string;
    level: number;
    pointCount: number;
    bounds: SpatialBounds;
    byteLength: number;
    format: string;
}

/**
 * GPU/计算友好的运行时空间数据。
 *
 * 业务语义不会被强行统一到这里；
 * 这里仅保留空间计算和渲染真正需要的数据布局。
 */
export interface SpatialBuffer {
    readonly metadata: SpatialBufferMetadata;
    readonly positions: Float32Array;
    readonly colors: Uint8Array;
    readonly types: Uint8Array;
}
