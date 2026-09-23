export interface StreamingPointStats {
    count: number;
    capacity: number;
    gpuTimeMs: number;
}

/**
 * 增量点渲染器：
 * - GPU Buffer 预分配一次
 * - 每个流式 chunk 使用 bufferSubData 追加
 * - 不需要每个 chunk 重建整份 VBO
 */
export class StreamingPointLayer {
    private readonly positionBuffer: WebGLBuffer;
    private readonly colorBuffer: WebGLBuffer;
    private readonly program: WebGLProgram;
    private readonly positionLocation: number;
    private readonly colorLocation: number;
    private count = 0;
    private readonly capacity: number;
    private timerExt: any = null;
    private timerQuery: any = null;
    private gpuTimeMs = 0;

    constructor(
        private readonly gl: WebGLRenderingContext,
        capacity: number
    ) {
        this.capacity = Math.max(1, capacity);

        const positionBuffer = gl.createBuffer();
        const colorBuffer = gl.createBuffer();
        if (!positionBuffer || !colorBuffer) {
            throw new Error("Failed to create streaming point buffers.");
        }

        this.positionBuffer = positionBuffer;
        this.colorBuffer = colorBuffer;

        this.program = this.createProgram(
            `
            attribute vec2 a_position;
            attribute vec4 a_color;
            varying vec4 v_color;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                gl_PointSize = 3.0;
                v_color = a_color;
            }
            `,
            `
            precision mediump float;
            varying vec4 v_color;
            void main() {
                vec2 p = gl_PointCoord - vec2(0.5);
                if (dot(p, p) > 0.25) discard;
                gl_FragColor = v_color;
            }
            `
        );

        this.positionLocation = gl.getAttribLocation(this.program, "a_position");
        this.colorLocation = gl.getAttribLocation(this.program, "a_color");

        // WebGL1 的 EXT_disjoint_timer_query：得到 GPU draw 时间。
        this.timerExt =
            gl.getExtension("EXT_disjoint_timer_query_webgl2") ??
            gl.getExtension("EXT_disjoint_timer_query");
    }

    allocate(): void {
        const gl = this.gl;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            this.capacity * 2 * Float32Array.BYTES_PER_ELEMENT,
            gl.DYNAMIC_DRAW
        );

        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            this.capacity * 4 * Uint8Array.BYTES_PER_ELEMENT,
            gl.DYNAMIC_DRAW
        );

        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        this.count = 0;
        this.gpuTimeMs = 0;
    }

    clear(): void {
        this.count = 0;
        this.gpuTimeMs = 0;
    }

    append(
        clipPositions: Float32Array,
        colors: Uint8Array
    ): number {
        const incoming = Math.floor(clipPositions.length / 2);
        if (incoming === 0) return 0;

        const available = this.capacity - this.count;
        const accepted = Math.min(incoming, available);
        if (accepted <= 0) return 0;

        const gl = this.gl;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferSubData(
            gl.ARRAY_BUFFER,
            this.count * 2 * Float32Array.BYTES_PER_ELEMENT,
            accepted === incoming
                ? clipPositions
                : clipPositions.subarray(0, accepted * 2)
        );

        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        gl.bufferSubData(
            gl.ARRAY_BUFFER,
            this.count * 4 * Uint8Array.BYTES_PER_ELEMENT,
            accepted === incoming
                ? colors
                : colors.subarray(0, accepted * 4)
        );

        this.count += accepted;
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        return accepted;
    }

    render(): void {
        if (this.count === 0) return;

        const gl = this.gl;
        gl.useProgram(this.program);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(this.positionLocation);
        gl.vertexAttribPointer(
            this.positionLocation, 2, gl.FLOAT, false, 0, 0
        );

        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        gl.enableVertexAttribArray(this.colorLocation);
        gl.vertexAttribPointer(
            this.colorLocation, 4, gl.UNSIGNED_BYTE, true, 0, 0
        );

        this.beginTimer();
        gl.drawArrays(gl.POINTS, 0, this.count);
        this.endTimer();

        gl.disableVertexAttribArray(this.positionLocation);
        gl.disableVertexAttribArray(this.colorLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        this.pollTimer();
    }

    getStats(): StreamingPointStats {
        return {
            count: this.count,
            capacity: this.capacity,
            gpuTimeMs: this.gpuTimeMs
        };
    }

    destroy(): void {
        this.gl.deleteBuffer(this.positionBuffer);
        this.gl.deleteBuffer(this.colorBuffer);
        this.gl.deleteProgram(this.program);
        this.count = 0;
    }

    private beginTimer(): void {
        const ext = this.timerExt;
        if (!ext || this.timerQuery) return;

        if (ext.createQueryEXT) {
            this.timerQuery = ext.createQueryEXT();
            ext.beginQueryEXT(ext.TIME_ELAPSED_EXT, this.timerQuery);
        } else {
            const glAny = this.gl as any;
            const query = glAny.createQuery?.();
            if (!query) return;
            this.timerQuery = query;
            (this.gl as any).beginQuery?.(ext.TIME_ELAPSED_EXT, query);
        }
    }

    private endTimer(): void {
        const ext = this.timerExt;
        if (!ext || !this.timerQuery) return;

        if (ext.endQueryEXT) {
            ext.endQueryEXT(ext.TIME_ELAPSED_EXT);
        } else {
            (this.gl as any).endQuery?.(ext.TIME_ELAPSED_EXT);
        }
    }

    private pollTimer(): void {
        const ext = this.timerExt;
        const query = this.timerQuery;
        if (!ext || !query) return;

        try {
            const available = ext.getQueryObjectEXT
                ? ext.getQueryObjectEXT(query, ext.QUERY_RESULT_AVAILABLE_EXT)
                : (this.gl as any).getQueryParameter?.(query, ext.QUERY_RESULT_AVAILABLE_EXT);

            if (!available) return;

            const disjoint = this.gl.getParameter(ext.GPU_DISJOINT_EXT);
            if (disjoint) {
                this.timerQuery = null;
                return;
            }

            const ns = ext.getQueryObjectEXT
                ? ext.getQueryObjectEXT(query, ext.QUERY_RESULT_EXT)
                : (this.gl as any).getQueryParameter?.(query, ext.QUERY_RESULT_EXT);

            if (typeof ns === "number") {
                this.gpuTimeMs = ns / 1_000_000;
            }

            this.timerQuery = null;
        } catch {
            this.timerQuery = null;
        }
    }

    private createShader(type: number, source: string): WebGLShader {
        const shader = this.gl.createShader(type);
        if (!shader) throw new Error("Failed to create shader.");
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);

        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            throw new Error(this.gl.getShaderInfoLog(shader) || "Shader compile failed.");
        }
        return shader;
    }

    private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
        const vertex = this.createShader(this.gl.VERTEX_SHADER, vertexSource);
        const fragment = this.createShader(this.gl.FRAGMENT_SHADER, fragmentSource);
        const program = this.gl.createProgram();
        if (!program) throw new Error("Failed to create program.");

        this.gl.attachShader(program, vertex);
        this.gl.attachShader(program, fragment);
        this.gl.linkProgram(program);

        this.gl.deleteShader(vertex);
        this.gl.deleteShader(fragment);

        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            throw new Error(this.gl.getProgramInfoLog(program) || "Program link failed.");
        }
        return program;
    }
}
