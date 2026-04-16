// API client for the duplicate detection backend.
// Falls back to mock data when the backend isn't reachable so the UI
// remains fully usable for demos.

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "http://localhost:8000";

export interface UploadResponse {
  job_id: string;
  columns: string[];
  row_count: number;
  preview: Record<string, string>[];
}

export interface RunBody {
  job_id: string;
  text_column: string;
  language_column: string;
  id_column: string;
  threshold: number;
}

export type Stage = "Mapping" | "Embedding" | "Similarity" | "Clustering" | "Arbiter";

export interface StatusResponse {
  status: "pending" | "running" | "done" | "error";
  progress: number; // 0-100
  stage: Stage;
}

export interface RecordItem {
  id: string;
  text: string;
  language: string;
}

export interface Cluster {
  id: string;
  similarity: number; // 0-1
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
  arbiter_decisions: number;
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

async function request<T>(path: string, init?: RequestInit, timeoutMs = 4000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

// ---------- Mock generators ----------
function mockUpload(file: File): UploadResponse {
  const columns = ["id", "text", "language", "country"];
  const preview = [
    { id: "1", text: "Apple iPhone 15 Pro Max 256GB", language: "en", country: "US" },
    { id: "2", text: "iPhone 15 Pro Max - 256 GB Apple", language: "en", country: "UK" },
    { id: "3", text: "Téléphone Apple iPhone 15 Pro Max", language: "fr", country: "FR" },
    { id: "4", text: "Samsung Galaxy S24 Ultra", language: "en", country: "US" },
    { id: "5", text: "Galaxy S24 Ultra Samsung 512GB", language: "en", country: "DE" },
  ];
  return {
    job_id: `mock-${Date.now()}`,
    columns,
    row_count: Math.max(1234, Math.round(file.size / 80)),
    preview,
  };
}

function mockResults(): ResultsResponse {
  const clusters: Cluster[] = [
    {
      id: "c-001",
      similarity: 0.96,
      records: [
        { id: "r1", text: "Apple iPhone 15 Pro Max 256GB Titanium", language: "en" },
        { id: "r2", text: "iPhone 15 Pro Max - 256 GB - Apple Titan", language: "en" },
        { id: "r3", text: "Téléphone Apple iPhone 15 Pro Max 256 Go", language: "fr" },
      ],
    },
    {
      id: "c-002",
      similarity: 0.89,
      records: [
        { id: "r4", text: "Samsung Galaxy S24 Ultra 512GB", language: "en" },
        { id: "r5", text: "Galaxy S24 Ultra Samsung 512 GB Phantom", language: "en" },
      ],
    },
    {
      id: "c-003",
      similarity: 0.74,
      records: [
        { id: "r6", text: "Sony WH-1000XM5 Wireless Headphones", language: "en" },
        { id: "r7", text: "Sony Auriculares WH-1000XM5 inalámbricos", language: "es" },
        { id: "r8", text: "Casque Sony WH-1000XM5 sans fil", language: "fr" },
      ],
    },
    {
      id: "c-004",
      similarity: 0.62,
      records: [
        { id: "r9", text: "Nintendo Switch OLED White", language: "en" },
        { id: "r10", text: "Switch OLED Nintendo Blanche", language: "fr" },
      ],
    },
  ];
  const grey_zone_pairs: GreyZonePair[] = [
    {
      id: "g-1",
      similarity: 0.71,
      record_a: { id: "x1", text: "Dell XPS 13 9340 Intel Core Ultra 7", language: "en" },
      record_b: { id: "x2", text: "Dell XPS 13 (9340) i7 Ultra Laptop", language: "en" },
    },
    {
      id: "g-2",
      similarity: 0.68,
      record_a: { id: "x3", text: "MacBook Air M3 13-inch Midnight", language: "en" },
      record_b: { id: "x4", text: "Apple MacBook Air M3 13\" Minuit", language: "fr" },
    },
  ];
  return {
    clusters,
    grey_zone_pairs,
    arbiter_decisions: 17,
    metrics: { precision: 0.94, recall: 0.91, f1: 0.925 },
    total_records: 1234,
    total_clusters: clusters.length,
  };
}

function mockExplain(a: RecordItem, b: RecordItem): ExplainResponse {
  const tokenize = (s: string) =>
    s.split(/\s+/).map((token, i) => ({
      token,
      weight: Math.min(1, Math.max(0, 0.3 + Math.sin(i * 1.7 + token.length) * 0.5 + 0.4)),
    }));
  return {
    similarity: 0.91,
    tokens_a: tokenize(a.text),
    tokens_b: tokenize(b.text),
    rationale:
      "Brand and model tokens dominate the alignment. Numeric specs (storage, size) reinforce the match across languages via cross-lingual embeddings.",
  };
}

// ---------- Public API ----------
export const api = {
  async upload(file: File): Promise<UploadResponse> {
    try {
      const fd = new FormData();
      fd.append("file", file);
      return await request<UploadResponse>("/upload", { method: "POST", body: fd });
    } catch {
      await new Promise((r) => setTimeout(r, 600));
      return mockUpload(file);
    }
  },
  async run(body: RunBody): Promise<{ ok: true }> {
    try {
      await request("/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // ignore — mock pipeline handled by status poller
    }
    return { ok: true };
  },
  async status(jobId: string): Promise<StatusResponse> {
    try {
      return await request<StatusResponse>(`/status/${jobId}`, undefined, 2000);
    } catch {
      return mockStatus(jobId);
    }
  },
  async results(jobId: string): Promise<ResultsResponse> {
    try {
      return await request<ResultsResponse>(`/results/${jobId}`);
    } catch {
      return mockResults();
    }
  },
  async explain(a: RecordItem, b: RecordItem): Promise<ExplainResponse> {
    try {
      return await request<ExplainResponse>("/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ a, b }),
      });
    } catch {
      return mockExplain(a, b);
    }
  },
};

// ---------- Mock pipeline state ----------
const mockStarted = new Map<string, number>();
function mockStatus(jobId: string): StatusResponse {
  if (!mockStarted.has(jobId)) mockStarted.set(jobId, Date.now());
  const elapsed = (Date.now() - (mockStarted.get(jobId) ?? Date.now())) / 1000;
  const total = 8; // seconds
  const progress = Math.min(100, Math.round((elapsed / total) * 100));
  const stages: Stage[] = ["Mapping", "Embedding", "Similarity", "Clustering", "Arbiter"];
  const stage = stages[Math.min(stages.length - 1, Math.floor((progress / 100) * stages.length))];
  return {
    status: progress >= 100 ? "done" : "running",
    progress,
    stage,
  };
}
