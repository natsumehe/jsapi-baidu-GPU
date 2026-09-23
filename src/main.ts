import { PortApplication } from "./app/PortApplication";

function showFatalError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const el = document.getElementById("render-status");
    if (el) {
        el.textContent = `页面初始化异常：${message}`;
        el.classList.add("error");
    }
    console.error("Spatial World initialization failed:", error);
}

window.addEventListener("error", event => {
    const el = document.getElementById("render-status");
    if (el) {
        el.textContent = `运行时异常：${event.message || "Unknown error"}`;
        el.classList.add("error");
    }
});

window.addEventListener("unhandledrejection", event => {
    const el = document.getElementById("render-status");
    if (el) {
        const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
        el.textContent = `异步加载异常：${reason}`;
        el.classList.add("error");
    }
});

async function main(): Promise<void> {
    const app = new PortApplication({
        container: "map_container",
        longitude: 122.032598,
        latitude: 30.662465,
        zoom: 15
    });

    await app.initialize();

    console.log(
        "Baidu JSAPI 4.0 Spatial World Ready."
    );

    console.log(
        "Architecture: Camera -> Tile/LOD -> Fetch Stream -> Worker/WASM -> Runtime Data -> Asset/Data Format -> WebGPU/WebGL"
    );
}

main().then(() => {
    const el = document.getElementById("render-status");
    if (el) {
        el.textContent = "渲染链路已启动 · Baidu Map + GIS + 155 AGV";
        el.classList.remove("error");
    }
}).catch(showFatalError);
