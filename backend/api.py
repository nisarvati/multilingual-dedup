"""
api.py

FastAPI server wrapping the multilingual dedup pipeline.

Endpoints:
    POST /upload          — Upload CSV, get back column names for selection
    POST /run             — Run pipeline on uploaded file with chosen column
    GET  /status/{job_id} — Poll job progress (SSE-friendly)
    GET  /results/{job_id}— Get full results + clusters + arbiter decisions
    GET  /health          — Health check

Design decisions:
    - Jobs run in a background thread so /run returns immediately
    - Progress is stored in-memory (dict) and polled via /status
    - Column mapping: user picks any CSV column → pipeline sees it as "text"
    - Arbiter is optional: skipped gracefully if GEMINI_API_KEY missing or quota hit
    - No DB: job store is in-memory, fine for demo/hackathon scope
"""

import csv
import io
import json
import os
import time
import traceback
import uuid
from pathlib import Path
from threading import Thread
from typing import Any, Dict, List, Optional

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="Multilingual Dedup API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten in prod
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# IN-MEMORY JOB STORE
# ============================================================

jobs: Dict[str, Dict[str, Any]] = {}
# Shape: { job_id: { status, progress, stage, records, results, error } }


def new_job() -> str:
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "pending",      # pending | running | done | error
        "progress": 0,            # 0-100
        "stage": "Queued",
        "records": [],            # raw parsed records (after column mapping)
        "results": None,          # final results dict
        "error": None,
    }
    return job_id


def update_job(job_id: str, **kwargs):
    jobs[job_id].update(kwargs)


# ============================================================
# REQUEST / RESPONSE MODELS
# ============================================================

class RunRequest(BaseModel):
    job_id: str           # from /upload response
    text_column: str      # which CSV column to use as the dedup text
    language_column: Optional[str] = None   # optional — auto-detected if absent
    id_column: Optional[str] = None         # optional — uses row index if absent
    threshold: Optional[float] = 0.76
    top_n_arbiter: Optional[int] = 15


class UploadResponse(BaseModel):
    job_id: str
    columns: List[str]
    row_count: int
    preview: List[Dict]   # first 5 rows


class StatusResponse(BaseModel):
    job_id: str
    status: str
    progress: int
    stage: str
    error: Optional[str]


class ResultsResponse(BaseModel):
    job_id: str
    status: str
    metrics: Optional[Dict]
    clusters: Optional[List[List[Dict]]]       # each cluster = list of record dicts
    grey_zone_pairs: Optional[List[Dict]]
    arbiter_decisions: Optional[List[Dict]]
    total_records: Optional[int]
    total_clusters: Optional[int]


# ============================================================
# ENDPOINTS
# ============================================================

@app.get("/health")
def health():
    return {"status": "ok", "version": "1.0.0"}


@app.post("/upload", response_model=UploadResponse)
async def upload_csv(file: UploadFile = File(...)):
    """
    Accept a CSV upload. Returns column names + preview so the
    frontend can show a column selector before running the pipeline.
    """
    if not file.filename.endswith(".csv"):
        raise HTTPException(400, "Only CSV files are supported.")

    content = await file.read()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)

    if not rows:
        raise HTTPException(400, "CSV is empty.")

    columns = list(rows[0].keys())
    job_id = new_job()

    # Store raw rows in job so /run can access them without re-upload
    jobs[job_id]["raw_rows"] = rows
    jobs[job_id]["filename"] = file.filename

    return UploadResponse(
        job_id=job_id,
        columns=columns,
        row_count=len(rows),
        preview=rows[:5],
    )


