export interface LoadRecord {

    tileId: string;

    requestStart: number;

    responseEnd: number;

    decodeStart: number;

    decodeEnd: number;

    uploadStart: number;

    uploadEnd: number;
}

export class LoadProfiler {

    private records:
        LoadRecord[] = [];

    begin(
        tileId: string
    ) {

        const now =
            performance.now();

        return {

            tileId,

            requestStart:
                now,

            responseEnd: 0,

            decodeStart: 0,

            decodeEnd: 0,

            uploadStart: 0,

            uploadEnd: 0
        };
    }

    mark(
        record: LoadRecord,
        key:
            keyof LoadRecord
    ): void {

        if (
            key === "tileId"
        ) {

            return;
        }

        record[key] =
            performance.now();
    }

    finish(
        record: LoadRecord
    ): void {

        this.records.push(
            record
        );
    }

    getRecords():
        readonly LoadRecord[] {

        return this.records;
    }
}