interface BenchmarkRequest {
    type: "generate";
    start: number;
    count: number;
    total: number;
    seed: number;
    extent: { minX: number; maxX: number; minY: number; maxY: number };
}

/**
 * 生成“混合空间数据”Chunk：
 * 40% Point、35% Line、25% Polygon。
 * 每个对象最终展开为最多 6 个顶点，便于统一走一次 GPU draw。
 * 这不是单纯的百万点测试，而是模拟港口真实空间数据流。
 */
self.onmessage = (event: MessageEvent<BenchmarkRequest>) => {
    const r = event.data;
    if (r.type !== "generate") return;

    let seed = (r.seed + Math.imul(r.start + 1, 2654435761)) >>> 0;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };

    const positions = new Float32Array(r.count * 6 * 2);
    const colors = new Uint8Array(r.count * 6 * 4);
    const primitives = new Uint8Array(r.count * 6);
    const width = r.extent.maxX - r.extent.minX;
    const height = r.extent.maxY - r.extent.minY;

    const setVertex = (v: number, x: number, y: number, color: [number, number, number, number], primitive: number) => {
        positions[v * 2] = x;
        positions[v * 2 + 1] = y;
        colors[v * 4] = color[0];
        colors[v * 4 + 1] = color[1];
        colors[v * 4 + 2] = color[2];
        colors[v * 4 + 3] = color[3];
        primitives[v] = primitive;
    };

    for (let i = 0; i < r.count; i++) {
        const objectIndex = r.start + i;
        const x = r.extent.minX + random() * width;
        const y = r.extent.minY + random() * height;
        const type = objectIndex % 20 < 8 ? 0 : objectIndex % 20 < 15 ? 1 : 2;
        const base = i * 6;

        // Point：用一个 6 顶点小六边形模拟真实可见 Point sprite。
        if (type === 0) {
            const s = 7 + random() * 5;
            const c: [number, number, number, number] = [70, 190, 255, 215];
            setVertex(base, x - s, y, c, 0); setVertex(base + 1, x, y - s, c, 0); setVertex(base + 2, x + s, y, c, 0);
            setVertex(base + 3, x + s, y, c, 0); setVertex(base + 4, x, y + s, c, 0); setVertex(base + 5, x - s, y, c, 0);
        }
        // Line：用 2D 小矩形近似一段道路/轨迹线，6 vertices。
        else if (type === 1) {
            const len = 35 + random() * 100;
            const angle = random() * Math.PI * 2;
            const dx = Math.cos(angle) * len * 0.5;
            const dy = Math.sin(angle) * len * 0.5;
            const px = -Math.sin(angle) * 2.2;
            const py = Math.cos(angle) * 2.2;
            const ax = x - dx, ay = y - dy, bx = x + dx, by = y + dy;
            const c: [number, number, number, number] = [255, 177, 65, 205];
            setVertex(base, ax + px, ay + py, c, 1); setVertex(base + 1, ax - px, ay - py, c, 1); setVertex(base + 2, bx + px, by + py, c, 1);
            setVertex(base + 3, bx + px, by + py, c, 1); setVertex(base + 4, ax - px, ay - py, c, 1); setVertex(base + 5, bx - px, by - py, c, 1);
        }
        // Polygon：生成一个旋转矩形，代表堆场/作业区/建筑 footprint。
        else {
            const w = 20 + random() * 90;
            const h = 20 + random() * 70;
            const angle = random() * Math.PI;
            const ca = Math.cos(angle), sa = Math.sin(angle);
            const corners = [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([cx, cy]) => [x + cx*ca-cy*sa, y + cx*sa+cy*ca]);
            const c: [number, number, number, number] = [105, 230, 150, 125];
            setVertex(base, corners[0][0], corners[0][1], c, 2); setVertex(base + 1, corners[1][0], corners[1][1], c, 2); setVertex(base + 2, corners[2][0], corners[2][1], c, 2);
            setVertex(base + 3, corners[0][0], corners[0][1], c, 2); setVertex(base + 4, corners[2][0], corners[2][1], c, 2); setVertex(base + 5, corners[3][0], corners[3][1], c, 2);
        }
    }

    self.postMessage({
        type: "generated",
        start: r.start,
        count: r.count,
        positions: positions.buffer,
        colors: colors.buffer,
        primitives: primitives.buffer
    }, [positions.buffer, colors.buffer, primitives.buffer]);
};
