/// <reference types="vite/client" />

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

type JobStatus = "pending" | "running" | "done" | "error";

// ============================================================
// BACKEND RESPONSE TYPES (internal)
// ============================================================

interface BackendStatusResponse {
  job_id: string;
  status: JobStatus;
  progress: number;
  stage: string;
  error?: string | null;
}

interface BackendRecord {
  id: string;
  text: string;
  language: string;
  _original?: Record<string, string>;
}

interface BackendGreyZonePair {
  score: number;
  record_a: BackendRecord;
  record_b: BackendRecord;
}

interface BackendResultsResponse {
  job_id: string;
  status: "done";
  metrics?: Metrics | null;
  clusters?: BackendRecord[][] | null;
  grey_zone_pairs?: BackendGreyZonePair[] | null;
  arbiter_decisions?: ArbiterDecision[] | null;
  total_records?: number | null;
  total_clusters?: number | null;
  domain?: string | null;
  threshold_used?: number | null;
  language_breakdown?: Record<string, { clustered: number; unique: number }> | null;
  arbiter_status?: string | null;
  arbiter_message?: string | null;
  arbiter_results?: ArbiterDecision[] | null;
  decisions?: ArbiterDecision[] | null;
  used_faiss?: boolean | null;
}

interface BackendHeatmapResponse {
  records: BackendRecord[];
  matrix: number[][];
  threshold: number;
}

interface BackendExplainToken {
  token: string;
  score: number;
}

interface BackendExplainResponse {
  tokens_a: BackendExplainToken[];
  tokens_b: BackendExplainToken[];
  combined_score: number;
  semantic_contribution: number;
  fuzzy_contribution: number;
  matched_token_ratio: number;
}

// ============================================================
// PUBLIC TYPES (exported)
// ============================================================

export interface ArbiterDecision {
  text_a: string;
  text_b: string;
  similarity_score: number;
  is_duplicate: boolean;
  confidence: number;
  reasoning: string;
  abstained: boolean;
}

export interface UploadResponse {
  job_id: string;
  columns: string[];
  row_count: number;
  preview: Record<string, string>[];
  warnings?: string[];
}

export interface RunBody {
  job_id: string;
  text_column: string;
  language_column?: string;
  id_column?: string;
  domain?: string;
  threshold?: number;
  top_n_arbiter?: number;
  use_faiss?: boolean | null;  
  faiss_top_k?: number;   
}

export type StageKey =
  | "Queued"
  | "Mapping"
  | "Loading"
  | "Embedding"
  | "Similarity"
  | "Clustering"
  | "Arbiter"
  | "Preparing"
  | "Complete"
  | "Error";

export interface StatusResponse {
  jobId: string;
  status: JobStatus;
  progress: number;
  stage: string;
  stageKey: StageKey;
  error?: string | null;
}

export interface RecordItem {
  id: string;
  text: string;
  language: string;
  original?: Record<string, string>;
}

export interface Cluster {
  id: string;
  similarity: number;
  records: RecordItem[];
}

export interface GreyZonePair {
  id: string;
  similarity: number;
  record_a: RecordItem;
  record_b: RecordItem;
}

export interface Metrics {
  precision?: number;
  recall?: number;
  f1?: number;
}

export interface ResultsResponse {
  clusters: Cluster[];
  grey_zone_pairs: GreyZonePair[];
  arbiter_decisions: ArbiterDecision[];
  metrics: Metrics | null;
  total_records: number;
  total_clusters: number;
  domain?: string;
  threshold_used?: number;
  language_breakdown?: Record<string, { clustered: number; unique: number }>;
  arbiter_status?: "skipped" | "done";
  arbiter_message?: string;
  used_faiss?: boolean;
}

export interface ExplainResponse {
  similarity: number;
  tokens_a: { token: string; weight: number }[];
  tokens_b: { token: string; weight: number }[];
  rationale: string;
}

export interface HeatmapResponse {
  records: RecordItem[];
  matrix: number[][];
  threshold: number;
}

export interface DomainConfig {
  threshold: number;
  grey_zone: number;
  same_script: {
    semantic: number;
    fuzzy: number;
  };
  cross_script: {
    semantic: number;
    fuzzy: number;
  };
}

// ============================================================
// REQUEST HELPER
// ============================================================

