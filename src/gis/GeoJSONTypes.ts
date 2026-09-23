export type Ring = Array<[number, number]>;
export type Polygon = Ring[];
export type MultiPolygon = Polygon[];

export interface GeoJSONFeature {
    type: "Feature";
    properties?: Record<string, unknown>;
    geometry: {
        type: "Polygon" | "MultiPolygon" | "LineString" | "MultiLineString";
        coordinates: any;
    };
}

export interface GeoJSONFeatureCollection {
    type: "FeatureCollection";
    features: GeoJSONFeature[];
    crs?: unknown;
}
