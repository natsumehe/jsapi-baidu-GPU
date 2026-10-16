export class FPSMonitor {

    private frames = 0;

    private last =
        performance.now();

    private fps = 0;
    private running = false;
    private frameId: number | null = null;

    start(): void {
        if (this.running) return;
        this.running = true;
        this.last = performance.now();
        this.frameId = requestAnimationFrame(this.tick);
    }

    stop(): void {
        this.running = false;
        if (this.frameId !== null) cancelAnimationFrame(this.frameId);
        this.frameId = null;
    }

    private tick =
        (time: number) => {
            if (!this.running) return;
            this.frames++;

            const elapsed =
                time -
                this.last;

            if (
                elapsed >= 1000
            ) {

                this.fps =
                    this.frames *
                    1000 /
                    elapsed;

                this.frames =
                    0;

                this.last =
                    time;

                this.updateUI();
            }

            this.frameId = requestAnimationFrame(this.tick);
        };

    getFPS(): number {

        return this.fps;
    }

    private updateUI(): void {

        const element =
            document.getElementById(
                "fps"
            );

        if (!element) {

            return;
        }

        element.textContent =
            `FPS: ${this.fps.toFixed(1)}`;
    }
}