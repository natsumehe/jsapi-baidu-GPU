import type { BaiduMap } from "../map/BaiduMap";
import type { GeoPoint } from "../map/CoordinateSystem";
import type { TileRequest } from "../data/runtime/TileTypes";

export interface SpatialTileSelectorOptions {
    baseZoom?: number;
    maxLevel?: number;
    tileSize?: number;
    radius?: number;
    urlTemplate?: string;
    minTileX?: number;
    maxTileX?: number;
    minTileY?: number;
    maxTileY?: number;
}

export class SpatialTileSelector {

    private readonly baseZoom: number;
    private readonly maxLevel: number;
    private readonly tileSize: number;
    private readonly radius: number;
    private readonly urlTemplate: string;
    private readonly minTileX: number;
    private readonly maxTileX: number;
    private readonly minTileY: number;
    private readonly maxTileY: number;

    constructor(
        private readonly map: BaiduMap,
        private readonly origin: GeoPoint,
        options: SpatialTileSelectorOptions = {}
    ) {
        this.baseZoom = options.baseZoom ?? 12;
        this.maxLevel = options.maxLevel ?? 2;
        this.tileSize = options.tileSize ?? 5000;
        this.radius = options.radius ?? 1;
        this.urlTemplate =
            options.urlTemplate ??
            "/data/tiles/{z}/{x}/{y}.bin";
        this.minTileX = options.minTileX ?? -1;
        this.maxTileX = options.maxTileX ?? 1;
        this.minTileY = options.minTileY ?? -1;
        this.maxTileY = options.maxTileY ?? 1;
    }

    select(): TileRequest[] {
        const level = this.getLevel();

        const bounds =
            this.map.getLocalViewportBounds(
                this.origin
            );

        const center =
            this.map.getCenter();

        const centerLocal =
            this.originToLocal(
                center.lng,
                center.lat
            );

        const tileWorldSize =
            this.tileSize /
            Math.pow(2, level);

        const centerX =
            Math.floor(
                centerLocal.x / tileWorldSize
            );

        const centerY =
            Math.floor(
                centerLocal.y / tileWorldSize
            );

        const visibleRadiusX =
            Math.ceil(
                Math.max(
                    Math.abs(bounds.minX),
                    Math.abs(bounds.maxX)
                ) / tileWorldSize
            );

        const visibleRadiusY =
            Math.ceil(
                Math.max(
                    Math.abs(bounds.minY),
                    Math.abs(bounds.maxY)
                ) / tileWorldSize
            );

        const radiusX = Math.min(
            this.radius,
            Math.max(1, visibleRadiusX)
        );

        const radiusY = Math.min(
            this.radius,
            Math.max(1, visibleRadiusY)
        );

        const requests: TileRequest[] = [];
        const minX = Math.max(this.minTileX, centerX - radiusX);
        const maxX = Math.min(this.maxTileX, centerX + radiusX);
        const minY = Math.max(this.minTileY, centerY - radiusY);
        const maxY = Math.min(this.maxTileY, centerY + radiusY);

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const dx = x - centerX;
                const dy = y - centerY;
                const distance =
                    Math.sqrt(dx * dx + dy * dy);

                requests.push({
                    id:
                        `port-${level}-${x}-${y}`,
                    url:
                        this.urlTemplate
                            .replace(
                                "{z}",
                                String(level)
                            )
                            .replace(
                                "{x}",
                                String(x)
                            )
                            .replace(
                                "{y}",
                                String(y)
                            ),
                    z: level,
                    x,
                    y,
                    priority:
                        1000 -
                        distance * 100 -
                        level * 10
                });
            }
        }

        const sorted = requests.sort(
            (a, b) =>
                b.priority -
                a.priority
        );

        return sorted;
    }

    getLevel(): number {
        const zoom = this.map.getZoom();

        return Math.max(
            0,
            Math.min(
                this.maxLevel,
                Math.floor(
                    zoom -
                    this.baseZoom
                )
            )
        );
    }

    private originToLocal(
        longitude: number,
        latitude: number
    ): {
        x: number;
        y: number;
    } {
        const earthRadius = 6378137;
        const lat0 =
            this.toRadians(
                this.origin.latitude
            );

        return {
            x:
                this.toRadians(
                    longitude -
                    this.origin.longitude
                ) *
                earthRadius *
                Math.cos(lat0),

            y:
                this.toRadians(
                    latitude -
                    this.origin.latitude
                ) *
                earthRadius
        };
    }

    private toRadians(
        value: number
    ): number {
        return value *
            Math.PI /
            180;
    }
}