@app.post("/run")
def run_pipeline(req: RunRequest):
    """
    Kick off the dedup pipeline in a background thread.
    Returns immediately with job_id — poll /status/{job_id} for progress.
    """
    if req.job_id not in jobs:
        raise HTTPException(404, f"Job {req.job_id} not found. Upload a file first.")

    job = jobs[req.job_id]
    if job["status"] == "running":
        raise HTTPException(409, "Job is already running.")

    raw_rows = job.get("raw_rows", [])
    if not raw_rows:
        raise HTTPException(400, "No data found for this job. Re-upload the file.")

    if req.text_column not in raw_rows[0]:
        raise HTTPException(
            400,
            f"Column '{req.text_column}' not found. "
            f"Available: {list(raw_rows[0].keys())}"
        )

    update_job(req.job_id, status="running", progress=0, stage="Starting...")
    thread = Thread(
        target=_run_pipeline_thread,
        args=(req.job_id, raw_rows, req),
        daemon=True,
    )
    thread.start()

    return {"job_id": req.job_id, "status": "running"}


@app.get("/status/{job_id}", response_model=StatusResponse)
def get_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, f"Job {job_id} not found.")
    j = jobs[job_id]
    return StatusResponse(
        job_id=job_id,
        status=j["status"],
        progress=j["progress"],
        stage=j["stage"],
        error=j.get("error"),
    )


@app.get("/results/{job_id}", response_model=ResultsResponse)
def get_results(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, f"Job {job_id} not found.")
    j = jobs[job_id]
    if j["status"] not in ("done", "error"):
        raise HTTPException(202, "Job not finished yet. Poll /status first.")
    if j["status"] == "error":
        raise HTTPException(500, j.get("error", "Unknown error"))

    r = j["results"]
    return ResultsResponse(
        job_id=job_id,
        status="done",
        metrics=r.get("metrics"),
        clusters=r.get("clusters"),
        grey_zone_pairs=r.get("grey_zone_pairs"),
        arbiter_decisions=r.get("arbiter_decisions"),
        total_records=r.get("total_records"),
        total_clusters=r.get("total_clusters"),
    )


# ============================================================
# BACKGROUND PIPELINE RUNNER
# ============================================================

def _run_pipeline_thread(job_id: str, raw_rows: List[Dict], req: RunRequest):
    """
    Runs the full pipeline in a background thread.
    Updates job progress at each stage so the frontend can poll.
    """
    try:
        # ---- Stage 1: Column mapping ----
        update_job(job_id, stage="Mapping columns...", progress=5)
        records = _map_columns(raw_rows, req)

        # ---- Stage 2: Load model ----
        update_job(job_id, stage="Loading LaBSE model...", progress=10)
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer("sentence-transformers/LaBSE")

        # ---- Stage 3: Embeddings ----
        update_job(job_id, stage="Generating embeddings...", progress=20)
        from dedupe_pipeline import generate_embeddings
        texts = [r["text"] for r in records]
        embeddings = generate_embeddings(texts, model)

        # ---- Stage 4: Similarity ----
        update_job(job_id, stage="Computing similarity matrix...", progress=45)
        from dedupe_pipeline import compute_semantic_similarity, compute_combined_scores
        sem_matrix = compute_semantic_similarity(embeddings)
        combined_matrix = compute_combined_scores(records, sem_matrix)

        # ---- Stage 5: Clustering ----
        update_job(job_id, stage="Clustering duplicates...", progress=65)
        from dedupe_pipeline import cluster_duplicates, find_grey_zone_pairs, UnionFind
        threshold = req.threshold
        clusters_ids = cluster_duplicates(records, combined_matrix, threshold)
        grey_zone = find_grey_zone_pairs(records, combined_matrix, threshold)

        # ---- Stage 6: Arbiter ----
        update_job(job_id, stage="Running Gemini arbitration...", progress=75)
        arbiter_decisions = []
        try:
            from gemini_arbiter import run_arbitration, UnionFind as ArbiterUF
            gemini_key = os.getenv("GEMINI_API_KEY")
            if not gemini_key:
                raise ValueError("No GEMINI_API_KEY set — skipping arbiter.")

            n = len(records)
            uf = ArbiterUF(n)
            for i in range(n):
                for j in range(i + 1, n):
                    if combined_matrix[i, j] >= threshold:
                        uf.union(i, j)

            updated_clusters_ids, decisions = run_arbitration(
                grey_zone_pairs=grey_zone,
                records=records,
                uf=uf,
                threshold=threshold,
                top_n=req.top_n_arbiter,
            )
            clusters_ids = updated_clusters_ids
            arbiter_decisions = [
                {
                    "text_a": d.text_a,
                    "text_b": d.text_b,
                    "similarity_score": d.similarity_score,
                    "is_duplicate": d.is_duplicate,
                    "confidence": d.confidence,
                    "reasoning": d.reasoning,
                    "abstained": d.abstained,
                }
                for d in decisions
            ]
        except Exception as e:
            print(f"[arbiter] Skipped: {e}")
            update_job(job_id, stage="Arbiter skipped — clustering complete...")

        # ---- Stage 7: Build response payload ----
        update_job(job_id, stage="Preparing results...", progress=90)

        id_to_record = {r["id"]: r for r in records}

        # Enrich clusters with full record data (not just IDs)
        clusters_enriched = [
            [id_to_record[rid] for rid in cluster]
            for cluster in clusters_ids
        ]

        # Enrich grey zone pairs
        grey_zone_enriched = [
            {
                "score": round(float(score), 4),
                "record_a": records[i],
                "record_b": records[j],
            }
            for i, j, score in grey_zone[:50]   # cap at 50 for payload size
        ]

        results = {
            "total_records": len(records),
            "total_clusters": len(clusters_ids),
            "metrics": None,         # no ground truth for user uploads
            "clusters": clusters_enriched,
            "grey_zone_pairs": grey_zone_enriched,
            "arbiter_decisions": arbiter_decisions,
        }

        # If this is the demo dataset, evaluate against ground truth
        gt_path = Path(__file__).parent.parent / "data" / "ground_truth.json"
        if gt_path.exists() and _is_demo_dataset(records):
            from dedupe_pipeline import load_ground_truth, evaluate
            ground_truth = load_ground_truth(gt_path)
            metrics = evaluate(clusters_ids, ground_truth, [r["id"] for r in records])
            results["metrics"] = {k: round(v, 3) if isinstance(v, float) else v
                                  for k, v in metrics.items()}

        update_job(job_id, status="done", progress=100,
                   stage="Complete", results=results)

    except Exception as e:
        tb = traceback.format_exc()
        print(f"[pipeline error] {tb}")
        update_job(job_id, status="error", progress=0,
                   stage="Error", error=str(e))


