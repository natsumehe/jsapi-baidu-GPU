export interface StreamingSpatialStats {
    objects: number;
    vertices: number;
    capacityVertices: number;
    gpuTimeMs: number;
    drawCalls: number;
    bufferUploadMs: number;
    bufferBytes: number;
    pointObjects: number;
    lineObjects: number;
    polygonObjects: number;
}

/**
 * 竞赛核心 GPU Batch：
 *
 * 1. Position/Color VBO 预分配；
 * 2. chunk 到达后只做 bufferSubData；
 * 3. Point / Line / Polygon 使用不同 primitive mode；
 * 4. 每帧按照固定 batch 大小拆分 draw call，避免 500K/1M 一次提交压垮浏览器；
 * 5. 统计 Buffer Upload、Draw Call、GPU Timer，直接用于性能报告。
 */
export class StreamingSpatialLayer {
    private readonly positionBuffer: WebGLBuffer;
    private readonly colorBuffer: WebGLBuffer;
    private readonly program: WebGLProgram;
    private readonly positionLocation: number;
    private readonly colorLocation: number;
    private readonly capacityVertices: number;
    private vertexCount = 0;
    private objectCount = 0;
    private pointObjects = 0;
    private lineObjects = 0;
    private polygonObjects = 0;
    private drawCalls = 0;
    // Each Worker chunk is independently Point→Line→Polygon sorted.
    // Keep per-chunk ranges rather than incorrectly assuming globally sorted primitives.
    private readonly drawSegments: Array<{ mode: number; first: number; count: number }> = [];
    private bufferUploadMs = 0;
    private bufferBytes = 0;
    private timerExt: any = null;
    private timerQuery: any = null;
    private gpuTimeMs = 0;
    private readonly maxVerticesPerDraw = 60_000;

    constructor(
        private readonly gl: WebGLRenderingContext,
        objectCapacity: number
    ) {
        // Point=1, Line=2, Polygon=6 vertices. Reserve the conservative maximum.
        this.capacityVertices = Math.max(1, objectCapacity * 6);
        const positionBuffer = gl.createBuffer();
        const colorBuffer = gl.createBuffer();
        if (!positionBuffer || !colorBuffer) throw new Error("Failed to create streaming spatial buffers.");
        this.positionBuffer = positionBuffer;
        this.colorBuffer = colorBuffer;
        this.program = this.createProgram();
        this.positionLocation = gl.getAttribLocation(this.program, "a_position");
        this.colorLocation = gl.getAttribLocation(this.program, "a_color");
        this.timerExt = gl.getExtension("EXT_disjoint_timer_query_webgl2") ?? gl.getExtension("EXT_disjoint_timer_query");
    }

    allocate(): void {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.capacityVertices * 2 * 4, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.capacityVertices * 4, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        this.vertexCount = 0;
        this.objectCount = 0;
        this.pointObjects = 0;
        this.lineObjects = 0;
        this.polygonObjects = 0;
        this.drawSegments.length = 0;
        this.drawCalls = 0;
        this.bufferUploadMs = 0;
        this.bufferBytes = 0;
        this.gpuTimeMs = 0;
    }

