import {
    CoordinateSystem,
    GeoPoint
} from "./CoordinateSystem";

export interface BaiduMapOptions {

    container: string;

    center?: {
        lng: number;
        lat: number;
    };

    zoom?: number;
}

export class BaiduMap {

    private readonly map:
        BMapGL.Map;

    constructor(
        options:
            BaiduMapOptions |
            string
    ) {

        const normalized =
            typeof options === "string"
                ? {
                    container:
                        options
                }
                : options;

        const BMap =
            (window as any)
                .BMapGL as
            typeof BMapGL |
            undefined;

        if (
            !BMap?.Map ||
            !BMap.Point
        ) {

            throw new Error(
                "Baidu JSAPI 4.0 is not loaded."
            );
        }

        const container =
            document.getElementById(
                normalized.container
            );

        if (!container) {

            throw new Error(
                `Map container '${normalized.container}' not found.`
            );
        }

        this.map =
            new BMap.Map(
                normalized.container
            );

        const center =
            normalized.center ??
            {
                lng: 121.8,
                lat: 29.95
            };

        this.map.centerAndZoom(
            new BMap.Point(
                center.lng,
                center.lat
            ),
            normalized.zoom ?? 12
        );

        this.map.enableScrollWheelZoom(
            true
        );

        this.map.enableDoubleClickZoom(
            true
        );

        this.map.enableDragging();

        // 与用户提供的洋山四期卫星影像保持一致：有可用卫星底图时默认进入卫星模式。
        const satellite = (BMap as any).BMAP_SATELLITE_MAP;
        if (satellite && typeof (this.map as any).setMapType === "function") {
            (this.map as any).setMapType(satellite);
        }

        this.map.setTilt(
            0
        );

        this.map.setHeading(
            0
        );
    }

    initialize(
        longitude: number,
        latitude: number,
        zoom: number
    ): void {

        const BMap =
            (window as any)
                .BMapGL as
            typeof BMapGL;

        this.map.centerAndZoom(
            new BMap.Point(
                longitude,
                latitude
            ),
            zoom
        );
    }

    getMap():
        BMapGL.Map {

        return this.map;
    }

    getZoom():
        number {

        return this.map.getZoom();
    }

    getCenter(): {
        lng: number;
        lat: number;
    } {

        const center =
            this.map.getCenter();

        return {
            lng: center.lng,
            lat: center.lat
        };
    }

    getHeading():
        number {

        return typeof
            this.map.getHeading ===
            "function"

            ? this.map.getHeading()

            : 0;
    }

    getTilt():
        number {

        return typeof
            this.map.getTilt ===
            "function"

            ? this.map.getTilt()

            : 0;
    }

    getCameraState() {

        return {

            center:
                this.getCenter(),

            zoom:
                this.getZoom(),

            heading:
                this.getHeading(),

            tilt:
                this.getTilt()
        };
    }

    /*
     * 根据百度地图当前视野，
     * 估算局部米制坐标的可见范围。
     *
     * origin 是空间数据局部坐标系原点。
     */

    getLocalViewportBounds(
        origin: GeoPoint
    ) {

        const coordinateSystem =
            new CoordinateSystem(
                origin
            );

        const center =
            this.getCenter();

        const centerPixel =
            this.map.pointToPixel(
                new BMapGL.Point(
                    center.lng,
                    center.lat
                )
            );

        const element =
            document.getElementById(
                "map_container"
            );

        const width =
            element?.clientWidth ??
            window.innerWidth;

        const height =
            element?.clientHeight ??
            window.innerHeight;

        /*
         * 东方向 1m
         */

        const eastGeo =
            coordinateSystem.localToGeo({
                x: 1,
                y: 0,
                z: 0
            });

        /*
         * 北方向 1m
         */

        const northGeo =
            coordinateSystem.localToGeo({
                x: 0,
                y: 1,
                z: 0
            });

        const eastPixel =
            this.map.pointToPixel(
                new BMapGL.Point(
                    eastGeo.longitude,
                    eastGeo.latitude
                )
            );

        const northPixel =
            this.map.pointToPixel(
                new BMapGL.Point(
                    northGeo.longitude,
                    northGeo.latitude
                )
            );

        const metersPerPixelX =
            Math.max(
                1e-8,

                Math.hypot(
                    eastPixel.x -
                    centerPixel.x,

                    eastPixel.y -
                    centerPixel.y
                )
            );

        const metersPerPixelY =
            Math.max(
                1e-8,

                Math.hypot(
                    northPixel.x -
                    centerPixel.x,

                    northPixel.y -
                    centerPixel.y
                )
            );

        const halfWidthMeters =
            width /
            2 /
            metersPerPixelX;

        const halfHeightMeters =
            height /
            2 /
            metersPerPixelY;

        return {

            minX:
                -halfWidthMeters,

            maxX:
                halfWidthMeters,

            minY:
                -halfHeightMeters,

            maxY:
                halfHeightMeters,

            minZ:
                -100,

            maxZ:
                1000
        };
    }

    on(
        event: string,
        callback:
            (...args: any[]) => void
    ): void {

        this.map.addEventListener(
            event,
            callback
        );
    }

    onCameraChanged(
        callback: () => void
    ): void {

        this.map.addEventListener(
            "moveend",
            callback
        );

        this.map.addEventListener(
            "zoomend",
            callback
        );

        this.map.addEventListener(
            "dragend",
            callback
        );
    }
}