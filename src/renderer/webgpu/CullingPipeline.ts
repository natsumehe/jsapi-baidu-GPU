export class CullingPipeline {
    private readonly pipeline: GPUComputePipeline;

    constructor(private readonly device: GPUDevice) {
        const shaderCode = `
struct Params {
    minX: f32,
    maxX: f32,
    minY: f32,
    maxY: f32,
    minZ: f32,
    maxZ: f32,
    count: f32,
    padding: f32,
};

@group(0) @binding(0)
var<storage, read> positions: array<f32>;

@group(0) @binding(1)
var<storage, read_write> visibility: array<u32>;

@group(0) @binding(2)
var<uniform> params: Params;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.x;

    if (f32(index) >= params.count) {
        return;
    }

    let base = index * 3u;
    let x = positions[base];
    let y = positions[base + 1u];
    let z = positions[base + 2u];

    let inside =
        x >= params.minX && x <= params.maxX &&
        y >= params.minY && y <= params.maxY &&
        z >= params.minZ && z <= params.maxZ;

    visibility[index] = select(0u, 1u, inside);
}
`;

        const shader = this.device.createShaderModule({ code: shaderCode });

        // createComputePipeline 是异步前的同步创建接口；实际编译错误在
        // WebGPU 的 validation 层体现。这里保留最简单稳定的 pipeline 创建方式。
        this.pipeline = this.device.createComputePipeline({
            layout: "auto",
            compute: {
                module: shader,
                entryPoint: "main"
            }
        });
    }

    createPointBuffer(data: Float32Array): GPUBuffer {
        const buffer = this.device.createBuffer({
            size: Math.max(4, data.byteLength),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });

        this.device.queue.writeBuffer(buffer, 0, data);
        return buffer;
    }

    createVisibilityBuffer(count: number): GPUBuffer {
        return this.device.createBuffer({
            size: Math.max(4, count * 4),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });
    }

    createParamsBuffer(params: Float32Array): GPUBuffer {
        const buffer = this.device.createBuffer({
            size: Math.max(32, params.byteLength),
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.device.queue.writeBuffer(buffer, 0, params);
        return buffer;
    }

    async dispatch(
        pointBuffer: GPUBuffer,
        visibilityBuffer: GPUBuffer,
        paramsBuffer: GPUBuffer,
        count: number
    ): Promise<Uint32Array> {
        const bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: pointBuffer } },
                { binding: 1, resource: { buffer: visibilityBuffer } },
                { binding: 2, resource: { buffer: paramsBuffer } }
            ]
        });

        const encoder = this.device.createCommandEncoder();
        const pass = encoder.beginComputePass();

        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(count / 256));
        pass.end();

        const readbackSize = Math.max(4, count * 4);
        const readback = this.device.createBuffer({
            size: readbackSize,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });

        encoder.copyBufferToBuffer(
            visibilityBuffer,
            0,
            readback,
            0,
            readbackSize
        );

        this.device.queue.submit([encoder.finish()]);
        await this.device.queue.onSubmittedWorkDone?.();

        await readback.mapAsync(GPUMapMode.READ);
        const mapped = readback.getMappedRange();
        const result = new Uint32Array(mapped.slice(0, count * 4));
        readback.unmap();
        readback.destroy();

        return result;
    }
}
