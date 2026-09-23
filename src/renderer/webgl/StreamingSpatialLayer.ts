export interface StreamingSpatialStats {
    objects: number;
    vertices: number;
    capacityVertices: number;
    gpuTimeMs: number;
}

/**
 * 海量空间数据流式渲染层。
 * 一个 chunk 可以同时包含 Point / Line / Polygon，全部使用增量 bufferSubData 上传。
 * Polygon 采用三角形列表；Line 使用 GL_LINES；Point 使用 GL_POINTS。
 */
export class StreamingSpatialLayer {
    private readonly positionBuffer: WebGLBuffer;
    private readonly colorBuffer: WebGLBuffer;
    private readonly primitiveBuffer: WebGLBuffer;
    private readonly program: WebGLProgram;
    private readonly positionLocation: number;
    private readonly colorLocation: number;
    private readonly primitiveLocation: number;
    private readonly capacityVertices: number;
    private vertexCount = 0;
    private objectCount = 0;
    private timerExt: any = null;
    private timerQuery: any = null;
    private gpuTimeMs = 0;
    // Keep a single frame from monopolizing the GPU driver when the benchmark grows to 500K/1M objects.
    // The complete buffer is still resident; it is submitted as several draw batches.
    private readonly maxVerticesPerDraw = 120_000;

    constructor(private readonly gl: WebGLRenderingContext, objectCapacity: number) {
        this.capacityVertices = Math.max(1, objectCapacity * 6);
        const positionBuffer = gl.createBuffer();
        const colorBuffer = gl.createBuffer();
        const primitiveBuffer = gl.createBuffer();
        if (!positionBuffer || !colorBuffer || !primitiveBuffer) {
            throw new Error("Failed to create streaming spatial buffers.");
        }
        this.positionBuffer = positionBuffer;
        this.colorBuffer = colorBuffer;
        this.primitiveBuffer = primitiveBuffer;

        this.program = this.createProgram(`
            attribute vec2 a_position;
            attribute vec4 a_color;
            attribute float a_primitive;
            varying vec4 v_color;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_color = a_color;
                gl_PointSize = 3.0;
            }
        `, `
            precision mediump float;
            varying vec4 v_color;
            void main() {
                gl_FragColor = v_color;
            }
        `);

        this.positionLocation = gl.getAttribLocation(this.program, "a_position");
        this.colorLocation = gl.getAttribLocation(this.program, "a_color");
        this.primitiveLocation = gl.getAttribLocation(this.program, "a_primitive");
        this.timerExt =
            gl.getExtension("EXT_disjoint_timer_query_webgl2") ??
            gl.getExtension("EXT_disjoint_timer_query");
    }

    allocate(): void {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.capacityVertices * 2 * 4, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.capacityVertices * 4, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.primitiveBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.capacityVertices, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        this.vertexCount = 0;
        this.objectCount = 0;
        this.gpuTimeMs = 0;
    }

    append(positions: Float32Array, colors: Uint8Array, primitives: Uint8Array, objects: number): number {
        const incomingVertices = Math.floor(positions.length / 2);
        const acceptedVertices = Math.min(incomingVertices, this.capacityVertices - this.vertexCount);
        if (acceptedVertices <= 0) return 0;
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, this.vertexCount * 2 * 4, positions.subarray(0, acceptedVertices * 2));
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, this.vertexCount * 4, colors.subarray(0, acceptedVertices * 4));
        gl.bindBuffer(gl.ARRAY_BUFFER, this.primitiveBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, this.vertexCount, primitives.subarray(0, acceptedVertices));
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        this.vertexCount += acceptedVertices;
        this.objectCount += objects;
        // Rendering is intentionally scheduled by the benchmark pipeline after the chunk arrives.
        // Avoid an immediate render here to prevent duplicate full-buffer draws per chunk.
        return acceptedVertices;
    }

    render(): void {
        if (this.vertexCount === 0) return;
        const gl = this.gl;
        gl.useProgram(this.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(this.positionLocation);
        gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        gl.enableVertexAttribArray(this.colorLocation);
        gl.vertexAttribPointer(this.colorLocation, 4, gl.UNSIGNED_BYTE, true, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.primitiveBuffer);
        gl.enableVertexAttribArray(this.primitiveLocation);
        gl.vertexAttribPointer(this.primitiveLocation, 1, gl.UNSIGNED_BYTE, false, 0, 0);

        this.beginTimer();
        // Worker 按对象类型连续排列：Point、Line、Polygon。
        // 仍然统一使用 TRIANGLES，但在大规模数据下拆成多个 draw batch。
        // 这样 100K/500K/1M 不会因为一次超大的 drawArrays 把浏览器主循环拖住。
        for (let offset = 0; offset < this.vertexCount; offset += this.maxVerticesPerDraw) {
            const count = Math.min(this.maxVerticesPerDraw, this.vertexCount - offset);
            gl.drawArrays(gl.TRIANGLES, offset, count);
        }
        this.endTimer();
        this.pollTimer();

        gl.disableVertexAttribArray(this.positionLocation);
        gl.disableVertexAttribArray(this.colorLocation);
        gl.disableVertexAttribArray(this.primitiveLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    getStats(): StreamingSpatialStats {
        return { objects: this.objectCount, vertices: this.vertexCount, capacityVertices: this.capacityVertices, gpuTimeMs: this.gpuTimeMs };
    }

    destroy(): void {
        const gl = this.gl;
        gl.deleteBuffer(this.positionBuffer);
        gl.deleteBuffer(this.colorBuffer);
        gl.deleteBuffer(this.primitiveBuffer);
        gl.deleteProgram(this.program);
    }

    private beginTimer(): void {
        const ext = this.timerExt;
        if (!ext || this.timerQuery) return;
        if (ext.createQueryEXT) {
            this.timerQuery = ext.createQueryEXT();
            ext.beginQueryEXT(ext.TIME_ELAPSED_EXT, this.timerQuery);
        } else {
            const query = (this.gl as any).createQuery?.();
            if (!query) return;
            this.timerQuery = query;
            (this.gl as any).beginQuery?.(ext.TIME_ELAPSED_EXT, query);
        }
    }

    private endTimer(): void {
        const ext = this.timerExt;
        if (!ext || !this.timerQuery) return;
        if (ext.endQueryEXT) ext.endQueryEXT(ext.TIME_ELAPSED_EXT);
        else (this.gl as any).endQuery?.(ext.TIME_ELAPSED_EXT);
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
            if (this.gl.getParameter(ext.GPU_DISJOINT_EXT)) { this.timerQuery = null; return; }
            const ns = ext.getQueryObjectEXT
                ? ext.getQueryObjectEXT(query, ext.QUERY_RESULT_EXT)
                : (this.gl as any).getQueryParameter?.(query, ext.QUERY_RESULT_EXT);
            if (typeof ns === "number") this.gpuTimeMs = ns / 1_000_000;
            this.timerQuery = null;
        } catch { this.timerQuery = null; }
    }

    private createProgram(vs: string, fs: string): WebGLProgram {
        const gl = this.gl;
        const compile = (type: number, source: string) => {
            const shader = gl.createShader(type);
            if (!shader) throw new Error("Failed to create shader");
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                const log = gl.getShaderInfoLog(shader);
                gl.deleteShader(shader);
                throw new Error(log || "Shader compile failed");
            }
            return shader;
        };
        const program = gl.createProgram();
        if (!program) throw new Error("Failed to create program");
        const vertex = compile(gl.VERTEX_SHADER, vs);
        const fragment = compile(gl.FRAGMENT_SHADER, fs);
        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error(log || "Program link failed");
        }
        return program;
    }
}
