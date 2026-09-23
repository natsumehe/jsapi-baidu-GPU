export interface TOSAGVTaskRecord {
    TAA_ID: string;
    TAA_DATE: string;
    TAA_SHIFT: number;
    TAA_WKNO: string;
    TAA_CHE_TYPE: string;
    TAA_MOVE_KIND: string;
    TAA_AGV_ID: string;
    TAA_DRIVER: string;
    TAA_DRIVENAME: string;
    TAA_CNTRID: string;
    TAA_AGO_GROUP_ID: string;
    TAA_CSIZECD: string;
    TAA_CSTATUSCD: string;
    TAA_DNGCD: string;
    TAA_OVLMTCD: string;
    TAA_CTYPECD: string;
    TAA_SETTMPT: number | null;
    TAA_WK_STTIME: string;
    TAA_WK_EDTIME: string;
    TAA_FREE1_ARRTIME: string;
    TAA_FREE1_EDTIME: string;
    TAA_FREE2_ARRTIME: string;
    TAA_FREE2_EDTIME: string;
    TAA_FULL1_ARRTIME: string;
    TAA_FULL1_EDTIME: string;
    TAA_FULL2_ARRTIME: string;
    TAA_FULL2_EDTIME: string;
    TAA_CONTRACTOR: string;
    TAA_VOY_ID: string;
    TAA_CNL_WAIT_SECONDS: number;
    TAA_CNL_AGO_ID: string;
    TAA_PRIOR_EDTIME: string;
    TAA_VALIDFG: string;
    TAA_WI_ID: string;
    TAA_ORC_ID: string;
    TAA_CNTRNO: string;
    TAA_CREATEUSER: string;
    TAA_FREE_PB_ARRTIME: string;
    TAA_FREE_PB_EDTIME: string;
    TAA_FULL_PB_ARRTIME: string;
    TAA_FULL_PB_EDTIME: string;
    TAA_FREE1_ST_TP_ID: string;
    TAA_FREE1_ED_TP_ID: string;
    TAA_FREE2_ST_TP_ID: string;
    TAA_FREE2_ED_TP_ID: string;
    TAA_FULL1_ST_TP_ID: string;
    TAA_FULL1_ED_TP_ID: string;
    TAA_FULL2_ST_TP_ID: string;
    TAA_FULL2_ED_TP_ID: string;
    TAA_FREE_PB_ID: string;
    TAA_FULL_PB_ID: string;
    TAA_MILEAGE: number;
    TAA_CREATEDT: string;
}

interface TOSPayload {
    table: string;
    synthetic: boolean;
    rowCount: number;
    rows: TOSAGVTaskRecord[];
}

export class TOSAGVTaskSource {
    constructor(
        private readonly url = "/data/simulation/yangshan_phase4/TOS_STA_AGV_CNTR_INFOS.json"
    ) {}

    async load(signal?: AbortSignal): Promise<TOSAGVTaskRecord[]> {
        const response = await fetch(this.url, { signal, cache: "no-cache" });
        if (!response.ok) {
            throw new Error(`TOS AGV task request failed: ${response.status}`);
        }
        const payload = await response.json() as TOSPayload;
        if (payload.table !== "TOS_STA_AGV_CNTR_INFOS" || !Array.isArray(payload.rows)) {
            throw new Error("Invalid TOS_STA_AGV_CNTR_INFOS dataset.");
        }
        return payload.rows;
    }
}