async function request<T>(
  path: string,
  init?: RequestInit,
  timeoutMs = 12000
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`.trim();
      try {
        const errorBody = await response.json();
        if (typeof errorBody?.detail === "string") {
          message = errorBody.detail;
        }
      } catch {
        // ignore JSON parse failures
      }
      throw new Error(message);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out while contacting the backend.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

// ============================================================
// HELPERS
// ============================================================

function normalizeStage(stage?: string | null): StageKey {
  const v = stage?.toLowerCase() ?? "";
  if (v.includes("error")) return "Error";
  if (v.includes("complete")) return "Complete";
  if (v.includes("queue")) return "Queued";
  if (v.includes("mapping")) return "Mapping";
  if (v.includes("loading")) return "Loading";
  if (v.includes("embedding")) return "Embedding";
  if (v.includes("similarity")) return "Similarity";
  if (v.includes("cluster")) return "Clustering";
  if (v.includes("arbiter")) return "Arbiter";
  if (v.includes("preparing")) return "Preparing";
  return "Queued";
}

function normalizeRecord(r: BackendRecord): RecordItem {
  return {
    id: r.id,
    text: r.text,
    language: r.language || "en",
    original: r._original,
  };
}

function estimateSimilarity(a: string, b: string): number {
  const aSet = new Set(a.toLowerCase().split(/\W+/));
  const bSet = new Set(b.toLowerCase().split(/\W+/));
  const overlap = [...aSet].filter((x) => bSet.has(x)).length;
  const union = new Set([...aSet, ...bSet]).size || 1;
  return Number((overlap / union).toFixed(3));
}

export function estimateRecordSimilarity(a: RecordItem, b: RecordItem): number {
  return estimateSimilarity(a.text, b.text);
}

function estimateClusterSimilarity(records: RecordItem[]): number {
  if (records.length < 2) return 1;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      total += estimateRecordSimilarity(records[i], records[j]);
      pairs++;
    }
  }
  return Number((total / Math.max(pairs, 1)).toFixed(3));
}

// ============================================================
// PUBLIC API
// ============================================================

export const api = {
  async upload(file: File): Promise<UploadResponse> {
    const form = new FormData();
    form.append("file", file);
    return request<UploadResponse>("/upload", { method: "POST", body: form });
  },

  async run(body: RunBody): Promise<{ job_id: string; status: string }> {
    return request<{ job_id: string; status: string }>(
      "/run",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      20000
    );
  },

  async status(jobId: string): Promise<StatusResponse> {
    const res = await request<BackendStatusResponse>(
      `/status/${jobId}`,
      undefined,
      6000
    );
    return {
      jobId: res.job_id,
      status: res.status,
      progress: res.progress,
      stage: res.stage,
      stageKey: normalizeStage(res.stage) ?? "Queued",
      error: res.error,
    };
  },

  async results(jobId: string): Promise<ResultsResponse> {
    const res = await request<BackendResultsResponse>(
      `/results/${jobId}`,
      undefined,
      20000
    );

    const clusters: Cluster[] = (res.clusters ?? []).map((group, i) => {
      const records = group.map(normalizeRecord);
      return {
        id: `C${String(i + 1).padStart(3, "0")}`,
        similarity: estimateClusterSimilarity(records),
        records,
      };
    });

    const grey_zone_pairs: GreyZonePair[] = (res.grey_zone_pairs ?? []).map(
      (g, i) => ({
        id: `G${String(i + 1).padStart(3, "0")}`,
        similarity: Number(g.score.toFixed(3)),
        record_a: normalizeRecord(g.record_a),
        record_b: normalizeRecord(g.record_b),
      })
    );

    const arbiterDecisions = res.arbiter_decisions ?? res.arbiter_results ?? res.decisions ?? [];

    return {
      clusters,
      grey_zone_pairs,
      arbiter_decisions: arbiterDecisions,
      metrics: res.metrics ?? null,
      total_records: res.total_records ?? 0,
      total_clusters: res.total_clusters ?? clusters.length,
      domain: res.domain ?? undefined,
      threshold_used: res.threshold_used ?? undefined,
      language_breakdown: res.language_breakdown ?? undefined,
      arbiter_status: res.arbiter_status === "skipped" ? "skipped" : res.arbiter_status === "done" ? "done" : undefined,
      arbiter_message: res.arbiter_message ?? undefined,
      used_faiss: res.used_faiss ?? false,
    };
  },

  async heatmap(jobId: string, clusterIndex: number): Promise<HeatmapResponse> {
    const res = await request<BackendHeatmapResponse>(
      `/heatmap/${jobId}/${clusterIndex}`,
      undefined,
      20000
    );

    return {
      records: res.records.map(normalizeRecord),
      matrix: res.matrix,
      threshold: res.threshold,
    };
  },

  async explain(
    a: RecordItem,
    b: RecordItem,
    similarity?: number
  ): Promise<ExplainResponse> {
    const res = await request<BackendExplainResponse>(
      "/explain",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text_a: a.text,
          text_b: b.text,
          language_a: a.language,
          language_b: b.language,
          semantic_score: similarity ?? estimateRecordSimilarity(a, b),
        }),
      },
      20000
    );
    return {
      similarity: res.combined_score,
      tokens_a: res.tokens_a.map((t) => ({ token: t.token, weight: t.score })),
      tokens_b: res.tokens_b.map((t) => ({ token: t.token, weight: t.score })),
      rationale: `Semantic ${res.semantic_contribution.toFixed(2)}, fuzzy ${res.fuzzy_contribution.toFixed(2)}, matched-token ratio ${(res.matched_token_ratio * 100).toFixed(0)}%`,
    };
  },

  async exportResults(jobId: string, format: "csv" | "pdf"): Promise<void> {
    const response = await fetch(`${API_BASE}/export/${jobId}?format=${format}`);
    if (!response.ok) {
      throw new Error(`Failed to export ${format.toUpperCase()} report.`);
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = `dedup-results-${jobId}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(blobUrl);
  },

  async rethreshold(
    jobId: string,
    threshold: number
  ): Promise<{ total_clusters: number; total_flagged: number; clusters: any[] }> {
    return request(
      "/rethreshold",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, threshold }),
      },
      10000
    );
  },

  async feedback(
    jobId: string,
    recordIdA: string,
    recordIdB: string,
    isDuplicate: boolean
  ): Promise<{ feedback_count: number; suggested_threshold: number | null; message: string }> {
    return request(
      "/feedback",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          record_id_a: recordIdA,
          record_id_b: recordIdB,
          is_duplicate: isDuplicate,
        }),
      },
      10000
    );
  },

  async domains(): Promise<{
    domains: string[];
    default: string;
    configs: Record<string, DomainConfig>;
  }> {
    return request("/domains", undefined, 5000);
  },
};
