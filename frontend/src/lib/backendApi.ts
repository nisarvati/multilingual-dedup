/// <reference types="vite/client" />

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

type JobStatus = "pending" | "running" | "done" | "error";

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

interface BackendArbiterDecision {
  text_a: string;
  text_b: string;
  similarity_score: number;
  is_duplicate: boolean;
  confidence: number;
  reasoning: string;
  abstained: boolean;
}

interface BackendResultsResponse {
  job_id: string;
  status: "done";
  metrics?: Metrics | null;
  clusters?: BackendRecord[][] | null;
  grey_zone_pairs?: BackendGreyZonePair[] | null;
  arbiter_decisions?: BackendArbiterDecision[] | null;
  total_records?: number | null;
  total_clusters?: number | null;
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

export interface UploadResponse {
  job_id: string;
  columns: string[];
  row_count: number;
  preview: Record<string, string>[];
}

export interface RunBody {
  job_id: string;
  text_column: string;
  language_column?: string;
  id_column?: string;
  threshold: number;
}

export interface StatusResponse {
  jobId: string;
  status: JobStatus;
  progress: number;
  stage: string;
  error?: string | null;
}

export interface RecordItem {
  id: string;
  text: string;
  language: string;
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
  arbiter_decisions: BackendArbiterDecision[];
  metrics: Metrics;
  total_records: number;
  total_clusters: number;
}

export interface ExplainResponse {
  similarity: number;
  tokens_a: { token: string; weight: number }[];
  tokens_b: { token: string; weight: number }[];
  rationale: string;
}

/* ---------------- REQUEST HELPER ---------------- */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);

  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }

  return res.json();
}

/* ---------------- HELPERS ---------------- */

function normalizeRecord(r: BackendRecord): RecordItem {
  return {
    id: r.id,
    text: r.text,
    language: r.language || "en",
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

/* ---------------- API ---------------- */

export const api = {
  async upload(file: File): Promise<UploadResponse> {
    const form = new FormData();
    form.append("file", file);

    return request("/upload", {
      method: "POST",
      body: form,
    });
  },

  async run(body: RunBody) {
    return request("/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  async status(jobId: string): Promise<StatusResponse> {
    const res = await request<BackendStatusResponse>(`/status/${jobId}`);
    return {
      jobId: res.job_id,
      status: res.status,
      progress: res.progress,
      stage: res.stage,
      error: res.error,
    };
  },

  async results(jobId: string): Promise<ResultsResponse> {
    const res = await request<BackendResultsResponse>(`/results/${jobId}`);

    const clusters: Cluster[] = (res.clusters ?? []).map((group, i) => {
      const records = group.map(normalizeRecord);
      return {
        id: `C${i + 1}`,
        similarity: 1,
        records,
      };
    });

    const grey: GreyZonePair[] = (res.grey_zone_pairs ?? []).map((g, i) => ({
      id: `G${i + 1}`,
      similarity: g.score,
      record_a: normalizeRecord(g.record_a),
      record_b: normalizeRecord(g.record_b),
    }));

    return {
      clusters,
      grey_zone_pairs: grey,
      arbiter_decisions: res.arbiter_decisions ?? [],
      metrics: res.metrics ?? {},
      total_records: res.total_records ?? 0,
      total_clusters: res.total_clusters ?? clusters.length,
    };
  },

  async explain(a: RecordItem, b: RecordItem, similarity: number): Promise<ExplainResponse> {
    const res = await request<BackendExplainResponse>("/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text_a: a.text,
        text_b: b.text,
        semantic_score: similarity,
      }),
    });

    return {
      similarity: res.combined_score,
      tokens_a: res.tokens_a.map((t) => ({ token: t.token, weight: t.score })),
      tokens_b: res.tokens_b.map((t) => ({ token: t.token, weight: t.score })),
      rationale: `Semantic ${res.semantic_contribution.toFixed(2)}, fuzzy ${res.fuzzy_contribution.toFixed(2)}`,
    };
  },

  exportResults(jobId: string, format: "csv" | "pdf") {
    window.open(`${API_BASE}/export/${jobId}?format=${format}`, "_blank");
  },
};