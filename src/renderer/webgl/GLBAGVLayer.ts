import type { AGVState } from "../../data/runtime/AGVRuntime";

interface GLTFBufferView {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    target?: number;
}

interface GLTFAccessor {
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
    normalized?: boolean;
}

interface GLTFPrimitive {
    attributes: Record<string, number>;
    indices?: number;
    material?: number;
    mode?: number;
}

interface GLTFMesh {
    primitives: GLTFPrimitive[];
}

interface GLTFNode {
    mesh?: number;
    children?: number[];
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
}

interface GLTFMaterial {
    doubleSided?: boolean;
    alphaMode?: string;
    alphaCutoff?: number;
    normalTexture?: {
        index: number;
        scale?: number;
    };
    pbrMetallicRoughness?: {
        baseColorFactor?: number[];
        baseColorTexture?: { index: number };
        metallicFactor?: number;
        roughnessFactor?: number;
        metallicRoughnessTexture?: { index: number };
    };
}

interface GLTFTexture {
    source?: number;
}

interface GLTFImage {
    bufferView?: number;
    mimeType?: string;
}

interface GLTFDocument {
    scene?: number;
    scenes: Array<{ nodes: number[] }>;
    nodes: GLTFNode[];
    meshes: GLTFMesh[];
    accessors: GLTFAccessor[];
    bufferViews: GLTFBufferView[];
    materials?: GLTFMaterial[];
    textures?: GLTFTexture[];
    images?: GLTFImage[];
}

interface MeshGPU {
    position: WebGLBuffer;
    normal: WebGLBuffer;
    tangent: WebGLBuffer | null;
    uv: WebGLBuffer | null;
    index: WebGLBuffer;
    indexCount: number;
    indexType: number;
    materialIndex: number;
}

interface MaterialGPU {
    color: [number, number, number, number];
    baseColorTexture: WebGLTexture | null;
    normalTexture: WebGLTexture | null;
    metallicRoughnessTexture: WebGLTexture | null;
    metallicFactor: number;
    roughnessFactor: number;
    alphaMode: string;
    alphaCutoff: number;
}

/**
 * 精确的屏幕投影：
 *  - agvPixel：AGV 地理位置对应的百度地图像素
 *  - eastBasis：本地东向 1m 在当前地图上的屏幕像素位移
 *  - northBasis：本地北向 1m 在当前地图上的屏幕像素位移
 *
 * 不再使用“mapCenter + pixelsPerMeter”的全局近似，从而避免拖动/缩放
 * 时出现模型轨迹漂移、拉伸和方向失真。
 */
export interface AGVProjection {
    agvPixelX: number;
    agvPixelY: number;
    eastBasisX: number;
    eastBasisY: number;
    northBasisX: number;
    northBasisY: number;
    viewportWidth: number;
    viewportHeight: number;
}

const vertexShaderSource = `
attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec4 a_tangent;
attribute vec2 a_uv;

uniform vec2 u_agvPixel;
uniform vec2 u_eastBasis;
uniform vec2 u_northBasis;
uniform vec2 u_viewport;
uniform float u_heading;
uniform float u_modelScale;
uniform float u_depthScale;

varying vec3 v_normal;
varying vec4 v_tangent;
varying vec2 v_uv;
varying float v_height;

void main() {
    float c = cos(u_heading);
    float s = sin(u_heading);

    vec3 p = a_position * u_modelScale;

    // glTF / Sketchfab 模型采用 Y-up；地面平面是 X-Z。
    float east = p.x * c - p.z * s;
    float north = p.x * s + p.z * c;

    // 根据百度实际像素基向量定位，不再假定屏幕轴与地理轴平行。
    vec2 screenPx =
        u_agvPixel +
        u_eastBasis * east +
        u_northBasis * north;

    float clipX =
        screenPx.x / u_viewport.x * 2.0 - 1.0;

    float clipY =
        1.0 - screenPx.y / u_viewport.y * 2.0;

    gl_Position = vec4(clipX, clipY, 0.0, 1.0);

    float nx = a_normal.x * c - a_normal.z * s;
    float nz = a_normal.x * s + a_normal.z * c;
    v_normal = normalize(vec3(nx, a_normal.y, nz));

    float tx = a_tangent.x * c - a_tangent.z * s;
    float tz = a_tangent.x * s + a_tangent.z * c;
    v_tangent = vec4(normalize(vec3(tx, a_tangent.y, tz)), a_tangent.w);

    v_uv = a_uv;
    v_height = p.y;
}
`;

