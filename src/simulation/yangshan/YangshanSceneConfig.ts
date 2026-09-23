export interface SceneSummary {
    total: number;
    running: number;
    charging: number;
    standby: number;
    fault: number;
}

export interface SceneZone {
    id: string;
    label: string;
    kind: "YARD" | "QUAY" | "PARKING" | "CHARGING" | "ROAD" | "OFFICE" | "EXTERNAL";
    polygon: Array<[number, number]>; // reference-image pixels
}

export interface SceneSampleRow {
    id: string;
    location: string;
    status: string;
    speed: string;
    battery: string;
}

export const YANGSHAN_SCENE = {
    referenceWidth: 1728,
    referenceHeight: 864,
    anchor: {
        longitude: 122.032598,
        latitude: 30.662465
    },
    // Reference image pixel that is used as the geographic anchor.
    // The route geometry is authored against the same 1728x864 reference frame.
    anchorPixel: { x: 850, y: 430 },
    metersPerReferencePixel: 1.72,

    summary: {
        total: 155,
        running: 132,
        charging: 12,
        standby: 8,
        fault: 3
    } satisfies SceneSummary,

    legend: [
        { color: "#39eb75", label: "作业路线（岸桥 → 码场）" },
        { color: "#ffb429", label: "码垛 → 停车场" },
        { color: "#42a5ff", label: "停车 → 充电站" },
        { color: "#67c7ff", label: "充电 → 复位" },
        { color: "#dd68ec", label: "返回岸桥" }
    ],

    sampleRows: [
        { id: "AGV-001", location: "岸桥区", status: "作业中", speed: "8.2", battery: "78" },
        { id: "AGV-018", location: "码场区", status: "运输中", speed: "12.4", battery: "62" },
        { id: "AGV-032", location: "停车场", status: "返回中", speed: "10.6", battery: "55" },
        { id: "AGV-054", location: "充电站", status: "充电中", speed: "0.0", battery: "88" },
        { id: "AGV-067", location: "岸桥区", status: "作业中", speed: "7.8", battery: "73" },
        { id: "AGV-089", location: "码场区", status: "运输中", speed: "11.9", battery: "64" }
    ] satisfies SceneSampleRow[],

    zones: [
        {
            id: "YARD-A",
            label: "堆场区 A",
            kind: "YARD",
            polygon: [[105, 305], [430, 335], [420, 475], [95, 442]]
        },
        {
            id: "YARD-B",
            label: "堆场区 B",
            kind: "YARD",
            polygon: [[430, 335], [755, 368], [742, 510], [420, 475]]
        },
        {
            id: "YARD-C",
            label: "堆场区 C",
            kind: "YARD",
            polygon: [[755, 368], [1080, 410], [1065, 552], [742, 510]]
        },
        {
            id: "YARD-D",
            label: "堆场区 D",
            kind: "YARD",
            polygon: [[1080, 410], [1395, 452], [1375, 600], [1065, 552]]
        },
        {
            id: "QUAY",
            label: "岸桥作业区",
            kind: "QUAY",
            polygon: [[85, 595], [1615, 760], [1600, 820], [70, 655]]
        },
        {
            id: "PARKING",
            label: "AGV 停车场",
            kind: "PARKING",
            polygon: [[1390, 555], [1660, 585], [1650, 760], [1400, 730]]
        },
        {
            id: "CHARGING",
            label: "充电站",
            kind: "CHARGING",
            polygon: [[1515, 405], [1645, 420], [1635, 555], [1510, 540]]
        },
        {
            id: "OFFICE",
            label: "综合办公区",
            kind: "OFFICE",
            polygon: [[700, 110], [920, 125], [910, 205], [690, 188]]
        },
        {
            id: "NORTH_ROAD",
            label: "集疏运道路",
            kind: "ROAD",
            polygon: [[110, 205], [1585, 360], [1575, 395], [105, 245]]
        },
        {
            id: "EXTERNAL_ROAD",
            label: "外部通路",
            kind: "EXTERNAL",
            polygon: [[1080, 115], [1615, 270], [1603, 305], [1070, 150]]
        }
    ] satisfies SceneZone[]
} as const;