    append(
        positions: Float32Array,
        colors: Uint8Array,
        primitives: Uint8Array,
        objects: number
    ): number {
        const incomingVertices = Math.floor(positions.length / 2);
        const accepted = Math.min(incomingVertices, this.capacityVertices - this.vertexCount);
        if (accepted <= 0) return 0;

        const gl = this.gl;
        const started = performance.now();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferSubData(
            gl.ARRAY_BUFFER,
            this.vertexCount * 2 * 4,
            positions.subarray(0, accepted * 2)
        );
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        gl.bufferSubData(
            gl.ARRAY_BUFFER,
            this.vertexCount * 4,
            colors.subarray(0, accepted * 4)
        );
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        this.bufferUploadMs += performance.now() - started;
        this.bufferBytes += accepted * (2 * 4 + 4);
        const firstVertex = this.vertexCount;
        this.vertexCount += accepted;
        let segmentStart = 0;
        while (segmentStart < accepted) {
            const primitive = primitives[segmentStart] ?? 0;
            let segmentEnd = segmentStart + 1;
            while (segmentEnd < accepted && primitives[segmentEnd] === primitive) segmentEnd++;
            // The source is primitive-grouped per chunk; drawing uses these exact ranges.
            this.drawSegments.push({
                mode: primitive === 0 ? gl.POINTS : primitive === 1 ? gl.LINES : gl.TRIANGLES,
                first: firstVertex + segmentStart,
                count: segmentEnd - segmentStart
            });
            segmentStart = segmentEnd;
        }

        // Benchmark worker arranges Point -> Line -> Polygon. Count complete objects
        // from the primitive stream so a partially accepted final chunk cannot inflate metrics.
        let p = 0;
        while (p < accepted) {
            const type = primitives[p] ?? 0;
            const stride = type === 0 ? 1 : type === 1 ? 2 : 6;
            const end = Math.min(accepted, p + stride);
            if (end - p === stride) {
                if (type === 0) this.pointObjects++;
                else if (type === 1) this.lineObjects++;
                else this.polygonObjects++;
            }
            p = end;
        }
        this.objectCount = this.pointObjects + this.lineObjects + this.polygonObjects;
        return accepted;
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

        this.drawCalls = 0;
        this.beginTimer();
        // Correct for any number of independent Worker chunks.
        for (const segment of this.drawSegments) {
            this.drawBatched(segment.mode, segment.first, segment.count);
        }
        this.endTimer();
        this.pollTimer();

        gl.disableVertexAttribArray(this.positionLocation);
        gl.disableVertexAttribArray(this.colorLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    getStats(): StreamingSpatialStats {
        return {
            objects: this.objectCount,
            vertices: this.vertexCount,
            capacityVertices: this.capacityVertices,
            gpuTimeMs: this.gpuTimeMs,
            drawCalls: this.drawCalls,
            bufferUploadMs: this.bufferUploadMs,
            bufferBytes: this.bufferBytes,
            pointObjects: this.pointObjects,
            lineObjects: this.lineObjects,
            polygonObjects: this.polygonObjects
        };
    }

    destroy(): void {
        this.gl.deleteBuffer(this.positionBuffer);
        this.gl.deleteBuffer(this.colorBuffer);
        this.gl.deleteProgram(this.program);
    }

    private drawBatched(mode: number, offset: number, count: number): number {
        for (let cursor = 0; cursor < count; cursor += this.maxVerticesPerDraw) {
            const batch = Math.min(this.maxVerticesPerDraw, count - cursor);
            this.gl.drawArrays(mode, offset + cursor, batch);
            this.drawCalls++;
        }
        return offset + count;
    }

    private createProgram(): WebGLProgram {
        const gl = this.gl;
        const compile = (type: number, source: string): WebGLShader => {
            const shader = gl.createShader(type);
            if (!shader) throw new Error("Failed to create shader.");
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                const log = gl.getShaderInfoLog(shader);
                gl.deleteShader(shader);
                throw new Error(log || "Shader compile failed.");
            }
            return shader;
        };
        const vertex = compile(gl.VERTEX_SHADER, `
            attribute vec2 a_position;
            attribute vec4 a_color;
            varying vec4 v_color;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                gl_PointSize = 4.0;
                v_color = a_color;
            }
        `);
        const fragment = compile(gl.FRAGMENT_SHADER, `
            precision mediump float;
            varying vec4 v_color;
            void main() {
                gl_FragColor = v_color;
            }
        `);
        const program = gl.createProgram();
        if (!program) throw new Error("Failed to create WebGL program.");
        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error(log || "Program link failed.");
        }
        return program;
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
            if (this.gl.getParameter(ext.GPU_DISJOINT_EXT)) {
                this.timerQuery = null;
                return;
            }
            const ns = ext.getQueryObjectEXT
                ? ext.getQueryObjectEXT(query, ext.QUERY_RESULT_EXT)
                : (this.gl as any).getQueryParameter?.(query, ext.QUERY_RESULT_EXT);
            if (typeof ns === "number") this.gpuTimeMs = ns / 1_000_000;
            this.timerQuery = null;
        } catch {
            this.timerQuery = null;
        }
    }
}