const fragmentShaderSource = `
precision highp float;

varying vec3 v_normal;
varying vec4 v_tangent;
varying vec2 v_uv;
varying float v_height;

uniform vec4 u_baseColorFactor;
uniform sampler2D u_baseColorTexture;
uniform sampler2D u_normalTexture;
uniform sampler2D u_metallicRoughnessTexture;
uniform float u_hasBaseColorTexture;
uniform float u_hasNormalTexture;
uniform float u_hasMetallicRoughnessTexture;
uniform float u_metallicFactor;
uniform float u_roughnessFactor;
uniform float u_alphaModeMask;
uniform float u_alphaCutoff;

void main() {
    vec4 base = u_baseColorFactor;

    if (u_hasBaseColorTexture > 0.5) {
        base *= texture2D(u_baseColorTexture, v_uv);
    }

    if (u_alphaModeMask > 0.5 && base.a < u_alphaCutoff) {
        discard;
    }

    vec3 N = normalize(v_normal);

    if (u_hasNormalTexture > 0.5) {
        vec3 T = normalize(v_tangent.xyz);
        vec3 B = normalize(cross(N, T)) * v_tangent.w;
        vec3 tangentNormal = texture2D(u_normalTexture, v_uv).xyz * 2.0 - 1.0;
        N = normalize(T * tangentNormal.x + B * tangentNormal.y + N * tangentNormal.z);
    }

    // 轻量 glTF PBR：保留 BaseColor / Normal / Metallic-Roughness 的主要视觉特征。
    vec3 lightDir = normalize(vec3(-0.45, 0.80, 0.40));
    vec3 viewDir = normalize(vec3(0.0, 0.65, 0.76));
    vec3 halfDir = normalize(lightDir + viewDir);

    float NoL = max(dot(N, lightDir), 0.0);
    float NoV = max(dot(N, viewDir), 0.001);
    float NoH = max(dot(N, halfDir), 0.0);
    float VoH = max(dot(viewDir, halfDir), 0.0);

    float metallic = clamp(u_metallicFactor, 0.0, 1.0);
    float roughness = clamp(u_roughnessFactor, 0.04, 1.0);

    if (u_hasMetallicRoughnessTexture > 0.5) {
        vec4 mr = texture2D(u_metallicRoughnessTexture, v_uv);
        roughness *= mr.g;
        metallic *= mr.b;
    }

    float alphaRoughness = roughness * roughness;
    float alphaRoughness2 = alphaRoughness * alphaRoughness;
    float denom = NoH * NoH * (alphaRoughness2 - 1.0) + 1.0;
    float D = alphaRoughness2 / max(3.14159265 * denom * denom, 0.0001);

    float k = (roughness + 1.0);
    k = (k * k) / 8.0;
    float Gv = NoV / (NoV * (1.0 - k) + k);
    float Gl = NoL / (NoL * (1.0 - k) + k);
    float G = Gv * Gl;

    vec3 F0 = mix(vec3(0.04), base.rgb, metallic);
    float Fc = pow(1.0 - VoH, 5.0);
    vec3 F = F0 + (1.0 - F0) * Fc;

    vec3 specular = (D * G * F) / max(4.0 * NoV * NoL, 0.001);
    vec3 diffuse = (1.0 - F) * (1.0 - metallic) * base.rgb / 3.14159265;

    vec3 color = (diffuse + specular) * NoL;

    // 环境项，避免未被方向光照到的车体发黑。
    color += base.rgb * (0.12 + 0.10 * max(N.y, 0.0));

    // 简单近似 sRGB 输出。
    color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));

    gl_FragColor = vec4(color, base.a);
}
`;

export class GLBAGVLayer {
    private readonly gl: WebGLRenderingContext;
    private readonly program: WebGLProgram;

    private readonly positionLocation: number;
    private readonly normalLocation: number;
    private readonly tangentLocation: number;
    private readonly uvLocation: number;

    private readonly agvPixelLocation: WebGLUniformLocation;
    private readonly eastBasisLocation: WebGLUniformLocation;
    private readonly northBasisLocation: WebGLUniformLocation;
    private readonly viewportLocation: WebGLUniformLocation;
    private readonly headingLocation: WebGLUniformLocation;
    private readonly modelScaleLocation: WebGLUniformLocation;

