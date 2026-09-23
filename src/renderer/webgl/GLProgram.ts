export class GLProgram {

    readonly program:
        WebGLProgram;

    constructor(

        private readonly gl:
            WebGLRenderingContext,

        vertexSource:
            string,

        fragmentSource:
            string

    ) {

        const vertex =
            this.compile(
                gl.VERTEX_SHADER,
                vertexSource
            );

        const fragment =
            this.compile(
                gl.FRAGMENT_SHADER,
                fragmentSource
            );

        const program =
            gl.createProgram();

        if (
            !program
        ) {

            throw new Error(
                "Failed to create WebGL program."
            );
        }

        gl.attachShader(
            program,
            vertex
        );

        gl.attachShader(
            program,
            fragment
        );

        gl.linkProgram(
            program
        );

        if (
            !gl.getProgramParameter(
                program,
                gl.LINK_STATUS
            )
        ) {

            const info =
                gl.getProgramInfoLog(
                    program
                ) ??
                "WebGL program link failed.";

            gl.deleteProgram(
                program
            );

            gl.deleteShader(
                vertex
            );

            gl.deleteShader(
                fragment
            );

            throw new Error(
                info
            );
        }

        gl.deleteShader(
            vertex
        );

        gl.deleteShader(
            fragment
        );

        this.program =
            program;
    }

    use(): void {

        this.gl.useProgram(
            this.program
        );
    }

    uniformLocation(
        name: string
    ):
        WebGLUniformLocation | null {

        return this.gl.getUniformLocation(
            this.program,
            name
        );
    }

    attributeLocation(
        name: string
    ):
        number {

        return this.gl.getAttribLocation(
            this.program,
            name
        );
    }

    destroy(): void {

        this.gl.deleteProgram(
            this.program
        );
    }

    private compile(
        type: number,
        source: string
    ):
        WebGLShader {

        const shader =
            this.gl.createShader(
                type
            );

        if (
            !shader
        ) {

            throw new Error(
                "Failed to create WebGL shader."
            );
        }

        this.gl.shaderSource(
            shader,
            source
        );

        this.gl.compileShader(
            shader
        );

        if (
            !this.gl.getShaderParameter(
                shader,
                this.gl.COMPILE_STATUS
            )
        ) {

            const info =
                this.gl.getShaderInfoLog(
                    shader
                ) ??
                "WebGL shader compilation failed.";

            this.gl.deleteShader(
                shader
            );

            throw new Error(
                info
            );
        }

        return shader;
    }
}