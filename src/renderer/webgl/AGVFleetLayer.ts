import { CoordinateSystem, type GeoPoint } from "../../map/CoordinateSystem";
import { AGVFleetRuntime, type AGVPhase, type AGVRuntimeState } from "../../data/runtime/AGVFleetRuntime";
import { AGVSimulationSource, type AGVDefinition } from "../../data/source/AGVSimulationSource";
import { YangshanPhase4Network, type XY } from "../../simulation/yangshan/YangshanPhase4Network";
import { GLBAGVLayer, type AGVProjection } from "./GLBAGVLayer";

interface FleetProjection {
    width: number;
    height: number;
}

interface RGBA {
    r: number;
    g: number;
    b: number;
    a: number;
}

const phaseColor: Record<AGVPhase, RGBA> = {
    QUAY_PICKUP: { r: 0.20, g: 0.92, b: 0.42, a: 0.95 },
    YARD_STACK: { r: 1.00, g: 0.67, b: 0.15, a: 0.95 },
    PARKING: { r: 0.20, g: 0.58, b: 1.00, a: 0.95 },
    CHARGING: { r: 0.40, g: 0.72, b: 1.00, a: 0.98 },
    RETURN_QUAY: { r: 0.85, g: 0.36, b: 0.95, a: 0.92 }
};

const lineVertex = `
attribute vec2 a_position;
attribute vec4 a_color;
varying vec4 v_color;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_color = a_color;
}
`;

const lineFragment = `
precision mediump float;
varying vec4 v_color;
void main() {
    gl_FragColor = v_color;
}
`;

const markerVertex = `
attribute vec2 a_position;
attribute vec4 a_color;
varying vec4 v_color;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_color = a_color;
}
`;

const markerFragment = `
precision mediump float;
varying vec4 v_color;
void main() {
    gl_FragColor = v_color;
}
`;

export class AGVFleetLayer {
    private readonly gl: WebGLRenderingContext;
    private readonly coordinateSystem: CoordinateSystem;
    private readonly source: AGVSimulationSource;
    private readonly network = new YangshanPhase4Network();
    private readonly runtime: AGVFleetRuntime;
    private readonly glbLayer: GLBAGVLayer;

    private readonly lineProgram: WebGLProgram;
    private readonly markerProgram: WebGLProgram;
    private readonly linePositionLocation: number;
    private readonly lineColorLocation: number;
    private readonly markerPositionLocation: number;
    private readonly markerColorLocation: number;
    private readonly routeBuffer: WebGLBuffer;
    private readonly markerBuffer: WebGLBuffer;

    private loaded = false;
    private loadError: string | null = null;
    private animationFrame = 0;
    private lastTime = 0;
    private redraw: (() => void) | null = null;
    private projectionDirty = true;
    private projectedNetwork: Float32Array = new Float32Array();
    private projectedRoutes: Float32Array = new Float32Array();
    private selectedIndex = 77;
    private elapsed = 0;

    constructor(
        gl: WebGLRenderingContext,
        origin: GeoPoint,
        source = new AGVSimulationSource()
    ) {
        this.gl = gl;
        this.coordinateSystem = new CoordinateSystem(origin);
        this.runtime = new AGVFleetRuntime(this.coordinateSystem);
        this.source = source;

        this.lineProgram = this.createProgram(lineVertex, lineFragment);
        this.markerProgram = this.createProgram(markerVertex, markerFragment);

        this.linePositionLocation = gl.getAttribLocation(this.lineProgram, "a_position");
        this.lineColorLocation = gl.getAttribLocation(this.lineProgram, "a_color");
        this.markerPositionLocation = gl.getAttribLocation(this.markerProgram, "a_position");
        this.markerColorLocation = gl.getAttribLocation(this.markerProgram, "a_color");

        const routeBuffer = gl.createBuffer();
        const markerBuffer = gl.createBuffer();
        if (!routeBuffer || !markerBuffer) {
            throw new Error("Failed to create AGV fleet buffers.");
        }
        this.routeBuffer = routeBuffer;
        this.markerBuffer = markerBuffer;
        this.glbLayer = new GLBAGVLayer(gl);
    }


