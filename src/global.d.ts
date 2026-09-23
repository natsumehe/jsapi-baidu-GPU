declare namespace BMapGL {
    type MapCenter = {
        lng: number;
        lat: number;
    };

    type Pixel = {
        x: number;
        y: number;
    };

    class Point {
        lng: number;
        lat: number;

        constructor(
            lng: number,
            lat: number
        );
    }

    class Map {
        constructor(
            container: string | HTMLElement
        );

        centerAndZoom(
            point: Point,
            zoom: number
        ): void;

        enableScrollWheelZoom(
            enabled?: boolean
        ): void;

        enableDoubleClickZoom(
            enabled?: boolean
        ): void;

        enableDragging(): void;

        setTilt(
            tilt: number
        ): void;

        setHeading(
            heading: number
        ): void;

        getZoom(): number;

        getCenter(): MapCenter;

        getHeading?(): number;

        getTilt?(): number;

        pointToPixel(
            point: Point
        ): Pixel;

        addEventListener(
            type: string,
            listener: (...args: any[]) => void
        ): void;

        removeEventListener?(
            type: string,
            listener: (...args: any[]) => void
        ): void;

        addLayer(
            layer: any
        ): void;

        removeLayer(
            layer: any
        ): void;

        addOverlay(
            layer: any
        ): void;

        removeOverlay(
            layer: any
        ): void;
    }

    class CanvasLayer {
        canvas: HTMLCanvasElement;

        constructor(
            options: {
                update: (
                    this: CanvasLayer
                ) => void;

                zIndex?: number;
            }
        );

        initialize(
            map: Map
        ): void;

        adjustSize?(): void;

        adjustRatio?(): void;

        draw?(): void;

        remove?(): void;

        getContainer?(): HTMLElement;

        show?(): void;

        hide?(): void;

        setZIndex?(
            zIndex: number
        ): void;

        getZIndex?(): number;
    }

    class ThreeLayer {
        constructor(
            options?: any
        );

        onAdd?(
            map: Map
        ): void;

        preRender?(): void;

        afterRender?(): void;

        render?(): void;

        triggerRepaint?(): void;

        refreshMap?(): void;

        convertLngLat?(
            point: Point
        ): any;

        add?(
            object: any
        ): void;

        remove?(
            object: any
        ): void;

        getScene?(): any;

        getCamera?(): any;

        getRender?(): any;

        onDestroy?(): void;

        onHide?(): void;

        onShow?(): void;

        getMap?(): Map;
    }
}

declare const BMapGL:
    typeof BMapGL;


/*
 * WebGPU minimal type declarations
 */

interface GPUBufferDescriptorLike {
    size: number;
    usage: number;
    mappedAtCreation?: boolean;
}

interface GPUBufferLike {
    mapAsync(
        mode: number
    ): Promise<void>;

    getMappedRange(): ArrayBuffer;

    unmap(): void;

    destroy(): void;
}

interface GPUDeviceLike {
    createShaderModule(
        descriptor: {
            code: string;
        }
    ): any;

    createComputePipeline(
        descriptor: any
    ): any;

    createBuffer(
        descriptor: GPUBufferDescriptorLike
    ): GPUBufferLike;

    createBindGroup(
        descriptor: any
    ): any;

    createCommandEncoder(): any;

    queue: {
        writeBuffer(
            buffer: GPUBufferLike,
            offset: number,
            data: ArrayBuffer | ArrayBufferView
        ): void;

        submit(
            commandBuffers: any[]
        ): void;

        onSubmittedWorkDone?():
            Promise<void>;
    };
}

interface GPUAdapterLike {
    requestDevice():
        Promise<GPUDeviceLike>;
}

interface GPUObjectLike {}

interface GPUComputePipelineLike
    extends GPUObjectLike {

    getBindGroupLayout(
        index: number
    ): any;
}

interface GPUBuffer
    extends GPUBufferLike {}

interface GPUAdapter
    extends GPUAdapterLike {}

interface GPUDevice
    extends GPUDeviceLike {}

interface GPUComputePipeline
    extends GPUComputePipelineLike {}

interface GPUBindGroup {}

interface GPUShaderModule {}

interface GPU {
    requestAdapter():
        Promise<GPUAdapter | null>;
}

interface Navigator {
    gpu?: GPU;
}

declare const GPUBufferUsage: {
    readonly MAP_READ: number;
    readonly COPY_SRC: number;
    readonly COPY_DST: number;
    readonly STORAGE: number;
    readonly UNIFORM: number;
};

declare const GPUMapMode: {
    readonly READ: number;
};

interface Window {
        __YANGSHAN_STREAMING_BENCHMARK__?: {
            run(size: 10000 | 100000 | 500000 | 1000000): Promise<unknown>;
            runAll(): Promise<unknown[]>;
            results(): unknown[];
        };
}
