/**
 * AGV 在 Spatial Runtime 中的最小运行时状态。
 *
 * 注意：这里保存的是“运行时数据”，不是 GLB 模型本身。
 * assetId 负责把仿真状态与可替换的 3D Asset 解耦。
 */
export interface AGVState {
    id: string;
    assetId: string;
    x: number;
    y: number;
    heading: number;
    speed: number;
    state: "idle" | "moving";
}

export interface AGVAssetRef {
    assetId: string;
    uri: string;
    lod?: string[];
}
