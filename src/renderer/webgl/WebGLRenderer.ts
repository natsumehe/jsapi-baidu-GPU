export class WebGLRenderer {

    private gl: WebGLRenderingContext;

    private program: WebGLProgram | null = null;

    private positionBuffer:
        WebGLBuffer | null = null;

    private positionLocation = -1;

    constructor(
        canvas: HTMLCanvasElement
    ) {

        const gl =
            canvas.getContext(
                'webgl'
            );

        if (!gl) {
            throw new Error(
                'WebGL is not supported'
            );
        }

        this.gl = gl;
    }

    initialize(): void {

        const vertexShader =
            this.createShader(
                this.gl.VERTEX_SHADER,
                `
                attribute vec3 a_position;

                uniform mat4 u_matrix;

                void main() {

                    gl_Position =
                        u_matrix *
                        vec4(
                            a_position,
                            1.0
                        );

                    gl_PointSize = 4.0;
                }
                `
            );

        const fragmentShader =
            this.createShader(
                this.gl.FRAGMENT_SHADER,
                `
                precision mediump float;

                void main() {

                    gl_FragColor =
                        vec4(
                            0.1,
                            0.8,
                            1.0,
                            1.0
                        );
                }
                `
            );

        this.program =
            this.createProgram(
                vertexShader,
                fragmentShader
            );

        this.positionLocation =
            this.gl.getAttribLocation(
                this.program,
                'a_position'
            );

        this.positionBuffer =
            this.gl.createBuffer();
    }

    upload(
        points: Float32Array
    ): void {

        if (!this.positionBuffer) {
            throw new Error(
                'Renderer not initialized'
            );
        }

        this.gl.bindBuffer(
            this.gl.ARRAY_BUFFER,
            this.positionBuffer
        );

        this.gl.bufferData(
            this.gl.ARRAY_BUFFER,
            points,
            this.gl.DYNAMIC_DRAW
        );
    }

    draw(
        matrix: Float32Array,
        count: number
    ): void {

        if (!this.program) {
            return;
        }

        const gl = this.gl;

        gl.useProgram(
            this.program
        );

        gl.bindBuffer(
            gl.ARRAY_BUFFER,
            this.positionBuffer
        );

        gl.enableVertexAttribArray(
            this.positionLocation
        );

        gl.vertexAttribPointer(
            this.positionLocation,
            3,
            gl.FLOAT,
            false,
            0,
            0
        );

        const location =
            gl.getUniformLocation(
                this.program,
                'u_matrix'
            );

        gl.uniformMatrix4fv(
            location,
            false,
            matrix
        );

        gl.drawArrays(
            gl.POINTS,
            0,
            count
        );
    }

    private createShader(
        type: number,
        source: string
    ): WebGLShader {

        const shader =
            this.gl.createShader(type)!;

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

            throw new Error(
                this.gl.getShaderInfoLog(
                    shader
                ) || ''
            );
        }

        return shader;
    }

    private createProgram(
        vertex: WebGLShader,
        fragment: WebGLShader
    ): WebGLProgram {

        const program =
            this.gl.createProgram()!;

        this.gl.attachShader(
            program,
            vertex
        );

        this.gl.attachShader(
            program,
            fragment
        );

        this.gl.linkProgram(
            program
        );

        if (
            !this.gl.getProgramParameter(
                program,
                this.gl.LINK_STATUS
            )
        ) {

            throw new Error(
                this.gl.getProgramInfoLog(
                    program
                ) || ''
            );
        }

        return program;
    }
}