    private readonly baseColorFactorLocation: WebGLUniformLocation;
    private readonly baseColorTextureLocation: WebGLUniformLocation;
    private readonly normalTextureLocation: WebGLUniformLocation;
    private readonly metallicRoughnessTextureLocation: WebGLUniformLocation;
    private readonly hasBaseColorTextureLocation: WebGLUniformLocation;
    private readonly hasNormalTextureLocation: WebGLUniformLocation;
    private readonly hasMetallicRoughnessTextureLocation: WebGLUniformLocation;
    private readonly metallicFactorLocation: WebGLUniformLocation;
    private readonly roughnessFactorLocation: WebGLUniformLocation;
    private readonly alphaModeMaskLocation: WebGLUniformLocation;
    private readonly alphaCutoffLocation: WebGLUniformLocation;

    private meshes: MeshGPU[] = [];
    private materials: MaterialGPU[] = [];
    private loaded = false;
    private loading = false;
    private loadError: string | null = null;
    private abortController: AbortController | null = null;

    /** 当前 GLB 已经经过节点层级变换；这里只处理米制比例。 */
    private readonly modelScale = 0.01;

    private state: AGVState = {
        id: "AGV-001",
        assetId: "agv-glb",
        x: 0,
        y: 0,
        heading: 0,
        speed: 8,
        state: "moving"
    };

    private running = false;
    private animationFrame = 0;
    private lastTimestamp = 0;
    private phase = 0;

    constructor(gl: WebGLRenderingContext) {
        this.gl = gl;

        const vertex = this.createShader(gl.VERTEX_SHADER, vertexShaderSource);
        const fragment = this.createShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
        this.program = this.createProgram(vertex, fragment);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);

        this.positionLocation = gl.getAttribLocation(this.program, "a_position");
        this.normalLocation = gl.getAttribLocation(this.program, "a_normal");
        this.tangentLocation = gl.getAttribLocation(this.program, "a_tangent");
        this.uvLocation = gl.getAttribLocation(this.program, "a_uv");

        this.agvPixelLocation = this.requireUniform("u_agvPixel");
        this.eastBasisLocation = this.requireUniform("u_eastBasis");
        this.northBasisLocation = this.requireUniform("u_northBasis");
        this.viewportLocation = this.requireUniform("u_viewport");
        this.headingLocation = this.requireUniform("u_heading");
        this.modelScaleLocation = this.requireUniform("u_modelScale");

