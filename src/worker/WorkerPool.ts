import type { DecodedTile } from "../data/runtime/TileTypes";
import type { WorkerResponse } from "./WorkerProtocol";

interface Pending {
    tileId: string;
    resolve: (value: DecodedTile) => void;
    reject: (reason?: unknown) => void;
}

export class WorkerPool {

    private readonly workers: Worker[] = [];
    private readonly pending =
        new Map<number, Pending>();

    private nextWorker = 0;
    private nextTaskId = 1;

    constructor(size = 2) {
        const workerCount = Math.max(1, size);

        for (let i = 0; i < workerCount; i++) {
            const worker = new Worker(
                new URL(
                    "./spatial.worker.ts",
                    import.meta.url
                ),
                { type: "module" }
            );

            worker.onmessage = event => {
                this.handleMessage(
                    event.data as WorkerResponse
                );
            };

            worker.onerror = event => {
                const message =
                    event.message || "Worker error.";

                for (const [id, pending] of this.pending) {
                    pending.reject(new Error(message));
                    this.pending.delete(id);
                }
            };

            this.workers.push(worker);
        }
    }

    decodeTile(
        tileId: string,
        buffer: ArrayBuffer
    ): Promise<DecodedTile> {
        if (this.workers.length === 0) {
            return Promise.reject(
                new Error("WorkerPool has been destroyed.")
            );
        }

        return new Promise((resolve, reject) => {
            const taskId = this.nextTaskId++;

            const worker =
                this.workers[
                    this.nextWorker++ %
                    this.workers.length
                ];

            this.pending.set(taskId, {
                tileId,
                resolve,
                reject
            });

            worker.postMessage(
                {
                    type: "decode-tile",
                    id: taskId,
                    tileId,
                    buffer
                },
                [buffer]
            );
        });
    }

    getPendingCount(): number {
        return this.pending.size;
    }

    getWorkerCount(): number {
        return this.workers.length;
    }

    destroy(): void {
        for (const worker of this.workers) {
            worker.terminate();
        }

        this.workers.length = 0;

        for (const pending of this.pending.values()) {
            pending.reject(
                new Error("WorkerPool destroyed.")
            );
        }

        this.pending.clear();
    }

    private handleMessage(
        message: WorkerResponse
    ): void {
        const pending = this.pending.get(message.id);

        if (!pending) return;

        this.pending.delete(message.id);

        if (message.type === "decoded") {
            pending.resolve({
                id: message.tileId,
                count: message.count,
                positions:
                    new Float32Array(message.positions),
                colors:
                    new Uint8Array(message.colors)
            });
            return;
        }

        pending.reject(
            new Error(message.error)
        );
    }
}
