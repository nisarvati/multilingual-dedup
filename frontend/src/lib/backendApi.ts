const API_BASE = ((import.meta as ImportMeta).env.VITE_API_BASE ?? "").replace(/\/$/, "");

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
  entity_type?: string;
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
  match: string;
  score: number;
  is_exact: boolean;
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
  top_n_arbiter?: number;
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

export interface ArbiterDecision extends BackendArbiterDecision {}

export interface ResultsResponse {
  clusters: Cluster[];
  grey_zone_pairs: GreyZonePair[];
  arbiter_decisions: ArbiterDecision[];
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

async function request<T>(path: string, init?: RequestInit, timeoutMs = 12000): Promise<T> {
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
        // Ignore JSON parse failures for non-JSON error responses.
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

function normalizeStage(stage: string): StageKey {
  const value = stage.toLowerCase();
  if (value.includes("error")) return "Error";
  if (value.includes("complete")) return "Complete";
  if (value.includes("queue")) return "Queued";
  if (value.includes("mapping")) return "Mapping";
  if (value.includes("loading")) return "Loading";
  if (value.includes("embedding")) return "Embedding";
  if (value.includes("similarity")) return "Similarity";
  if (value.includes("cluster")) return "Clustering";
  if (value.includes("arbiter")) return "Arbiter";
  if (value.includes("preparing")) return "Preparing";
  return "Queued";
}

function normalizeRecord(record: BackendRecord): RecordItem {
  return {
    id: record.id,
    text: record.text,
    language: record.language || "en",
    original: record._original,
  };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function estimateTextSimilarity(a: string, b: string): number {
  const left = tokenize(a);
  const right = tokenize(b);

  if (!left.length && !right.length) return 1;

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const overlap = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size || 1;
  const jaccard = overlap / union;

  const aCompact = a.replace(/\s+/g, "").toLowerCase();
  const bCompact = b.replace(/\s+/g, "").toLowerCase();
  const aChars = new Set(aCompact);
  const bChars = new Set(bCompact);
  const charOverlap = [...aChars].filter((char) => bChars.has(char)).length;
  const charScore = charOverlap / Math.max(aChars.size, bChars.size, 1);

  return Number((jaccard * 0.7 + charScore * 0.3).toFixed(3));
}

export function estimateRecordSimilarity(a: RecordItem, b: RecordItem): number {
  return estimateTextSimilarity(a.text, b.text);
}

function estimateClusterSimilarity(records: RecordItem[]): number {
  if (records.length < 2) return 1;

  let total = 0;
  let pairs = 0;

  for (let i = 0; i < records.length; i += 1) {
    for (let j = i + 1; j < records.length; j += 1) {
      total += estimateRecordSimilarity(records[i], records[j]);
      pairs += 1;
    }
  }

  return Number((total / Math.max(pairs, 1)).toFixed(3));
}

function normalizeResults(response: BackendResultsResponse): ResultsResponse {
  const clusters = (response.clusters ?? []).map((cluster, index) => {
    const records = cluster.map(normalizeRecord);

    return {
      id: `C${String(index + 1).padStart(3, "0")}`,
      similarity: estimateClusterSimilarity(records),
      records,
    };
  });

  const greyZonePairs = (response.grey_zone_pairs ?? []).map((pair, index) => ({
    id: `G${String(index + 1).padStart(3, "0")}`,
    similarity: Number(pair.score.toFixed(3)),
    record_a: normalizeRecord(pair.record_a),
    record_b: normalizeRecord(pair.record_b),
  }));

  return {
    clusters,
    grey_zone_pairs: greyZonePairs,
    arbiter_decisions: response.arbiter_decisions ?? [],
    metrics: response.metrics ?? {},
    total_records: response.total_records ?? 0,
    total_clusters: response.total_clusters ?? clusters.length,
  };
}

function normalizeExplain(response: BackendExplainResponse): ExplainResponse {
  return {
    similarity: response.combined_score,
    tokens_a: response.tokens_a.map((token) => ({
      token: token.token,
      weight: token.score,
    })),
    tokens_b: response.tokens_b.map((token) => ({
      token: token.token,
      weight: token.score,
    })),
    rationale: `Semantic contribution ${response.semantic_contribution.toFixed(3)}, fuzzy contribution ${response.fuzzy_contribution.toFixed(3)}, matched-token ratio ${(response.matched_token_ratio * 100).toFixed(0)}%.`,
  };
}

export const api = {
  async upload(file: File): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append("file", file);

    return request<UploadResponse>("/upload", {
      method: "POST",
      body: formData,
    });
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
    const response = await request<BackendStatusResponse>(`/status/${jobId}`, undefined, 6000);

    return {
      jobId: response.job_id,
      status: response.status,
      progress: response.progress,
      stage: response.stage,
      stageKey: normalizeStage(response.stage),
      error: response.error,
    };
  },

  async results(jobId: string): Promise<ResultsResponse> {
    const response = await request<BackendResultsResponse>(`/results/${jobId}`, undefined, 20000);
    return normalizeResults(response);
  },

  async explain(a: RecordItem, b: RecordItem, similarity: number): Promise<ExplainResponse> {
    const response = await request<BackendExplainResponse>(
      "/explain",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text_a: a.text,
          text_b: b.text,
          language_a: a.language,
          language_b: b.language,
          semantic_score: similarity,
        }),
      },
      20000
    );

    return normalizeExplain(response);
  },
};
