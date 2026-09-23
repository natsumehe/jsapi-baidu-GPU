export type WorkerRequest =
    | {
        type: "decode-tile";
        id: number;
        tileId: string;
        buffer: ArrayBuffer;
    };

export type WorkerResponse =
    | {
        type: "decoded";
        id: number;
        tileId: string;
        count: number;
        positions: ArrayBuffer;
        colors: ArrayBuffer;
    }
    | {
        type: "error";
        id: number;
        error: string;
    };