    async load(): Promise<void> {
        if (this.loaded || this.loadError) return;
        try {
            const dataset = await this.source.load();
            const definitions = dataset.vehicles as AGVDefinition[];
            if (definitions.length !== 155) {
                throw new Error(`Expected 155 AGVs, received ${definitions.length}.`);
            }
            this.runtime.load(definitions);

            // 实际 3D Asset：只渲染一台代表性 AGV-001，155 台车仍由 Runtime
            // 驱动位置与全周期路线；后续可将这一层升级为 GPU Instancing。
            void this.glbLayer.load("/assets/agv/agv.glb").then(() => {
                this.redraw?.();
            });

            this.loaded = true;
            this.projectionDirty = true;
            this.redraw?.();
        } catch (error) {
            this.loadError = error instanceof Error ? error.message : String(error);
            console.error("AGV fleet load failed:", error);
        }
    }

    start(redraw: () => void): void {
        this.redraw = redraw;
        if (this.animationFrame) return;
        this.lastTime = performance.now();
        const loop = (now: number) => {
            const dt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
            this.lastTime = now;
            if (this.loaded) {
                this.elapsed += dt;
                this.runtime.update(dt);
            }
            this.animationFrame = window.requestAnimationFrame(loop);
            redraw();
        };
        this.animationFrame = window.requestAnimationFrame(loop);
    }

    pause(): void {
        this.runtime.setRunning(false);
    }

    resume(): void {
        this.runtime.setRunning(true);
    }

    toggle(): boolean {
        const running = !this.runtime.isRunning();
        this.runtime.setRunning(running);
        return running;
    }

    setSimulationSpeed(value: number): void {
        this.runtime.setSimulationSpeed(value);
    }

    onCameraChanged(): void {
        this.projectionDirty = true;
    }

    getState(): AGVRuntimeState | null {
        return this.runtime.vehicles[this.selectedIndex]?.state ?? null;
    }

    getStats() {
        return {
            ...this.runtime.getStats(),
            loaded: this.loaded,
            error: this.loadError,
            simulationRunning: this.runtime.isRunning(),
            simulationSpeed: this.runtime.getSimulationSpeed(),
            modelLoaded: this.glbLayer.isLoaded(),
            modelError: this.glbLayer.getLoadError()
        };
    }

    getNetwork() {
        return this.network;
    }

    render(
        map: BMapGL.Map,
        projection: FleetProjection
    ): void {
        if (!this.loaded) return;
        if (this.projectionDirty) {
            this.rebuildProjectedRoutes(map, projection);
            this.projectionDirty = false;
        }

        const gl = this.gl;
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);

        // 道路网络：暗色细线。
        this.drawColoredLineBuffer(this.projectedNetwork);

        // 所有 AGV 的完整计划路径：非常淡的蓝/绿线，便于展示“每车有独立路线”。
        this.drawColoredLineBuffer(
            this.projectedRoutes
        );

        // 选中 AGV 的当前完整周期路线用高亮颜色再次绘制，
        // 让“岸桥 → 堆场 → 停车 → 补能 → 返回岸桥”在卫星图上清晰可见。
        const selectedRoute = this.buildSelectedRouteBuffer(map, projection);
        this.drawColoredLineBuffer(selectedRoute);

