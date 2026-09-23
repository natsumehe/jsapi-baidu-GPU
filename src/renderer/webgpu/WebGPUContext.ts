export class WebGPUContext {

    device!: GPUDevice;

    adapter!: GPUAdapter;

    async initialize(): Promise<void> {

        if (!navigator.gpu) {
            throw new Error(
                'WebGPU is not supported'
            );
        }

        const adapter =
            await navigator.gpu.requestAdapter();

        if (!adapter) {
            throw new Error(
                'Cannot create WebGPU adapter'
            );
        }

        this.adapter =
            adapter;

        this.device =
            await adapter.requestDevice();
    }
}