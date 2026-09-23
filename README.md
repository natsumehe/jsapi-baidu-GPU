# 洋山港四期 · AGV 运行态势（Free Space Streaming / TOS Cargo Lifecycle）

基于 **百度地图 JSAPI 4.0 (BMapGL) + WebGL/WebGPU** 的港口 AGV 运行态势可视化 Demo。
在真实地图底图之上叠加 155 台 AGV 的全生命周期运行轨迹、集装箱装卸交接动画，
以及可流式加载的空间 Tile 数据管线。

> 纯前端项目（`vite` + `TypeScript`），无后端。所有数据均为**合成演示数据**，
> 位于 `public/data/` 下，运行时通过 HTTP 直接读取。

---

## 快速开始

前置要求：**Node.js ≥ 18**（已在 Node 24 上验证）。

```bash
# 1. 安装依赖（node_modules 已随包提供，可跳过）
npm install

# 2. 启动开发服务器（默认 http://localhost:5173）
npm run dev

# 3. 生产构建（输出到 dist/）
npm run build

# 4. 预览生产构建
npm run preview
```

启动后浏览器打开 `http://localhost:5173`。页面顶部中央的状态条会依次显示：

```
页面正在启动 → 渲染链路已启动 · Baidu Map + GIS + 155 AGV
```

出现后者即代表整条渲染链路（地图 + GIS + AGV 车队）已就绪。

### 需要联网

`index.html` 通过 `<script>` 引入百度地图 JSAPI（含内置 AK）：

```html
<script src="https://api.map.baidu.com/api?v=4.0&ak=..."></script>
```

因此**首次加载需要能访问 `api.map.baidu.com`**。若地图底图空白，多为网络/AK 问题，
但 AGV/GIS 叠加层被设计为**独立降级**——即使空间 Tile 或 WebGPU 不可用，车队叠加层仍会渲染。

---

## npm 脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器（HMR），监听 `0.0.0.0:5173` |
| `npm run build` | `tsc` 类型检查 + `vite build` 生产打包到 `dist/` |
| `npm run preview` | 本地预览 `dist/` 产物 |
| `npm run wasm:build` | 用 Emscripten 编译 `wasm-src/`（可选，需自备 emcc 工具链） |

---

## 目录结构

```
├─ index.html                 # 入口页面 + 全部 HUD（态势面板 / 图例 / 数据表）
├─ vite.config.ts             # Vite 配置（端口 5173、ES2022、Worker=ES module）
├─ tsconfig.json              # 严格模式 TypeScript
├─ src/                       # 前端渲染 / 数据管线源码（消费层）
├─ public/                    # 运行时静态资源，Vite 原样映射到 URL 根
│  ├─ assets/agv/             # AGV 三维模型（agv.glb）+ manifest
│  └─ data/                   # GIS / 仿真 / Tile 数据（见下）
├─ simulation/yangshan_phase4/# 独立的仿真 / 数据生产层（可重新生成数据）
├─ scripts/                   # GIS 配准 / 路线生成脚本
├─ performance/               # FPS 监控 + 流式渲染 Benchmark
├─ wasm-src/                  # 空间计算 WASM 源码（C++/CMake，可选）
└─ docs/                      # 详细文档（见 docs/README.md）
```

数据目录 `public/data/`：

| 路径 | 内容 |
| --- | --- |
| `gis/*.geojson` | 集装箱堆场、道路、运营 Polygon、岸桥点（含 `_derived` 派生几何） |
| `simulation/yangshan_phase4/` | AGV 车队、GIS 约束路线、时序轨迹、TOS 作业箱信息表 |
| `tiles/{z}/{x}/{y}.bin` | 合成的空间点云二进制 Tile（流式管线演示） |
| `assets/agv/agv.glb` | AGV 三维模型 |

---

## 详细文档

完整的架构说明、数据流、生命周期状态机与二次开发指南见 **[`docs/README.md`](docs/README.md)**。

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 渲染链路与模块职责
- [`docs/DATA.md`](docs/DATA.md) — 数据格式、来源与重新生成
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — 本地开发、构建、排错

---

## 免责声明

本项目所有 AGV 轨迹、TOS 作业记录、道路中心线均为**根据卫星影像结构建立的演示级合成数据**，
不代表洋山港四期官方生产数据或真实车道中心线。地图底图 AK 仅用于本 Demo 演示。
