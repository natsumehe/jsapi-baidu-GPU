export class FPSMonitor {

    private frames = 0;

    private last =
        performance.now();

    private fps = 0;

    start(): void {

        requestAnimationFrame(
            this.tick
        );
    }

    private tick =
        (time: number) => {

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

            requestAnimationFrame(
                this.tick
            );
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