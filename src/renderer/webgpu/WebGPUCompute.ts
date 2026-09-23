import { CullingPipeline } from "./CullingPipeline";

export interface CullBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ?: number;
    maxZ?: number;
}

export class WebGPUCompute {
    private adapter: GPUAdapter | null = null;
    private device: GPUDevice | null = null;
    private culling: CullingPipeline | null = null;

    /**
     * 初始化 WebGPU。
     *
     * WebGPU 在本项目中主要承担：
     * 1. 大规模点数据空间裁剪
     * 2. GPU 并行计算
     * 3. 为后续 LOD / 空间查询预留计算能力
     *
     * 最终显示由独立 WebGL Overlay 完成；Baidu Map 负责底图与相机。
     */
    async initialize(): Promise<boolean> {
        if (!navigator.gpu) {
            console.warn("WebGPU is not supported by this browser.");
            return false;
        }

        try {
            const adapter = await navigator.gpu.requestAdapter();

            if (!adapter) {
                console.warn("Failed to acquire WebGPU adapter.");
                return false;
            }

            const device = await adapter.requestDevice();

            this.adapter = adapter;
            this.device = device;
            this.culling = new CullingPipeline(device);

            console.log("WebGPU initialized successfully.");

            return true;
        } catch (error) {
            console.warn(
                "WebGPU initialization failed.",
                error
            );

            this.adapter = null;
            this.device = null;
            this.culling = null;

            return false;
        }
    }

    /**
     * 判断 WebGPU 是否已经初始化成功。
     */
    isAvailable(): boolean {
        return (
            this.device !== null &&
            this.culling !== null
        );
    }

    /**
     * 使用 GPU 对点进行 AABB 空间裁剪。
     *
     * positions:
     * [x0,y0,z0, x1,y1,z1, ...]
     *
     * 返回：
     * visibility[i] = 1
     * 表示第 i 个点在可视范围内
     *
     * visibility[i] = 0
     * 表示第 i 个点在可视范围外
     */
    async cullPositions(
        positions: Float32Array,
        bounds: CullBounds
    ): Promise<Uint32Array> {
        const count = Math.floor(
            positions.length / 3
        );

        /**
         * WebGPU 不可用时：
         * 直接认为所有点可见。
         *
         * 这样可以保证：
         *
         * WebGPU ON
         *      ↓
         * GPU Culling
         *
         * WebGPU OFF
         *      ↓
         * 全量渲染
         */
        if (!this.device || !this.culling) {
            const result = new Uint32Array(count);

            result.fill(1);

            return result;
        }

        if (count === 0) {
            return new Uint32Array();
        }

        /**
         * GPU 点位置 Buffer
         */
        const pointBuffer =
            this.culling.createPointBuffer(
                positions
            );

        /**
         * GPU 可见性 Buffer
         */
        const visibilityBuffer =
            this.culling.createVisibilityBuffer(
                count
            );

        /**
         * WGSL Params 对应：
         *
         * minX
         * maxX
         * minY
         * maxY
         * minZ
         * maxZ
         * count
         * padding
         *
         * 一共 8 个 float = 32 bytes
         */
        const params = new Float32Array([
            bounds.minX,
            bounds.maxX,

            bounds.minY,
            bounds.maxY,

            bounds.minZ ?? -100000,
            bounds.maxZ ?? 100000,

            count,

            0
        ]);

        const paramsBuffer =
            this.culling.createParamsBuffer(
                params
            );

        try {
            return await this.culling.dispatch(
                pointBuffer,
                visibilityBuffer,
                paramsBuffer,
                count
            );
        } finally {
            /**
             * GPU Buffer 必须释放。
             */
            pointBuffer.destroy();
            visibilityBuffer.destroy();
            paramsBuffer.destroy();
        }
    }

    /**
     * 获取 GPU Device。
     *
     * 主要用于后续扩展：
     *
     * - GPU LOD
     * - GPU Spatial Query
     * - GPU Prefix Sum
     * - GPU Compaction
     */
    getDevice(): GPUDevice | null {
        return this.device;
    }

    /**
     * 获取 WebGPU Adapter。
     */
    getAdapter(): GPUAdapter | null {
        return this.adapter;
    }

    /**
     * 销毁 WebGPU 资源。
     */
    destroy(): void {
        this.device = null;
        this.adapter = null;
        this.culling = null;
    }
}