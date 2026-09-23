import {
    GLBuffer
} from "./GLBuffer";

import {
    GLProgram
} from "./GLProgram";


const vertexShader = `

attribute vec2 a_position;

attribute vec4 a_color;

varying vec4 v_color;


void main()
{
    gl_Position =
        vec4(
            a_position,
            0.0,
            1.0
        );

    gl_PointSize =
        5.0;

    v_color =
        a_color;
}
`;


const fragmentShader = `

precision mediump float;

varying vec4 v_color;


void main()
{
    vec2 p =
        gl_PointCoord -
        vec2(0.5);

    if (
        dot(p, p) >
        0.25
    ) {

        discard;
    }

    gl_FragColor =
        v_color;
}
`;


export class PointLayer {

    private readonly program:
        GLProgram;

    private readonly positionBuffer:
        GLBuffer;

    private readonly colorBuffer:
        GLBuffer;

    private count =
        0;

    constructor(
        private readonly gl:
            WebGLRenderingContext
    ) {

        this.program =
            new GLProgram(
                gl,
                vertexShader,
                fragmentShader
            );

        this.positionBuffer =
            new GLBuffer(
                gl
            );

        this.colorBuffer =
            new GLBuffer(
                gl
            );
    }

    upload(
        screenPositions:
            Float32Array,

        colors:
            Uint8Array
    ): void {

        this.positionBuffer.upload(
            screenPositions,
            this.gl.DYNAMIC_DRAW
        );

        this.colorBuffer.upload(
            colors,
            this.gl.DYNAMIC_DRAW
        );

        this.count =
            Math.floor(
                screenPositions.length /
                2
            );
    }

    render(): void {

        if (
            this.count === 0
        ) {

            return;
        }

        const gl =
            this.gl;

        this.program.use();

        /*
         * Position
         */

        this.positionBuffer.bind();

        gl.enableVertexAttribArray(
            0
        );

        gl.vertexAttribPointer(
            0,
            2,
            gl.FLOAT,
            false,
            0,
            0
        );

        /*
         * Color
         */

        this.colorBuffer.bind();

        gl.enableVertexAttribArray(
            1
        );

        gl.vertexAttribPointer(
            1,
            4,
            gl.UNSIGNED_BYTE,
            true,
            0,
            0
        );

        gl.drawArrays(
            gl.POINTS,
            0,
            this.count
        );

        gl.disableVertexAttribArray(
            0
        );

        gl.disableVertexAttribArray(
            1
        );
    }

    getCount():
        number {

        return this.count;
    }

    destroy(): void {

        this.positionBuffer.destroy();

        this.colorBuffer.destroy();

        this.program.destroy();

        this.count =
            0;
    }
}