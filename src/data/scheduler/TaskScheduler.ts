export interface ScheduledTask<T> {
    id: string;
    priority: number;
    run: () => Promise<T>;
}

interface QueueItem<T> extends ScheduledTask<T> {
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
}

export class TaskScheduler {

    private readonly queue: QueueItem<unknown>[] = [];
    private active = 0;

    constructor(
        private readonly concurrency =
            Math.max(
                1,
                Math.min(
                    4,
                    (navigator.hardwareConcurrency ?? 4) - 1
                )
            )
    ) {}

    schedule<T>(
        task: ScheduledTask<T>
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.queue.push({
                ...task,
                resolve: resolve as (value: unknown) => void,
                reject
            } as QueueItem<unknown>);

            this.queue.sort(
                (a, b) => b.priority - a.priority
            );

            this.drain();
        });
    }

    getPendingCount(): number {
        return this.queue.length;
    }

    getActiveCount(): number {
        return this.active;
    }

    private drain(): void {
        while (
            this.active < this.concurrency &&
            this.queue.length > 0
        ) {
            const item = this.queue.shift()!;
            this.active++;

            void item.run()
                .then(value => {
                    item.resolve(value);
                })
                .catch(error => {
                    item.reject(error);
                })
                .finally(() => {
                    this.active--;
                    this.drain();
                });
        }
    }
}