        const markerData = this.buildMarkerBuffer(map, projection);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.markerBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, markerData, gl.DYNAMIC_DRAW);

        gl.useProgram(this.markerProgram);
        gl.enableVertexAttribArray(this.markerPositionLocation);
        gl.vertexAttribPointer(this.markerPositionLocation, 2, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(this.markerColorLocation);
        gl.vertexAttribPointer(this.markerColorLocation, 4, gl.FLOAT, false, 24, 8);
        gl.drawArrays(gl.TRIANGLES, 0, markerData.length / 6);
        gl.disableVertexAttribArray(this.markerPositionLocation);
        gl.disableVertexAttribArray(this.markerColorLocation);

        // 真实 GLB 模型：仅显示当前选中的代表性 AGV，避免 155 个独立 Mesh
        // 在浏览器端产生大量 draw call。其余车辆以轻量 GPU marker 表示。
        const selected = this.runtime.vehicles[this.selectedIndex]?.state;
        if (selected) {
            this.glbLayer.setState({
                id: selected.id,
                assetId: "agv-glb",
                x: selected.x,
                y: selected.y,
                heading: selected.heading,
                speed: selected.speed,
                state: selected.phase === "PARKING" || selected.phase === "CHARGING" ? "idle" : "moving"
            });

            gl.clear(gl.DEPTH_BUFFER_BIT);
            const glbProjection = this.buildGLBProjection(map, projection, selected.x, selected.y);
            this.glbLayer.render(glbProjection);
        }
    }

    destroy(): void {
        if (this.animationFrame) {
            window.cancelAnimationFrame(this.animationFrame);
            this.animationFrame = 0;
        }
        this.glbLayer.destroy();
        this.gl.deleteBuffer(this.routeBuffer);
        this.gl.deleteBuffer(this.markerBuffer);
        this.gl.deleteProgram(this.lineProgram);
        this.gl.deleteProgram(this.markerProgram);
        this.redraw = null;
    }

    private rebuildProjectedRoutes(
        map: BMapGL.Map,
        projection: FleetProjection
    ): void {
        const networkVertices: number[] = [];
        const routeVertices: number[] = [];

        for (const lane of this.network.lanes) {
            const points = lane.map(point => this.projectLocal(map, point, projection));
            for (let i = 1; i < points.length; i++) {
                this.pushSegment(networkVertices, points[i - 1], points[i], { r: 0.12, g: 0.52, b: 0.92, a: 0.45 });
            }
        }

        for (const vehicle of this.runtime.vehicles) {
            const allPoints = vehicle.segments.flatMap(segment => segment.points);
            const colors = vehicle.segments.flatMap(segment =>
                segment.points.map(() => phaseColor[segment.phase])
            );
            for (let i = 1; i < allPoints.length; i++) {
                const p0 = this.projectLocal(map, allPoints[i - 1], projection);
                const p1 = this.projectLocal(map, allPoints[i], projection);
                const color = colors[Math.min(i, colors.length - 1)];
                this.pushSegment(routeVertices, p0, p1, {
                    r: color.r * 0.8,
                    g: color.g * 0.8,
                    b: color.b * 0.95,
                    a: 0.60
                });
            }
        }

        this.projectedNetwork = new Float32Array(networkVertices);
        this.projectedRoutes = new Float32Array(routeVertices);
    }

    private buildSelectedRouteBuffer(
        map: BMapGL.Map,
        projection: FleetProjection
    ): Float32Array {
        const selectedVehicle = this.runtime.vehicles[this.selectedIndex];
        if (!selectedVehicle) return new Float32Array();

        const out: number[] = [];
        for (const segment of selectedVehicle.segments) {
            for (let i = 1; i < segment.points.length; i++) {
                const a = this.projectLocal(map, segment.points[i - 1], projection);
                const b = this.projectLocal(map, segment.points[i], projection);
                const c = phaseColor[segment.phase];
                this.pushSegment(out, a, b, {
                    r: c.r,
                    g: c.g,
                    b: c.b,
                    a: 0.95
                });
            }
        }
        return new Float32Array(out);
    }

    private buildGLBProjection(
        map: BMapGL.Map,
        projection: FleetProjection,
        x: number,
        y: number
    ): AGVProjection {
        const geo = this.coordinateSystem.localToGeo({ x, y, z: 0 });
        const center = map.getCenter();
        const centerPixel = map.pointToPixel(new BMapGL.Point(center.lng, center.lat));
        const agvPixel = map.pointToPixel(new BMapGL.Point(geo.longitude, geo.latitude));

        const probeMeters = 16;
        const east = this.coordinateSystem.localToGeo({ x: x + probeMeters, y, z: 0 });
        const north = this.coordinateSystem.localToGeo({ x, y: y + probeMeters, z: 0 });
        const eastPixel = map.pointToPixel(new BMapGL.Point(east.longitude, east.latitude));
        const northPixel = map.pointToPixel(new BMapGL.Point(north.longitude, north.latitude));

        return {
            agvPixelX: projection.width * 0.5 + (agvPixel.x - centerPixel.x),
            agvPixelY: projection.height * 0.5 + (agvPixel.y - centerPixel.y),
            eastBasisX: (eastPixel.x - agvPixel.x) / probeMeters,
            eastBasisY: (eastPixel.y - agvPixel.y) / probeMeters,
            northBasisX: (northPixel.x - agvPixel.x) / probeMeters,
            northBasisY: (northPixel.y - agvPixel.y) / probeMeters,
            viewportWidth: Math.max(1, projection.width),
            viewportHeight: Math.max(1, projection.height)
        };
    }

    private buildMarkerBuffer(
        map: BMapGL.Map,
        projection: FleetProjection
    ): Float32Array {
        const output: number[] = [];
        const vehicleSize = 10;

        for (let i = 0; i < this.runtime.vehicles.length; i++) {
            const vehicle = this.runtime.vehicles[i];
            const state = vehicle.state;
            const center = this.projectLocal(map, { x: state.x, y: state.y }, projection);
            const next = this.projectLocal(map, {
                x: state.x + Math.cos(state.heading) * 2,
                y: state.y + Math.sin(state.heading) * 2
            }, projection);

            const dx = next.x - center.x;
            const dy = next.y - center.y;
            const length = Math.max(Math.hypot(dx, dy), 0.0001);
            const ux = dx / length;
            const uy = dy / length;
            const vx = -uy;
            const vy = ux;

            const front = {
                x: center.x + ux * vehicleSize,
                y: center.y + uy * vehicleSize
            };
            const rear = {
                x: center.x - ux * vehicleSize * 0.82,
                y: center.y - uy * vehicleSize * 0.82
            };
            const bodyLeft = {
                x: center.x + vx * vehicleSize * 0.52,
                y: center.y + vy * vehicleSize * 0.52
            };
            const bodyRight = {
                x: center.x - vx * vehicleSize * 0.52,
                y: center.y - vy * vehicleSize * 0.52
            };

            const color = phaseColor[state.phase];
            const alpha = i === this.selectedIndex ? 1 : 0.88;
            this.pushOrientedQuad(output, front, rear, bodyLeft, bodyRight, { ...color, a: alpha });

            // 顶部驾驶/升降平台，用白色小块表现 AGV 的设备结构。
            const cabinCenter = {
                x: center.x + ux * 1.4,
                y: center.y + uy * 1.4
            };
            const cabinLength = 4.2;
            const cabinWidth = 2.7;
            const cabinFront = {
                x: cabinCenter.x + ux * cabinLength,
                y: cabinCenter.y + uy * cabinLength
            };
            const cabinRear = {
                x: cabinCenter.x - ux * cabinLength,
                y: cabinCenter.y - uy * cabinLength
            };
            const cabinLeft = {
                x: cabinCenter.x + vx * cabinWidth,
                y: cabinCenter.y + vy * cabinWidth
            };
            const cabinRight = {
                x: cabinCenter.x - vx * cabinWidth,
                y: cabinCenter.y - vy * cabinWidth
            };
            this.pushOrientedQuad(output, cabinFront, cabinRear, cabinLeft, cabinRight, {
                r: 0.92, g: 0.96, b: 1.0, a: i === this.selectedIndex ? 0.96 : 0.72
            });

            if (i === this.selectedIndex) {
                const s = 3.0;
                this.pushQuad(output,
                    { x: center.x - s, y: center.y - s },
                    { x: center.x + s, y: center.y - s },
                    { x: center.x + s, y: center.y + s },
                    { x: center.x - s, y: center.y + s },
                    { r: 1, g: 1, b: 1, a: 0.22 }
                );
            }
        }

        return new Float32Array(output);
    }

    private projectLocal(
        map: BMapGL.Map,
        local: XY,
        projection: FleetProjection
    ): { x: number; y: number } {
        const geo = this.coordinateSystem.localToGeo({ x: local.x, y: local.y, z: 0 });
        const center = map.getCenter();
        const centerPixel = map.pointToPixel(
            new BMapGL.Point(center.lng, center.lat)
        );
        const pixel = map.pointToPixel(
            new BMapGL.Point(geo.longitude, geo.latitude)
        );

        // BMapGL 的 pointToPixel 在不同地图状态下可能携带内部世界像素偏移。
        // 使用“相对地图中心”的像素距离，保证 overlay 与地图视口坐标一致。
        const viewportX = projection.width * 0.5 + (pixel.x - centerPixel.x);
        const viewportY = projection.height * 0.5 + (pixel.y - centerPixel.y);

        return {
            x: (viewportX / projection.width) * 2 - 1,
            y: 1 - (viewportY / projection.height) * 2
        };
    }

    private drawColoredLineBuffer(data: Float32Array): void {
        const gl = this.gl;
        if (data.length === 0) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.routeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        gl.useProgram(this.lineProgram);
        gl.enableVertexAttribArray(this.linePositionLocation);
        gl.vertexAttribPointer(this.linePositionLocation, 2, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(this.lineColorLocation);
        gl.vertexAttribPointer(this.lineColorLocation, 4, gl.FLOAT, false, 24, 8);
        gl.lineWidth(2);
        gl.drawArrays(gl.LINES, 0, data.length / 6);
        gl.disableVertexAttribArray(this.linePositionLocation);
        gl.disableVertexAttribArray(this.lineColorLocation);
    }

    private pushSegment(out: number[], a: { x: number; y: number }, b: { x: number; y: number }, color: RGBA): void {
        out.push(a.x, a.y, color.r, color.g, color.b, color.a);
        out.push(b.x, b.y, color.r, color.g, color.b, color.a);
    }

    private pushTriangle(out: number[], a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, color: RGBA): void {
        out.push(a.x, a.y, color.r, color.g, color.b, color.a);
        out.push(b.x, b.y, color.r, color.g, color.b, color.a);
        out.push(c.x, c.y, color.r, color.g, color.b, color.a);
    }

    private pushOrientedQuad(
        out: number[],
        front: { x: number; y: number },
        rear: { x: number; y: number },
        left: { x: number; y: number },
        right: { x: number; y: number },
        color: RGBA
    ): void {
        const halfWidthX = left.x - ((front.x + rear.x) * 0.5);
        const halfWidthY = left.y - ((front.y + rear.y) * 0.5);
        const center = { x: (front.x + rear.x) * 0.5, y: (front.y + rear.y) * 0.5 };
        const lf = { x: front.x + halfWidthX, y: front.y + halfWidthY };
        const rf = { x: front.x - halfWidthX, y: front.y - halfWidthY };
        const lr = { x: rear.x + halfWidthX, y: rear.y + halfWidthY };
        const rr = { x: rear.x - halfWidthX, y: rear.y - halfWidthY };
        void center;
        void right;
        this.pushQuad(out, lf, rf, rr, lr, color);
    }

    private pushQuad(out: number[], a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }, color: RGBA): void {
        this.pushTriangle(out, a, b, c, color);
        this.pushTriangle(out, a, c, d, color);
    }

    private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
        const gl = this.gl;
        const compile = (type: number, source: string): WebGLShader => {
            const shader = gl.createShader(type);
            if (!shader) throw new Error("Failed to create AGV shader.");
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                const log = gl.getShaderInfoLog(shader) ?? "Unknown shader error.";
                gl.deleteShader(shader);
                throw new Error(log);
            }
            return shader;
        };
        const vs = compile(gl.VERTEX_SHADER, vertexSource);
        const fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
        const program = gl.createProgram();
        if (!program) throw new Error("Failed to create AGV shader program.");
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(program) ?? "Unknown link error.";
            gl.deleteProgram(program);
            throw new Error(log);
        }
        return program;
    }
}

