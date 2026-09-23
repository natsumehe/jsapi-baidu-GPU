# 洋山四期 155 AGV 仿真数据

本目录是 **独立的仿真/数据生产层**，前端 `src/` 只消费编译后的数据，不把仿真规则和业务数据结构写死在地图渲染器里。

## 空间锚点

- Longitude: `122.032722`
- Latitude: `30.658429`
- 局部坐标：以该点为 ENU 原点（米）

所有 AGV 的运行位置都沿道路图生成，并在 Runtime 中转换为经纬度；不会使用随机经纬度点。

## 数据输出

- `agv_fleet.json`：155 台 AGV 静态身份/资产/初始坐标信息。
- `agv_routes.json`：155 台 AGV 的完整生命周期路线，包含每个阶段的经纬度道路点。
- `AGV_TRAJECTORY.json` / `.jsonl`：按时间采样的 AGV 动态轨迹，包含 longitude / latitude / heading / speed / phase / battery。
- `TOS_STA_AGV_CNTR_INFOS.json` / `.csv`：按照给定的 TOS 作业箱信息表字段生成 155 条合成作业记录。
- `TOS_STA_AGV_CNTR_INFOS.schema.json`：字段说明。
- `manifest.json`：运行时入口清单。

## 运行逻辑

每台 AGV 的生命周期：

`岸桥取箱 → 重车运输 → 堆场交接 → 指定停车位 → 补能/换电 → 返回岸桥`

路线约束来自 `YangshanPhase4Network.ts` 中的道路图。道路几何是根据用户提供的洋山四期卫星影像结构建立的演示级合成中心线，不宣称为官方生产车道中心线。

## 重新生成

在项目根目录：

```bash
node simulation/yangshan_phase4/generate_yangshan_agv.mjs
```
