export interface GeoPoint {

    longitude: number;

    latitude: number;

    height: number;
}

export interface LocalPoint {

    x: number;

    y: number;

    z: number;
}

export class CoordinateSystem {

    private readonly earthRadius =
        6378137.0;

    constructor(
        private readonly origin: GeoPoint
    ) {}

    geoToLocal(
        point: GeoPoint
    ): LocalPoint {

        const lat0 =
            this.toRadians(
                this.origin.latitude
            );

        const dLat =
            this.toRadians(
                point.latitude -
                this.origin.latitude
            );

        const dLon =
            this.toRadians(
                point.longitude -
                this.origin.longitude
            );

        const x =
            dLon *
            this.earthRadius *
            Math.cos(lat0);

        const y =
            dLat *
            this.earthRadius;

        const z =
            point.height -
            this.origin.height;

        return {
            x,
            y,
            z
        };
    }

    localToGeo(
        point: LocalPoint
    ): GeoPoint {

        const lat =
            this.origin.latitude
            +
            this.toDegrees(
                point.y /
                this.earthRadius
            );

        const lon =
            this.origin.longitude
            +
            this.toDegrees(
                point.x /
                (
                    this.earthRadius *
                    Math.cos(
                        this.toRadians(
                            this.origin.latitude
                        )
                    )
                )
            );

        return {

            longitude: lon,

            latitude: lat,

            height:
                this.origin.height +
                point.z
        };
    }

    private toRadians(
        value: number
    ): number {

        return value *
            Math.PI /
            180;
    }

    private toDegrees(
        value: number
    ): number {

        return value *
            180 /
            Math.PI;
    }
}