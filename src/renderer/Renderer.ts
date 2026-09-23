export interface RenderFrame {

    timestamp:
        number;
}

export interface Renderer {

    initialize(
        gl:
            WebGLRenderingContext
    ): void;

    render(
        frame:
            RenderFrame
    ): void;

    destroy(): void;
}