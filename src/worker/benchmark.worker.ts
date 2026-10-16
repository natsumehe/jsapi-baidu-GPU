interface BenchmarkRequest {
    type: "generate";
    start: number;
    count: number;
    total: number;
    seed: number;
    extent: { minX: number; maxX: number; minY: number; maxY: number };
}

/**
 * 生成竞赛基准数据。
 *
 * 每个 chunk 内部严格按 Point -> Line -> Polygon 排列，保证渲染器可以
 * 用 3 个 primitive batch 完成整块数据提交，而不是每个对象一次 draw call。
 */
self.onmessage = (event: MessageEvent<BenchmarkRequest>) => {
    const r = event.data;
    if (r.type !== "generate") return;

    let seed = (r.seed + Math.imul(r.start + 1, 2654435761)) >>> 0;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };

    const points: number[] = [];
    const pointColors: number[] = [];
    const lines: number[] = [];
    const lineColors: number[] = [];
    const polygons: number[] = [];
    const polygonColors: number[] = [];
    const width = r.extent.maxX - r.extent.minX;
    const height = r.extent.maxY - r.extent.minY;

    const push = (
        target: number[],
        colors: number[],
        x: number,
        y: number,
        color: [number, number, number, number]
    ) => {
        target.push(x, y);
        colors.push(...color);
    };

    for (let i = 0; i < r.count; i++) {
        const objectIndex = r.start + i;
        const x = r.extent.minX + random() * width;
        const y = r.extent.minY + random() * height;
        const type = objectIndex % 20 < 8 ? 0 : objectIndex % 20 < 15 ? 1 : 2;

        if (type === 0) {
            push(points, pointColors, x, y, [70, 190, 255, 215]);
            continue;
        }

        if (type === 1) {
            const len = 35 + random() * 100;
            const angle = random() * Math.PI * 2;
            const dx = Math.cos(angle) * len * 0.5;
            const dy = Math.sin(angle) * len * 0.5;
            push(lines, lineColors, x - dx, y - dy, [255, 177, 65, 205]);
            push(lines, lineColors, x + dx, y + dy, [255, 177, 65, 205]);
            continue;
        }

        const w = 20 + random() * 90;
        const h = 20 + random() * 70;
        const angle = random() * Math.PI;
        const ca = Math.cos(angle);
        const sa = Math.sin(angle);
        const corners = [
            [-w / 2, -h / 2],
            [w / 2, -h / 2],
            [w / 2, h / 2],
            [-w / 2, h / 2]
        ].map(([cx, cy]) => [x + cx * ca - cy * sa, y + cx * sa + cy * ca]);
        const c: [number, number, number, number] = [105, 230, 150, 125];
        push(polygons, polygonColors, corners[0][0], corners[0][1], c);
        push(polygons, polygonColors, corners[1][0], corners[1][1], c);
        push(polygons, polygonColors, corners[2][0], corners[2][1], c);
        push(polygons, polygonColors, corners[0][0], corners[0][1], c);
        push(polygons, polygonColors, corners[2][0], corners[2][1], c);
        push(polygons, polygonColors, corners[3][0], corners[3][1], c);
    }

    const positions = new Float32Array([...points, ...lines, ...polygons]);
    const colors = new Uint8Array([...pointColors, ...lineColors, ...polygonColors]);
    const pointVertexCount = points.length / 2;
    const lineVertexCount = lines.length / 2;
    const primitives = new Uint8Array(positions.length / 2);
    primitives.fill(0, 0, pointVertexCount);
    primitives.fill(1, pointVertexCount, pointVertexCount + lineVertexCount);
    primitives.fill(2, pointVertexCount + lineVertexCount);

    self.postMessage({
        type: "generated",
        start: r.start,
        count: r.count,
        positions: positions.buffer,
        colors: colors.buffer,
        primitives: primitives.buffer
    }, [positions.buffer, colors.buffer, primitives.buffer]);
};