        this.baseColorFactorLocation = this.requireUniform("u_baseColorFactor");
        this.baseColorTextureLocation = this.requireUniform("u_baseColorTexture");
        this.normalTextureLocation = this.requireUniform("u_normalTexture");
        this.metallicRoughnessTextureLocation = this.requireUniform("u_metallicRoughnessTexture");
        this.hasBaseColorTextureLocation = this.requireUniform("u_hasBaseColorTexture");
        this.hasNormalTextureLocation = this.requireUniform("u_hasNormalTexture");
        this.hasMetallicRoughnessTextureLocation = this.requireUniform("u_hasMetallicRoughnessTexture");
        this.metallicFactorLocation = this.requireUniform("u_metallicFactor");
        this.roughnessFactorLocation = this.requireUniform("u_roughnessFactor");
        this.alphaModeMaskLocation = this.requireUniform("u_alphaModeMask");
        this.alphaCutoffLocation = this.requireUniform("u_alphaCutoff");
    }

    async load(url: string): Promise<void> {
        if (this.loaded || this.loading) return;

        this.loading = true;
        this.loadError = null;
        this.abortController = new AbortController();

        try {
            const response = await fetch(url, {
                signal: this.abortController.signal,
                cache: "force-cache"
            });

            if (!response.ok) {
                throw new Error(`AGV GLB request failed: ${response.status} ${response.statusText}`);
            }

            const buffer = await response.arrayBuffer();
            const parsed = this.parseGLB(buffer);
            await this.buildGPUResources(parsed.json, parsed.binaryChunk);
            this.loaded = true;
            console.info(`AGV GLB geometry ready: ${this.meshes.length} primitives.`);
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                return;
            }

            this.loadError = error instanceof Error ? error.message : String(error);
            console.error("Failed to load AGV GLB:", error);
        } finally {
            this.loading = false;
            this.abortController = null;
        }
    }

    setState(state: Partial<AGVState>): void {
        this.state = { ...this.state, ...state };
    }

    getState(): AGVState {
        return { ...this.state };
    }

    isLoaded(): boolean {
        return this.loaded;
    }

    getLoadError(): string | null {
        return this.loadError;
    }

    startDemoMotion(render: () => void): void {
        if (this.running) return;

        this.running = true;
        this.lastTimestamp = performance.now();

        const tick = (timestamp: number) => {
            if (!this.running) return;

            const dt = Math.min(0.05, Math.max(0, (timestamp - this.lastTimestamp) / 1000));
            this.lastTimestamp = timestamp;
            this.phase += dt;

            const radiusX = 320;
            const radiusY = 140;
            const angle = this.phase * 0.12;

            this.state.x = Math.cos(angle) * radiusX;
            this.state.y = Math.sin(angle) * radiusY;

            const vx = -Math.sin(angle) * radiusX * 0.12;
            const vy = Math.cos(angle) * radiusY * 0.12;

            this.state.heading = Math.atan2(vy, vx);
            this.state.speed = 7 + 2 * Math.sin(this.phase * 0.35);
            this.state.state = "moving";

            render();
            this.animationFrame = requestAnimationFrame(tick);
        };

        this.animationFrame = requestAnimationFrame(tick);
    }

    stopDemoMotion(): void {
        this.running = false;
        if (this.animationFrame !== 0) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = 0;
        }
    }

    render(projection: AGVProjection): void {
        if (!this.loaded || this.meshes.length === 0) return;

        const gl = this.gl;
        gl.useProgram(this.program);

        gl.uniform2f(this.agvPixelLocation, projection.agvPixelX, projection.agvPixelY);
        gl.uniform2f(this.eastBasisLocation, projection.eastBasisX, projection.eastBasisY);
        gl.uniform2f(this.northBasisLocation, projection.northBasisX, projection.northBasisY);
        gl.uniform2f(this.viewportLocation, projection.viewportWidth, projection.viewportHeight);
        gl.uniform1f(this.headingLocation, this.state.heading);
        gl.uniform1f(this.modelScaleLocation, this.modelScale);

        gl.disable(gl.CULL_FACE);
        // Overlay 模式不与百度地图共享深度；模型本身不需要伪造地理 depth。
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);

        for (const mesh of this.meshes) {
            const material = this.materials[mesh.materialIndex] ?? this.materials[0];
            if (!material) continue;

            gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position);
            gl.enableVertexAttribArray(this.positionLocation);
            gl.vertexAttribPointer(this.positionLocation, 3, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normal);
            gl.enableVertexAttribArray(this.normalLocation);
            gl.vertexAttribPointer(this.normalLocation, 3, gl.FLOAT, false, 0, 0);

            if (mesh.tangent) {
                gl.bindBuffer(gl.ARRAY_BUFFER, mesh.tangent);
                gl.enableVertexAttribArray(this.tangentLocation);
                gl.vertexAttribPointer(this.tangentLocation, 4, gl.FLOAT, false, 0, 0);
            } else {
                gl.disableVertexAttribArray(this.tangentLocation);
                gl.vertexAttrib4f(this.tangentLocation, 1, 0, 0, 1);
            }

            if (mesh.uv) {
                gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uv);
                gl.enableVertexAttribArray(this.uvLocation);
                gl.vertexAttribPointer(this.uvLocation, 2, gl.FLOAT, false, 0, 0);
            } else {
                gl.disableVertexAttribArray(this.uvLocation);
                gl.vertexAttrib2f(this.uvLocation, 0, 0);
            }

            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);

            gl.uniform4fv(this.baseColorFactorLocation, material.color);
            gl.uniform1f(this.metallicFactorLocation, material.metallicFactor);
            gl.uniform1f(this.roughnessFactorLocation, material.roughnessFactor);
            gl.uniform1f(this.alphaModeMaskLocation, material.alphaMode === "MASK" ? 1 : 0);
            gl.uniform1f(this.alphaCutoffLocation, material.alphaCutoff);

            this.bindTexture(gl, 0, material.baseColorTexture, this.baseColorTextureLocation);
            this.bindTexture(gl, 1, material.normalTexture, this.normalTextureLocation);
            this.bindTexture(gl, 2, material.metallicRoughnessTexture, this.metallicRoughnessTextureLocation);

            gl.uniform1f(this.hasBaseColorTextureLocation, material.baseColorTexture ? 1 : 0);
            gl.uniform1f(this.hasNormalTextureLocation, material.normalTexture ? 1 : 0);
            gl.uniform1f(this.hasMetallicRoughnessTextureLocation, material.metallicRoughnessTexture ? 1 : 0);

            if (material.alphaMode === "BLEND") {
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            } else {
                gl.disable(gl.BLEND);
            }

            gl.drawElements(gl.TRIANGLES, mesh.indexCount, mesh.indexType, 0);
        }

        gl.disable(gl.BLEND);
        gl.depthMask(false);
        gl.disable(gl.DEPTH_TEST);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
        gl.useProgram(null);
    }

    destroy(): void {
        this.stopDemoMotion();
        this.abortController?.abort();

        const gl = this.gl;
        for (const mesh of this.meshes) {
            gl.deleteBuffer(mesh.position);
            gl.deleteBuffer(mesh.normal);
            if (mesh.tangent) gl.deleteBuffer(mesh.tangent);
            if (mesh.uv) gl.deleteBuffer(mesh.uv);
            gl.deleteBuffer(mesh.index);
        }

        for (const material of this.materials) {
            if (material.baseColorTexture) gl.deleteTexture(material.baseColorTexture);
            if (material.normalTexture) gl.deleteTexture(material.normalTexture);
            if (material.metallicRoughnessTexture) gl.deleteTexture(material.metallicRoughnessTexture);
        }

        gl.deleteProgram(this.program);
        this.meshes = [];
        this.materials = [];
        this.loaded = false;
    }

    private async buildGPUResources(json: GLTFDocument, binary: ArrayBuffer): Promise<void> {
        const gl = this.gl;
        const sourceMaterials = json.materials ?? [];

        this.materials = sourceMaterials.map((material, index) => ({
            color: this.getMaterialColor(material, index),
            baseColorTexture: null,
            normalTexture: null,
            metallicRoughnessTexture: null,
            metallicFactor: material.pbrMetallicRoughness?.metallicFactor ?? 1,
            roughnessFactor: material.pbrMetallicRoughness?.roughnessFactor ?? 1,
            alphaMode: material.alphaMode ?? "OPAQUE",
            alphaCutoff: material.alphaCutoff ?? 0.5
        }));

        if (this.materials.length === 0) {
            this.materials.push({
                color: [0.78, 0.82, 0.86, 1],
                baseColorTexture: null,
                normalTexture: null,
                metallicRoughnessTexture: null,
                metallicFactor: 0,
                roughnessFactor: 0.8,
                alphaMode: "OPAQUE",
                alphaCutoff: 0.5
            });
        }

        const sceneIndex = json.scene ?? 0;
        const scene = json.scenes[sceneIndex];
        const roots = scene?.nodes ?? [];
        const identity = this.identityMatrix();

        const visit = (nodeIndex: number, parent: number[]) => {
            const node = json.nodes[nodeIndex];
            const local = this.nodeMatrix(node);
            const world = this.multiplyMatrix(parent, local);

            if (node.mesh !== undefined) {
                const mesh = json.meshes[node.mesh];

                for (const primitive of mesh.primitives) {
                    if ((primitive.mode ?? 4) !== 4) continue;

                    const positionAccessor = primitive.attributes.POSITION;
                    const normalAccessor = primitive.attributes.NORMAL;
                    const tangentAccessor = primitive.attributes.TANGENT;
                    const uvAccessor = primitive.attributes.TEXCOORD_0;

                    if (
                        positionAccessor === undefined ||
                        normalAccessor === undefined ||
                        primitive.indices === undefined
                    ) {
                        continue;
                    }

                    const positions = this.readFloatAccessor(json, binary, positionAccessor, 3);
                    const normals = this.readFloatAccessor(json, binary, normalAccessor, 3);
                    const tangents = tangentAccessor !== undefined
                        ? this.readFloatAccessor(json, binary, tangentAccessor, 4)
                        : null;
                    const uv = uvAccessor !== undefined
                        ? this.readFloatAccessor(json, binary, uvAccessor, 2)
                        : null;
                    const indexInfo = this.readIndexAccessor(json, binary, primitive.indices);

                    const transformedPositions = new Float32Array(positions.length);
                    const transformedNormals = new Float32Array(normals.length);
                    const transformedTangents = tangents
                        ? new Float32Array(tangents.length)
                        : null;

                    for (let i = 0; i < positions.length; i += 3) {
                        const p = this.transformPoint(world, positions[i], positions[i + 1], positions[i + 2]);
                        transformedPositions[i] = p[0];
                        transformedPositions[i + 1] = p[1];
                        transformedPositions[i + 2] = p[2];

                        const n = this.transformDirection(world, normals[i], normals[i + 1], normals[i + 2]);
                        transformedNormals[i] = n[0];
                        transformedNormals[i + 1] = n[1];
                        transformedNormals[i + 2] = n[2];

                        if (transformedTangents && tangents) {
                            const t = this.transformDirection(world, tangents[i / 3 * 4], tangents[i / 3 * 4 + 1], tangents[i / 3 * 4 + 2]);
                            const handedness = tangents[i / 3 * 4 + 3];
                            transformedTangents[i / 3 * 4] = t[0];
                            transformedTangents[i / 3 * 4 + 1] = t[1];
                            transformedTangents[i / 3 * 4 + 2] = t[2];
                            transformedTangents[i / 3 * 4 + 3] = handedness;
                        }
                    }

                    this.meshes.push({
                        position: this.createArrayBuffer(transformedPositions),
                        normal: this.createArrayBuffer(transformedNormals),
                        tangent: transformedTangents ? this.createArrayBuffer(transformedTangents) : null,
                        uv: uv ? this.createArrayBuffer(uv) : null,
                        index: this.createIndexBuffer(indexInfo.data),
                        indexCount: indexInfo.data.length,
                        indexType: indexInfo.glType,
                        materialIndex: Math.max(0, primitive.material ?? 0)
                    });
                }
            }

            for (const child of node.children ?? []) {
                visit(child, world);
            }
        };

        for (const root of roots) {
            visit(root, identity);
        }

        if (this.meshes.length === 0) {
            throw new Error("AGV GLB contains no renderable triangle primitives.");
        }

        // Geometry 先进入 GPU，模型可以立即显示；材质纹理在后台渐进补齐。
        // 这样 69MB 的 GLB 不会因为 87 张纹理全部解码完成前而“整车隐身”。
        void this.loadMaterialTextures(json, binary).catch(error => {
            console.warn("AGV texture loading incomplete; geometry remains visible.", error);
        });

        gl.finish();
    }

    private async loadMaterialTextures(json: GLTFDocument, binary: ArrayBuffer): Promise<void> {
        const textures = json.textures ?? [];
        const images = json.images ?? [];

        const jobs = this.materials.map(async (materialGPU, materialIndex) => {
            const material = json.materials?.[materialIndex];
            if (!material) return;

            const baseColorIndex = material.pbrMetallicRoughness?.baseColorTexture?.index;
            const normalIndex = material.normalTexture?.index;
            const mrIndex = material.pbrMetallicRoughness?.metallicRoughnessTexture?.index;

            materialGPU.baseColorTexture = await this.createMaterialTexture(
                json, binary, textures, images, baseColorIndex
            );
            materialGPU.normalTexture = await this.createMaterialTexture(
                json, binary, textures, images, normalIndex
            );
            materialGPU.metallicRoughnessTexture = await this.createMaterialTexture(
                json, binary, textures, images, mrIndex
            );
        });

        await Promise.all(jobs);
    }

    private async createMaterialTexture(
        json: GLTFDocument,
        binary: ArrayBuffer,
        textures: GLTFTexture[],
        images: GLTFImage[],
        textureIndex?: number
    ): Promise<WebGLTexture | null> {
        if (textureIndex === undefined) return null;

        const imageIndex = textures[textureIndex]?.source;
        if (imageIndex === undefined) return null;

        const image = images[imageIndex];
        if (!image || image.bufferView === undefined) return null;

        const view = json.bufferViews[image.bufferView];
        if (!view) return null;

        const byteOffset = view.byteOffset ?? 0;
        const bytes = binary.slice(byteOffset, byteOffset + view.byteLength);

        try {
            const bitmap = await createImageBitmap(
                new Blob([bytes], { type: image.mimeType ?? "image/png" })
            );
            const texture = this.gl.createTexture();
            if (!texture) {
                bitmap.close();
                return null;
            }

            const gl = this.gl;
            gl.bindTexture(gl.TEXTURE_2D, texture);

            // glTF 2.0 纹理坐标不需要我们再额外做 WebGL Y 翻转。
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

            const isPowerOfTwo =
                (bitmap.width & (bitmap.width - 1)) === 0 &&
                (bitmap.height & (bitmap.height - 1)) === 0;

            if (isPowerOfTwo) {
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
            } else {
                // WebGL1 的 NPOT 纹理不能使用 REPEAT + mipmap。
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            }

            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);

            if (isPowerOfTwo) {
                gl.generateMipmap(gl.TEXTURE_2D);
            }

            gl.bindTexture(gl.TEXTURE_2D, null);

            bitmap.close();
            return texture;
        } catch (error) {
            console.warn("AGV material texture could not be decoded.", error);
            return null;
        }
    }

    private bindTexture(
        gl: WebGLRenderingContext,
        unit: number,
        texture: WebGLTexture | null,
        location: WebGLUniformLocation
    ): void {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(location, unit);
    }

    private parseGLB(buffer: ArrayBuffer): { json: GLTFDocument; binaryChunk: ArrayBuffer } {
        if (buffer.byteLength < 20) throw new Error("Invalid GLB: file is too small.");

        const view = new DataView(buffer);
        const magic = view.getUint32(0, true);
        const version = view.getUint32(4, true);
        const length = view.getUint32(8, true);

        if (magic !== 0x46546c67) throw new Error("Invalid GLB magic.");
        if (version !== 2) throw new Error(`Unsupported GLB version: ${version}`);
        if (length > buffer.byteLength) throw new Error("Invalid GLB length.");

        let offset = 12;
        let json: GLTFDocument | null = null;
        let binaryChunk = new ArrayBuffer(0);

        while (offset + 8 <= length) {
            const chunkLength = view.getUint32(offset, true);
            const chunkType = view.getUint32(offset + 4, true);
            offset += 8;

            if (offset + chunkLength > length) {
                throw new Error("Invalid GLB chunk range.");
            }

            const chunk = buffer.slice(offset, offset + chunkLength);

            if (chunkType === 0x4e4f534a) {
                const jsonText = new TextDecoder().decode(chunk);
                json = JSON.parse(jsonText.trim());
            } else if (chunkType === 0x004e4942) {
                binaryChunk = chunk;
            }

            offset += chunkLength;
        }

        if (!json) throw new Error("GLB JSON chunk is missing.");

        return { json, binaryChunk };
    }

    private readFloatAccessor(
        json: GLTFDocument,
        binary: ArrayBuffer,
        accessorIndex: number,
        expectedComponents: number
    ): Float32Array {
        const accessor = json.accessors[accessorIndex];
        if (!accessor || accessor.bufferView === undefined) {
            throw new Error(`GLB accessor ${accessorIndex} does not contain a bufferView.`);
        }

        if (accessor.componentType !== 5126) {
            throw new Error(`Expected FLOAT accessor, got ${accessor.componentType}.`);
        }

        const componentCount = this.componentCount(accessor.type);
        if (componentCount !== expectedComponents) {
            throw new Error(`Accessor ${accessorIndex} expected ${expectedComponents} components, got ${componentCount}.`);
        }

        const view = json.bufferViews[accessor.bufferView];
        if (!view) throw new Error(`GLB bufferView ${accessor.bufferView} is missing.`);

        const baseOffset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
        const count = accessor.count * componentCount;
        const raw = new Float32Array(binary, baseOffset, count).slice();

        // 当前模型使用 FLOAT；normalized 只保留接口语义，后续可继续扩展。
        return raw;
    }

    private readIndexAccessor(
        json: GLTFDocument,
        binary: ArrayBuffer,
        accessorIndex: number
    ): { data: Uint16Array | Uint32Array; glType: number } {
        const accessor = json.accessors[accessorIndex];
        if (!accessor || accessor.bufferView === undefined) {
            throw new Error(`GLB index accessor ${accessorIndex} is missing.`);
        }

        const view = json.bufferViews[accessor.bufferView];
        if (!view) throw new Error(`GLB bufferView ${accessor.bufferView} is missing.`);

        const baseOffset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);

        if (accessor.type !== "SCALAR") {
            throw new Error("GLB indices must use SCALAR accessors.");
        }

        if (accessor.componentType === 5123) {
            return {
                data: new Uint16Array(binary, baseOffset, accessor.count).slice(),
                glType: this.gl.UNSIGNED_SHORT
            };
        }

        if (accessor.componentType === 5125) {
            const extension = this.gl.getExtension("OES_element_index_uint");
            if (!extension) {
                throw new Error("WebGL extension OES_element_index_uint is required by agv.glb.");
            }

            return {
                data: new Uint32Array(binary, baseOffset, accessor.count).slice(),
                glType: this.gl.UNSIGNED_INT
            };
        }

        throw new Error(`Unsupported GLB index component type: ${accessor.componentType}`);
    }

    private createArrayBuffer(data: Float32Array): WebGLBuffer {
        const buffer = this.gl.createBuffer();
        if (!buffer) throw new Error("Failed to create GLB vertex buffer.");

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.STATIC_DRAW);
        return buffer;
    }

    private createIndexBuffer(data: Uint16Array | Uint32Array): WebGLBuffer {
        const buffer = this.gl.createBuffer();
        if (!buffer) throw new Error("Failed to create GLB index buffer.");

        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, buffer);
        this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, data, this.gl.STATIC_DRAW);
        return buffer;
    }

    private getMaterialColor(material: GLTFMaterial, index: number): [number, number, number, number] {
        const factor = material.pbrMetallicRoughness?.baseColorFactor;
        if (factor && factor.length >= 4) {
            return [factor[0], factor[1], factor[2], factor[3]];
        }

        const palette: Array<[number, number, number, number]> = [
            [0.72, 0.76, 0.80, 1],
            [0.90, 0.68, 0.12, 1],
            [0.18, 0.20, 0.22, 1],
            [0.80, 0.82, 0.84, 1]
        ];

        return palette[index % palette.length];
    }

    private nodeMatrix(node: GLTFNode): number[] {
        if (node.matrix && node.matrix.length === 16) {
            return node.matrix.slice();
        }

        const t = node.translation ?? [0, 0, 0];
        const r = node.rotation ?? [0, 0, 0, 1];
        const s = node.scale ?? [1, 1, 1];
        const [x, y, z, w] = r;
        const xx = x * x;
        const yy = y * y;
        const zz = z * z;
        const xy = x * y;
        const xz = x * z;
        const yz = y * z;
        const wx = w * x;
        const wy = w * y;
        const wz = w * z;

        return [
            (1 - 2 * (yy + zz)) * s[0],
            (2 * (xy + wz)) * s[0],
            (2 * (xz - wy)) * s[0],
            0,
            (2 * (xy - wz)) * s[1],
            (1 - 2 * (xx + zz)) * s[1],
            (2 * (yz + wx)) * s[1],
            0,
            (2 * (xz + wy)) * s[2],
            (2 * (yz - wx)) * s[2],
            (1 - 2 * (xx + yy)) * s[2],
            0,
            t[0],
            t[1],
            t[2],
            1
        ];
    }

    private multiplyMatrix(a: number[], b: number[]): number[] {
        const out = new Array<number>(16).fill(0);

        for (let column = 0; column < 4; column++) {
            for (let row = 0; row < 4; row++) {
                out[column * 4 + row] =
                    a[row] * b[column * 4] +
                    a[4 + row] * b[column * 4 + 1] +
                    a[8 + row] * b[column * 4 + 2] +
                    a[12 + row] * b[column * 4 + 3];
            }
        }

        return out;
    }

    private transformPoint(m: number[], x: number, y: number, z: number): [number, number, number] {
        return [
            m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14]
        ];
    }

    private transformDirection(m: number[], x: number, y: number, z: number): [number, number, number] {
        const nx = m[0] * x + m[4] * y + m[8] * z;
        const ny = m[1] * x + m[5] * y + m[9] * z;
        const nz = m[2] * x + m[6] * y + m[10] * z;
        const length = Math.hypot(nx, ny, nz) || 1;

        return [nx / length, ny / length, nz / length];
    }

    private identityMatrix(): number[] {
        return [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ];
    }

    private createShader(type: number, source: string): WebGLShader {
        const shader = this.gl.createShader(type);
        if (!shader) throw new Error("Failed to create GLB shader.");

        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);

        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            const info = this.gl.getShaderInfoLog(shader) ?? "unknown";
            this.gl.deleteShader(shader);
            throw new Error(`GLB shader compilation failed: ${info}`);
        }

        return shader;
    }

    private createProgram(vertex: WebGLShader, fragment: WebGLShader): WebGLProgram {
        const program = this.gl.createProgram();
        if (!program) throw new Error("Failed to create GLB shader program.");

        this.gl.attachShader(program, vertex);
        this.gl.attachShader(program, fragment);
        this.gl.linkProgram(program);

        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            const info = this.gl.getProgramInfoLog(program) ?? "unknown";
            this.gl.deleteProgram(program);
            throw new Error(`GLB program link failed: ${info}`);
        }

        return program;
    }

    private requireUniform(name: string): WebGLUniformLocation {
        const location = this.gl.getUniformLocation(this.program, name);
        if (!location) throw new Error(`GLB uniform '${name}' was not found.`);
        return location;
    }

    private componentCount(type: string): number {
        switch (type) {
            case "SCALAR": return 1;
            case "VEC2": return 2;
            case "VEC3": return 3;
            case "VEC4": return 4;
            case "MAT2": return 4;
            case "MAT3": return 9;
            case "MAT4": return 16;
            default: throw new Error(`Unsupported accessor type: ${type}`);
        }
    }
}