# ============================================================
# HELPERS
# ============================================================

def _map_columns(raw_rows: List[Dict], req: RunRequest) -> List[Dict]:
    """
    Map user-chosen columns onto the standard schema the pipeline expects:
        id, text, language, entity_type
    """
    records = []
    for idx, row in enumerate(raw_rows):
        record_id = (
            str(row[req.id_column])
            if req.id_column and req.id_column in row
            else f"R{idx:04d}"
        )
        language = (
            str(row[req.language_column])
            if req.language_column and req.language_column in row
            else "en"
        )
        records.append({
            "id": record_id,
            "text": str(row[req.text_column]),
            "language": language,
            "entity_type": row.get("entity_type", "unknown"),
            # Keep original row fields so frontend can display them
            "_original": dict(row),
        })
    return records


def _is_demo_dataset(records: List[Dict]) -> bool:
    """Heuristic: demo dataset IDs start with R followed by 4 digits."""
    return any(r["id"].startswith("R") and r["id"][1:].isdigit() for r in records[:5])


# ============================================================
# ENTRY POINT
# ============================================================


class ExplainRequest(BaseModel):
    text_a: str
    text_b: str
    language_a: str = "en"
    language_b: str = "en"
    semantic_score: float

@app.post("/explain")
def explain(req: ExplainRequest):
    from token_attribution import explain_pair_as_dict
    from dedupe_pipeline import compute_fuzzy_similarity, same_script
    fuzzy = compute_fuzzy_similarity(req.text_a, req.text_b)
    ss    = same_script(req.text_a, req.text_b)
    return explain_pair_as_dict(
        {"text": req.text_a, "language": req.language_a},
        {"text": req.text_b, "language": req.language_b},
        semantic_score=req.semantic_score,
        fuzzy_score=fuzzy,
        is_same_script=ss,
    )

    
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)