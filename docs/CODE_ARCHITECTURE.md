# V9 代码架构与设计模式索引

> 海量空间数据实验平台 · 当前有效结构（不含 V1–V8 历史发布笔记）

![系统架构](diagrams/system.svg)

## 架构决策

1. **场景只定义负载**：港口模型、AGV、堆场数据均由 `src/simulation/`、`src/data/runtime/` 驱动，空间处理算法不依赖港口实体的业务属性。
2. **分层**：入口/展示 → 应用协调 → 空间数据与计算 → 地图/渲染 Adapter → 指标与回归。
3. **两个入口**：`/` 使用百度 JSAPI 主场景及 `SpatialEngine`；`/lab.html` 使用独立、可离线复现的 `lab/` 模块。尚未共享全部加载实现，不声称完全统一。
4. **地图、计算和渲染三种 Adapter**：Baidu JSAPI 负责地理坐标与相机；WebGPU 用于计算策略；WebGL 绘制图元，三个模块不互为替代。
5. **数据单向 + 控制反馈**：空间数据单向送 GPU；应用统计网络读取、Worker 吞吐及帧耗时，反向调整分块或触发重绘。
6. **结果完整记录**：A/B/E/C/D 显示真实设备支持情况；WebGPU 不可用即标记 N/A，不转用 CPU 冒称 GPU 结果。

## 目录 → 职责 → 关键调用

| 模块 | 文件入口 | 代码关系 |
|---|---|---|
| 主应用 | `src/main.ts` | 加载百度 JSAPI 后初始化 `PortApplication` |
| 主场景编排 | `src/app/PortApplication.ts` | 初始化 `BaiduMap`、`SpatialEngine`、FPSMonitor；TOS 插件默认关闭 |
| 地图适配 | `src/map/BaiduMap.ts`, `BaiduWebGLLayerAdapter.ts` | 地图视角/图层与 WebGL 叠加 |
| 空间引擎 | `src/engine/SpatialEngine.ts` | TileSelector → Pipeline → Worker/WASM → Buffer/Overlay |
| 空间索引 | `src/spatial/` | QuadTree、可视 Tile 选择 |
| 数据管道 | `src/data/pipeline`, `src/data/scheduler` | 下载/解码、任务优先级、取消/背压 |
| 运行时 | `src/data/runtime/AGVFleetRuntime.ts` | 每车路径、运动学、避让、历史轨迹 |
| 港区路网 | `src/simulation/yangshan/YangshanPhase4Network.ts` | 多对多岸桥/Gantry 候选图与几何约束 |
| 港口渲染 | `src/renderer/webgl/AGVWorldOverlay.ts` | 轨迹、GLB、箱堆、点击高亮 |
| CPU/WebGPU | `src/renderer/webgpu/` | 可选 WebGPU AABB；失败 fallback 必须显式报告 |
| 独立实验室 | `lab/main.mjs` | 创建 Renderer、Benchmark、Map 与 HTTP 流组件 |
| 生成数据 | `lab/dataset.mjs` + `dataset.worker.mjs` | 可复现 point/line/polygon 数据 |
| 实验编排 | `lab/benchmark.mjs` | A/B/E/C/D 参数、数据块、指标、取消 |
| 实验图元 | `lab/renderer.mjs` | `POINTS`/`LINES`/`TRIANGLES` 与 VBO |
| WebGPU | `lab/gpu.mjs` | Compute、GPU 结果回读、计算墙钟时间 |
| 地图混合 | `lab/map.mjs` | Offline / Baidu、变换、相机/视口 |
| HTTP 流 | `lab/http-stream.mjs`、`stream-codec.mjs` | `ReadableStream` 分片解码与增量上传 |
| 验证 | `tests/*.test.mjs` | 路网几何、点线面、Worker 流、AGV 与配置 |

## AGV 单车执行路径

```text
停车位 / 当前任务终点
    ↓
AGVFleetRuntime.dispatchTask()
    ↓
chooseVariant() → findQuayPath() / corridorCost()
    ↓
QUAY_PICKUP → YARD_STACK → RETURN_QUAY → RETURN_BUFFER
    ↓
运动学 stepVehicle() / 车身占地避让
    ↓
AGVWorldOverlay 绘图；对象点击读取状态与历史
```

路线为合成 GIS 约束路线，不是测绘真实单向车道；不具备工业级交通安全认证。

## 分块实验执行路径

```text
固定 seed / size / geometry
  ├── A: MainThread → WebGL（批量）
  ├── B: Worker → WebGL（流式）
  ├── E: Worker → CPU AABB → WebGL
  ├── C: Worker → WebGPU AABB → readback → CPU compact → WebGL
  └── D: C + 自适应 Chunk 预算
```

注意 C 和 D 的 GPU 回读与 CPU compact 不是零成本；和 E 的公平对照必须比较端到端。`lab/benchmark.mjs` 的 Chunk 反馈只是受限的负载调节原型，尚非完整分布式调度或生产环境 Tile LOD 反馈器。

## 需要避免的架构误解

- 业务港口工作流不是 JSAPI/WebGPU 系统的控制核心。
- WebGPU 与 JSAPI 不是两种可以相互替换的 SDK；负责不同层面。
- `.glb` 港口模型场景与 `lab.html` 百万抽象点线面实验的性能口径不同。
- 实验室中只在初次计算裁剪视口，C/D 不具备任意地图漫游自动补齐全部剔除对象的生产能力。
- `reports/node-data-benchmark.json` 仅为 Node CPU/Worker 生成基准，不代表浏览器 GPU 性能。

## 旧 MD 的整理原则

本提交副本仅保留一个根 `README.md`、本技术索引、可复现实验协议、作品说明书和视频脚本。旧的 `RELEASE_V4.md`、`RELEASE_V8.md`、`RELEASE_V9.md`、`README_COMPETITION.md` 以及各轮临时架构与回归 Markdown 不再放入当前提交树。Git 原有提交历史无需删除。

为兼容已有 UTF-8 测试，`public/docs/ARCHITECTURE_TECHNICAL.md` 作为当前说明的精简公开副本保留；`public/architecture.html` 是实验室“架构文档”的可浏览 HTML 入口。
