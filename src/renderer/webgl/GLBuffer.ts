export class GLBuffer {

    private buffer:
        WebGLBuffer | null;

    constructor(
        private readonly gl:
            WebGLRenderingContext
    ) {

        this.buffer =
            gl.createBuffer();

        if (
            !this.buffer
        ) {

            throw new Error(
                "Failed to create WebGL buffer."
            );
        }
    }

    upload(
        data:
            ArrayBufferView |
            ArrayBuffer,

        usage:
            GLenum =
            this.gl.DYNAMIC_DRAW
    ): void {

        this.gl.bindBuffer(
            this.gl.ARRAY_BUFFER,
            this.buffer
        );

        this.gl.bufferData(
            this.gl.ARRAY_BUFFER,
            data,
            usage
        );

        this.gl.bindBuffer(
            this.gl.ARRAY_BUFFER,
            null
        );
    }

    bind(): void {

        this.gl.bindBuffer(
            this.gl.ARRAY_BUFFER,
            this.buffer
        );
    }

    destroy(): void {

        if (
            this.buffer
        ) {

            this.gl.deleteBuffer(
                this.buffer
            );

            this.buffer =
                null;
        }
    }
}