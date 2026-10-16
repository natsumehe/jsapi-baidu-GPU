# 海量空间数据实验平台 · V9 当前技术架构

> 架构决策：地图 / GPU / 数据职责分层；原港口场景和独立空间实验室是不同入口。

- 港口主场景：`src/main.ts` → `PortApplication` → `SpatialEngine`。
- 独立实验室：`lab/main.mjs` → `LabBenchmark` → `dataset` / `WebGPU` / `WebGL`。
- Baidu JSAPI 提供地图，WebGL 提供图形，WebGPU 提供可选计算策略。
- 数据流单向传递，Worker/渲染耗时向调度反馈。
- 真实 GPU 性能待浏览器实测。

详细文档见仓库 `docs/CODE_ARCHITECTURE.md`。
