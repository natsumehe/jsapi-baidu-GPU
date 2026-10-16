# V9 性能实验与复现协议

## 适用范围

本协议面向 **Point / LineString / Polygon / Mixed** 抽象数据实验，不将港口 3D 模型 FPS、Node 生成时延和浏览器 WebGPU 计算时延混为一谈。

## 矩阵

| 实验 | 线程 | 计算 | 上传与呈现 |
|---|---|---|---|
| A | Main | 无裁剪 | WebGL，批量后绘制 |
| B | Worker | 无裁剪 | WebGL，逐块绘制 |
| E | Worker | CPU AABB | WebGL，逐块绘制 |
| C | Worker | WebGPU AABB | WebGPU visibility 回读、CPU compact、WebGL |
| D | Worker | WebGPU AABB + chunk 预算反馈 | 同 C；动态预算 |

同一随机种子、对象数、几何类型、Chunk 初始大小、视口、浏览器和 GPU。使用 `10k / 100k / 500k / 1m` 对比，建议每组至少 5 次，按 A/B/E/C/D 随机化顺序并记录中位数和 P95。C/D 无 WebGPU 能力时跳过。

## 指标

- `loadTimeMs`：到全部处理完成的墙钟时间，包括受控渲染等待。
- `firstVisibleMs`：首次 draw 调用对应的近似时间，**非真正像素合成时间**。
- `frameP95Ms` / `interactionP95Ms`：RAF 帧间隔 P95。
- `uploadMs`：JS 到 `bufferSubData` 的调用墙钟时长，非 GPU 完整执行时间。
- `computeMs`：WebGPU 提交及 mapAsync 回读等全链路时间。
- `receivedBytes`：TypedArray 从 Worker 进入主线程的数据字节，不是 HTTP 响应字节。
- HTTP 实验另记录 `networkBytes`、`reads`、`uploads`、对象累计数量。
- 加速比 = A 或 E 的 `loadTimeMs` / 待比较组的 `loadTimeMs`。小于 1 表示候选更慢。

## 复现命令

```bash
npm ci
npm run typecheck
npm test
npm run dev
# http://localhost:5173/lab.html
```

或者无 npm 启动静态实验：

```bash
python3 -m http.server 4173
# http://localhost:4173/lab.html
```

实验后从 UI 导出 JSON/CSV，附设备型号、操作系统、浏览器版本、硬件加速状态、种子、视口、地图模式和实验失败原因。

## 当前证据与未完成项

**已验证**：自动化逻辑与 Node CPU/Worker 基准；100 万对象 HTTP 增量记录解析的已有日志。原始 Node 数据位于 `reports/node-data-benchmark.json`，是 Linux/Node 22 的生成和 Worker 消息耗时，不是 GPU FPS。

**未验证**：真实百度地图叠加、WebGPU C/D 加速比、实际浏览器 50 万/100 万点线面多轮 FPS/P95、显存峰值。因此不能在报告中写“WebGPU 快 XX%”。

## 浏览器验收记录模板

| 日期 | 浏览器/GPU | 场景/几何 | 数量 | 模式 | Load ms | First ms | P95 ms | Compute ms | Upload MB | 备注 |
|---|---|---|---:|---|---:|---:|---:|---:|---:|---|
| 待测 | 待填 | Point | 500000 | A/B/E/C/D | N/A | N/A | N/A | N/A | N/A | 同视口固定种子 |
| 待测 | 待填 | LineString | 500000 | A/B/E/C/D | N/A | N/A | N/A | N/A | N/A | 另记录顶点数 |
| 待测 | 待填 | Polygon | 1000000 | A/B/E/C/D | N/A | N/A | N/A | N/A | N/A | 另记录面三角数 |
