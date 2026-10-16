import { PortApplication } from "./app/PortApplication";

interface RuntimeConfig {
    baiduMapAk?: string;
}

declare global {
    interface Window {
        __APP_CONFIG__?: RuntimeConfig;
    }
}

const BAIDU_MAP_CALLBACK = "__yangshanBMapGLReady__";

function loadBaiduMapScript(ak: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if ((window as any).BMapGL?.Map) {
            (window as any).BMapGL.apiVersion = "gl";
            resolve();
            return;
        }

        const fail = () =>
            reject(
                new Error(
                    "无法加载 Baidu JSAPI（WebGL），请检查 BAIDU_MAP_AK、域名白名单和服务器网络。"
                )
            );

        // Baidu 的 WebGL JSAPI 通过 callback 在真正加载完成后回调，
        // 直接依赖 <script> 的 onload 会在 BMapGL 就绪之前触发。
        (window as any)[BAIDU_MAP_CALLBACK] = () => {
            if ((window as any).BMapGL?.Map) {
                // Official 4.0 migration compatibility mode for the existing BMapGL code.
                // Set BEFORE constructing BMapGL.Map; no runtime switching.
                (window as any).BMapGL.apiVersion = "gl";
                resolve();
            } else {
                fail();
            }
        };

        const existing = document.querySelector(
            'script[data-baidu-map-api="true"]'
        ) as HTMLScriptElement | null;

        if (existing) {
            existing.addEventListener("error", fail, { once: true });
            return;
        }

        const script = document.createElement("script");
        script.dataset.baiduMapApi = "true";
        script.src =
            `https://api.map.baidu.com/api?v=4.0&ak=${encodeURIComponent(ak)}` +
            `&callback=${BAIDU_MAP_CALLBACK}`;
        script.async = true;
        script.onerror = fail;
        document.head.appendChild(script);
    });
}

function showFatalError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const el = document.getElementById("render-status");
    if (el) {
        el.textContent = `页面初始化异常：${message}`;
        el.classList.add("error");
    } else {
        // Without a valid AK do not leave a silent, blank page.
        const alert = document.createElement("div");
        alert.style.cssText = "position:fixed;z-index:2147483646;left:24px;top:130px;max-width:450px;padding:20px;border:1px solid #3c91c5;border-radius:12px;background:#081f36;color:#eaf6ff;line-height:1.75;font:14px system-ui;";
        alert.textContent = `真实百度地图尚未启动：${message}。可先使用右下角的离线空间实验室进行性能测试。`;
        document.body.appendChild(alert);
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
    const ak = window.__APP_CONFIG__?.baiduMapAk?.trim();

    if (!ak) {
        throw new Error(
            "未配置 Baidu Map AK。请在部署环境设置 BAIDU_MAP_AK，" +
            "或本地修改 public/config.js。"
        );
    }

    await loadBaiduMapScript(ak);

    const app = new PortApplication({
        container: "map_container",
        longitude: 122.032598,
        latitude: 30.662465,
        zoom: 16
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
