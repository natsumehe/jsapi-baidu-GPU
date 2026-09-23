export interface Bounds {

    minX: number;
    minY: number;

    maxX: number;
    maxY: number;
}

export interface SpatialObject {

    id: number;

    x: number;
    y: number;
}

export class Quadtree {

    private objects: SpatialObject[] = [];

    constructor(
        private bounds: Bounds,
        private capacity = 64
    ) {}

    insert(
        object: SpatialObject
    ): boolean {

        if (
            object.x < this.bounds.minX ||
            object.x > this.bounds.maxX ||
            object.y < this.bounds.minY ||
            object.y > this.bounds.maxY
        ) {
            return false;
        }

        this.objects.push(object);

        return true;
    }

    query(
        bounds: Bounds
    ): SpatialObject[] {

        const result: SpatialObject[] = [];

        for (
            const object of this.objects
        ) {

            if (
                object.x >= bounds.minX &&
                object.x <= bounds.maxX &&
                object.y >= bounds.minY &&
                object.y <= bounds.maxY
            ) {

                result.push(object);
            }
        }

        return result;
    }
}