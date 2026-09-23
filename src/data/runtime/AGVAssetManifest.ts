import type { AGVAssetRef } from "./AGVRuntime";

/**
 * 静态 Asset 与动态 AGVState 分离。
 * 后续可以从 manifest.json 扩展为多 LOD / 多型号 AGV。
 */
export const AGV_ASSETS: AGVAssetRef[] = [
    {
        assetId: "agv-glb",
        uri: "/assets/agv/agv.glb"
    }
];

export function getAGVAsset(assetId: string): AGVAssetRef | undefined {
    return AGV_ASSETS.find(
        asset => asset.assetId === assetId
    );
}
