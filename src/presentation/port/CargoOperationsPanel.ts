import { CARGO_STAGES, STAGE_LABELS, type CargoSnapshot } from "../../domain/cargo/CargoLifecycle";
import type { PortOperationsService, PortOperationsView } from "../../application/port/PortOperationsService";

/** DOM only. Does not mutate cargo domain state or infer handoffs from animation. */
export class CargoOperationsPanel {
    private selection = "";
    private unsubscribe: (() => void) | null = null;
    private running = true;
    private focusListeners = new Set<(job: CargoSnapshot) => void>();
    constructor(private readonly host: HTMLElement, private readonly service: PortOperationsService) {}
    initialize(): void {
        this.host.innerHTML = `
          <div class="cargo-head"><strong>进口卸船 · 集装箱生命周期</strong><span id="cargo-mode"></span></div>
          <div class="cargo-statline" id="cargo-stats">等待 TOS 作业数据…</div>
          <div class="cargo-controls"><label>作业单 <select id="cargo-job-select"></select></label>
            <button id="cargo-toggle" type="button">暂停模拟</button>
            <label>速度 <select id="cargo-speed"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
          </div>
          <div id="cargo-selected" class="cargo-selected"></div>
          <div id="cargo-steps" class="cargo-steps"></div>
          <div class="cargo-subtitle">最近事件（来自业务状态机，不依据地图动画判定）</div>
          <div id="cargo-events" class="cargo-events"></div>
          <div id="cargo-error" class="cargo-error" role="status"></div>
          <div class="cargo-note">演示使用合成 TOS 任务与调度；原 155 辆 AGV 地图动画为独立的 GIS 轨迹展示。</div>
        `;
        const select = this.get<HTMLSelectElement>("cargo-job-select");
        select.addEventListener("change", () => { this.selection = select.value; this.render(this.service.snapshot()); });
        this.get<HTMLButtonElement>("cargo-toggle").addEventListener("click", () => {
            this.running = !this.running; this.service.setRunning(this.running);
            this.get<HTMLButtonElement>("cargo-toggle").textContent = this.running ? "暂停模拟" : "继续模拟";
        });
        this.get<HTMLSelectElement>("cargo-speed").addEventListener("change", event => {
            this.service.setSpeed(Number((event.target as HTMLSelectElement).value));
        });
        this.unsubscribe = this.service.subscribe(state => this.render(state));
    }
    onFocus(listener: (job: CargoSnapshot) => void): () => void { this.focusListeners.add(listener); return () => this.focusListeners.delete(listener); }
    destroy(): void { this.unsubscribe?.(); this.focusListeners.clear(); this.host.replaceChildren(); }
    private get<T extends HTMLElement>(id: string): T { return this.host.querySelector(`#${id}`) as T; }
    private render(state: PortOperationsView): void {
        const jobs = state.jobs;
        const select = this.get<HTMLSelectElement>("cargo-job-select");
        const previouslySelected = this.selection;
        if (select.options.length !== jobs.length) {
            select.replaceChildren(...jobs.map(job => {
                const option = document.createElement("option"); option.value = job.job.id;
                option.textContent = `${job.job.containerNo} · ${job.job.agvId}`; return option;
            }));
        }
        if (!jobs.some(j => j.job.id === this.selection)) this.selection = jobs[0]?.job.id ?? "";
        select.value = this.selection;
        const active = jobs.filter(job => job.stage !== "PLANNED" && job.stage !== "GATE_OUT").length;
        const finished = jobs.filter(job => job.stage === "GATE_OUT").length;
        this.get<HTMLElement>("cargo-mode").textContent = state.mode === "simulation" ? "SIMULATED" : "REMOTE TOS";
        this.get<HTMLElement>("cargo-stats").textContent = `${jobs.length} 作业单 · ${active} 作业中 · ${finished} 已出港 · QC ${state.dispatch.qcBusy ?? "—"} / AGV ${state.dispatch.agvBusy ?? "—"} / ASC ${state.dispatch.ascBusy ?? "—"} 忙碌`;
        const selected = jobs.find(job => job.job.id === this.selection);
        const detail = this.get<HTMLElement>("cargo-selected"); detail.replaceChildren();
        const steps = this.get<HTMLElement>("cargo-steps"); steps.replaceChildren();
        if (selected) {
            const label = document.createElement("strong"); label.textContent = `${selected.job.containerNo}  ·  ${STAGE_LABELS[selected.stage]}`;
            const sub = document.createElement("div"); sub.textContent = `TOS ${selected.job.id} | QC ${selected.job.craneId} | ${selected.job.agvId} | ${selected.job.yardId}`;
            detail.append(label, sub);
            for (const stage of CARGO_STAGES) {
                const node = document.createElement("span"); node.className = "cargo-step";
                if (CARGO_STAGES.indexOf(stage) <= CARGO_STAGES.indexOf(selected.stage)) node.classList.add("done");
                if (stage === selected.stage) node.classList.add("current");
                node.textContent = STAGE_LABELS[stage]; steps.appendChild(node);
            }
            if (previouslySelected !== this.selection || state.recent[0]?.jobId === this.selection) {
                for (const listener of this.focusListeners) listener(selected);
            }
        }
        const eventHost = this.get<HTMLElement>("cargo-events"); eventHost.replaceChildren();
        for (const event of state.recent.slice(0, 5)) {
            const line = document.createElement("div");
            line.textContent = `${event.occurredAt.slice(11, 19)}  ${event.jobId}  ${STAGE_LABELS[event.type]}  /  ${event.equipmentId}`;
            eventHost.appendChild(line);
        }
        this.get<HTMLElement>("cargo-error").textContent = state.error ?? "";
        const simulation = state.mode === "simulation";
        this.get<HTMLButtonElement>("cargo-toggle").disabled = !simulation;
        this.get<HTMLSelectElement>("cargo-speed").disabled = !simulation;
    }
}
