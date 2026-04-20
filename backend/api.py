"""
api.py
FastAPI server wrapping the multilingual dedup pipeline.

Endpoints:
    POST /upload              — Upload CSV, get back column names for selection
    POST /run                 — Run pipeline on uploaded file with chosen column
    GET  /status/{job_id}     — Poll job progress
    GET  /results/{job_id}    — Get full results + clusters + arbiter decisions
    POST /rethreshold         — Re-cluster with new threshold (uses cached matrix)
    POST /feedback            — Submit thumbs up/down for active learning
    POST /explain             — Token attribution for a pair
    GET  /export/{job_id}     — Download deduplicated CSV
    GET  /health              — Health check

Design decisions:
    - Jobs run in a background thread so /run returns immediately
    - Progress is stored in-memory (dict) and polled via /status
    - Column mapping: user picks any CSV column → pipeline sees it as "text"
    - Domain-aware thresholds and weights loaded from dedupe_pipeline.DOMAIN_CONFIG
    - Arbiter is optional: skipped gracefully if OPENAI_API_KEY missing or quota hit
    - No DB: job store is in-memory, fine for demo/hackathon scope
"""

import csv
import io
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
from fastapi.responses import StreamingResponse
from langdetect import DetectorFactory
from pydantic import BaseModel

DetectorFactory.seed = 42
load_dotenv()

app = FastAPI(title="Multilingual Dedup API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# IN-MEMORY JOB STORE
# ============================================================

jobs: Dict[str, Dict[str, Any]] = {}


def new_job() -> str:
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "pending",
        "progress": 0,
        "stage": "Queued",
        "records": [],
        "results": None,
        "error": None,
        "combined_matrix": None,
        "feedback": [],
    }
    return job_id


def update_job(job_id: str, **kwargs):
    jobs[job_id].update(kwargs)


# ============================================================
# LANGUAGE DETECTION
# ============================================================

def _detect_language(text: str) -> str:
    """Auto-detect language using langdetect with script-based fallback."""
    try:
        import langdetect
        return langdetect.detect(text)
    except Exception:
        from dedupe_pipeline import detect_script
        script_to_lang = {
            "latin": "en", "cjk": "zh", "arabic": "ar",
            "devanagari": "hi", "thai": "th", "hangul": "ko", "other": "en",
        }
        detected_script = detect_script(text)
        return script_to_lang.get(detected_script, "en")


# ============================================================
# CSV VALIDATION
# ============================================================

def _validate_csv(rows: List[Dict], text_column: str) -> List[str]:
    """Return list of warning strings about data quality issues."""
    warnings = []

    empty = sum(1 for r in rows if not str(r.get(text_column, "")).strip())
    if empty > 0:
        warnings.append(f"{empty} records have empty text — they will be skipped")

    short = sum(1 for r in rows if 0 < len(str(r.get(text_column, ""))) < 3)
    if short > 0:
        warnings.append(
            f"{short} records are very short (under 3 chars) — matching may be unreliable"
        )

    from dedupe_pipeline import detect_script
    sample = [str(r.get(text_column, "")) for r in rows[:100] if str(r.get(text_column, "")).strip()]
    scripts = set(detect_script(t) for t in sample)
    if len(scripts) == 1:
        warnings.append(
            "Only one script detected in sample — this tool works best with multilingual data"
        )

    if len(rows) > 5000:
        warnings.append(
            f"{len(rows)} records detected — processing may take several minutes"
        )

    return warnings


# ============================================================
# REQUEST / RESPONSE MODELS
# ============================================================

class RunRequest(BaseModel):
    job_id: str
    text_column: str
    language_column: Optional[str] = None
    id_column: Optional[str] = None
    domain: Optional[str] = "E-commerce Products"
    threshold: Optional[float] = None      # derived from domain if not set
    top_n_arbiter: Optional[int] = 15


class UploadResponse(BaseModel):
    job_id: str
    columns: List[str]
    row_count: int
    preview: List[Dict]
    warnings: List[str]


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
    clusters: Optional[List[List[Dict]]]
    grey_zone_pairs: Optional[List[Dict]]
    arbiter_decisions: Optional[List[Dict]]
    arbiter_status: Optional[str]
    arbiter_message: Optional[str]
    total_records: Optional[int]
    total_clusters: Optional[int]
    domain: Optional[str]
    threshold_used: Optional[float]
    domain_config: Optional[Dict]
    language_breakdown: Optional[Dict]


class RethresholdRequest(BaseModel):
    job_id: str
    threshold: float


class FeedbackRequest(BaseModel):
    job_id: str
    record_id_a: str
    record_id_b: str
    is_duplicate: bool


class ExplainRequest(BaseModel):
    text_a: str
    text_b: str
    language_a: str = "en"
    language_b: str = "en"
    semantic_score: float
    domain: str = "E-commerce Products"


# ============================================================
# ENDPOINTS
# ============================================================


@app.get("/health")
def health():
    return {"status": "ok", "version": "1.0.0"}


@app.get("/domains")
def get_domains():
    """Return available domains and their configs for the frontend dropdown."""
    from dedupe_pipeline import DOMAIN_CONFIG, DEFAULT_DOMAIN
    return {
        "domains": list(DOMAIN_CONFIG.keys()),
        "default": DEFAULT_DOMAIN,
        "configs": DOMAIN_CONFIG,
    }


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
    if len(rows) > 50_000:
        raise HTTPException(400, "File too large — maximum 50,000 rows supported.")

    columns = list(rows[0].keys())
    if not columns:
        raise HTTPException(400, "CSV has no columns.")

    job_id = new_job()
    jobs[job_id]["raw_rows"] = rows
    jobs[job_id]["filename"] = file.filename

    # Run validation on the first detected text column as a heuristic
    # Full validation happens in /run once user picks the column
    warnings = []
    if len(rows) > 5000:
        warnings.append(f"{len(rows)} records detected — processing may take several minutes")

    return UploadResponse(
        job_id=job_id,
        columns=columns,
        row_count=len(rows),
        preview=rows[:5],
        warnings=warnings,
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
            f"Available: {list(raw_rows[0].keys())}",
        )

    # Run column-specific validation now that we know the text column
    warnings = _validate_csv(raw_rows, req.text_column)
    update_job(
        req.job_id,
        status="running",
        progress=0,
        stage="Starting...",
        warnings=warnings,
    )

    thread = Thread(
        target=_run_pipeline_thread,
        args=(req.job_id, raw_rows, req),
        daemon=True,
    )
    thread.start()
    return {"job_id": req.job_id, "status": "running", "warnings": warnings}


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
        arbiter_status=r.get("arbiter_status"),
        arbiter_message=r.get("arbiter_message"),
        total_records=r.get("total_records"),
        total_clusters=r.get("total_clusters"),
        domain=r.get("domain"),
        threshold_used=r.get("threshold_used"),
        domain_config=r.get("domain_config"),
        language_breakdown=r.get("language_breakdown"),
    )


@app.post("/rethreshold")
def rethreshold(req: RethresholdRequest):
    """
    Re-cluster using cached similarity matrix at a new threshold.
    Returns updated clusters instantly — no re-embedding needed.
    """
    if req.job_id not in jobs:
        raise HTTPException(404, "Job not found.")

    j = jobs[req.job_id]
    if j["status"] != "done":
        raise HTTPException(400, "Job not complete yet.")

    combined_matrix = j.get("combined_matrix")
    records = j.get("records")
    domain = j.get("domain", "E-commerce Products")

    if combined_matrix is None or records is None:
        raise HTTPException(400, "Cached matrix not found. Re-run the pipeline.")

    from dedupe_pipeline import cluster_duplicates, find_grey_zone_pairs
    matrix = np.array(combined_matrix)

    clusters_ids = cluster_duplicates(records, matrix, req.threshold)
    grey_zone = find_grey_zone_pairs(records, matrix, req.threshold, domain=domain)

    id_to_record = {r["id"]: r for r in records}
    clusters_enriched = [
        [id_to_record[rid] for rid in cluster]
        for cluster in clusters_ids
    ]
    grey_zone_enriched = [
        {
            "score": round(float(score), 4),
            "record_a": records[i],
            "record_b": records[j],
        }
        for i, j, score in grey_zone[:50]
    ]

    # Count records flagged as duplicates
    flagged_ids = {rid for cluster in clusters_ids for rid in cluster}

    return {
        "threshold": req.threshold,
        "total_clusters": len(clusters_ids),
        "total_flagged": len(flagged_ids),
        "clusters": clusters_enriched,
        "grey_zone_pairs": grey_zone_enriched,
    }


@app.post("/feedback")
def submit_feedback(req: FeedbackRequest):
    """
    Accept user correction (thumbs up/down) on a duplicate pair.
    After 3+ corrections, suggests an updated threshold.
    This is the active learning loop.
    """
    if req.job_id not in jobs:
        raise HTTPException(404, "Job not found.")

    j = jobs[req.job_id]
    if "feedback" not in j:
        j["feedback"] = []

    j["feedback"].append({
        "record_id_a": req.record_id_a,
        "record_id_b": req.record_id_b,
        "is_duplicate": req.is_duplicate,
        "timestamp": time.time(),
    })

    feedback_count = len(j["feedback"])
    suggested_threshold = None
    message = f"{3 - feedback_count} more corrections needed to suggest a threshold adjustment"

    if feedback_count >= 3:
        records = j.get("records", [])
        matrix = j.get("combined_matrix")
        if records and matrix is not None:
            suggested_threshold = _optimize_threshold_from_feedback(
                records, np.array(matrix), j["feedback"]
            )
            current = j["results"]["threshold_used"] if j.get("results") else 0.76
            if abs(suggested_threshold - current) < 0.01:
                message = f"Your corrections confirm the current threshold ({current:.2f}) is well-calibrated"
            else:
                message = (
                    f"Based on your {feedback_count} corrections, "
                    f"threshold {suggested_threshold:.2f} may work better "
                    f"(currently {current:.2f})"
                )

    return {
        "feedback_count": feedback_count,
        "suggested_threshold": round(suggested_threshold, 3) if suggested_threshold else None,
        "message": message,
    }


@app.post("/explain")
def explain(req: ExplainRequest):
    """Token-level attribution for a duplicate pair."""
    from token_attribution import explain_pair_as_dict
    from dedupe_pipeline import compute_fuzzy_similarity, same_script
    fuzzy = compute_fuzzy_similarity(req.text_a, req.text_b)
    ss = same_script(req.text_a, req.text_b)
    return explain_pair_as_dict(
        {"text": req.text_a, "language": req.language_a},
        {"text": req.text_b, "language": req.language_b},
        semantic_score=req.semantic_score,
        fuzzy_score=fuzzy,
        is_same_script=ss,
        domain=req.domain,
    )


@app.get("/export/{job_id}")
def export_results(job_id: str, format: str = "csv"):
    if job_id not in jobs:
        raise HTTPException(404, "Job not found.")

    j = jobs[job_id]
    if j["status"] != "done":
        raise HTTPException(400, "Job not complete yet.")

    records = j.get("records", [])
    clusters = j["results"].get("clusters", [])
    domain = j["results"].get("domain", "E-commerce Products")
    threshold = j["results"].get("threshold_used", 0.76)
    total_records = j["results"].get("total_records", 0)
    total_clusters = j["results"].get("total_clusters", 0)

    # Build cluster_id mapping
    record_to_cluster = {}
    for idx, cluster in enumerate(clusters):
        for record in cluster:
            record_to_cluster[record["id"]] = idx + 1

    if format == "pdf":
        return _export_pdf(
            records, clusters, record_to_cluster,
            domain, threshold, total_records, total_clusters, job_id
        )
    else:
        return _export_csv(records, record_to_cluster, job_id)


def _export_csv(records, record_to_cluster, job_id):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "text", "language", "cluster_id", "is_duplicate"])
    for record in records:
        cluster_id = record_to_cluster.get(record["id"], "")
        is_dup = record["id"] in record_to_cluster
        writer.writerow([
            record["id"],
            record["text"],
            record.get("language", ""),
            cluster_id,
            is_dup,
        ])
    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode()),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=deduplicated_{job_id[:8]}.csv"
        },
    )


def _export_pdf(records, clusters, record_to_cluster, domain, threshold,
                total_records, total_clusters, job_id):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.lib import colors
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
    )
    from reportlab.lib.enums import TA_CENTER

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=2*cm, leftMargin=2*cm,
        topMargin=2*cm, bottomMargin=2*cm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "Title", parent=styles["Title"],
        fontSize=20, spaceAfter=6, textColor=colors.HexColor("#1a1a2e")
    )
    heading_style = ParagraphStyle(
        "Heading", parent=styles["Heading2"],
        fontSize=13, spaceAfter=4, textColor=colors.HexColor("#16213e")
    )
    body_style = ParagraphStyle(
        "Body", parent=styles["Normal"],
        fontSize=9, spaceAfter=3
    )
    small_style = ParagraphStyle(
        "Small", parent=styles["Normal"],
        fontSize=8, textColor=colors.grey
    )

    story = []

    # ---- Title ----
    story.append(Paragraph("Multilingual Deduplication Report", title_style))
    story.append(Paragraph(f"Job ID: {job_id[:8]}  |  Domain: {domain}  |  Threshold: {threshold}", small_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#e0e0e0")))
    story.append(Spacer(1, 0.4*cm))

    # ---- Summary stats ----
    story.append(Paragraph("Summary", heading_style))
    duplicate_records = len(record_to_cluster)
    unique_records = total_records - duplicate_records
    reduction_pct = round((duplicate_records / total_records * 100), 1) if total_records else 0

    summary_data = [
        ["Metric", "Value"],
        ["Total records processed", str(total_records)],
        ["Unique entities found", str(unique_records)],
        ["Duplicate records flagged", str(duplicate_records)],
        ["Duplicate groups", str(total_clusters)],
        ["Data reduction", f"{reduction_pct}%"],
        ["Domain", domain],
        ["Threshold used", str(threshold)],
    ]
    summary_table = Table(summary_data, colWidths=[8*cm, 8*cm])
    summary_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a1a2e")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f5f5")]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 0.6*cm))

@app.get("/heatmap/{job_id}/{cluster_index}")
def get_heatmap(job_id: str, cluster_index: int):
    if job_id not in jobs:
        raise HTTPException(404, "Job not found.")

    j = jobs[job_id]

    if j["status"] != "done":
        raise HTTPException(400, "Job not complete yet.")
    if not j.get("combined_matrix"):
        raise HTTPException(400, "Cached matrix not found. Re-run the pipeline.")

    clusters = j["results"]["clusters"]

    if cluster_index >= len(clusters):
        raise HTTPException(404, "Cluster index out of range.")

    cluster = clusters[cluster_index]
    records = j.get("records", [])
    matrix = np.array(j.get("combined_matrix", []))

    id_to_idx = {r["id"]: i for i, r in enumerate(records)}

    n = len(cluster)
    heatmap_data = []

    for i in range(n):
        row = []
        for k in range(n):
            if i == k:
                row.append(1.0)
            else:
                idx_i = id_to_idx.get(cluster[i]["id"])
                idx_k = id_to_idx.get(cluster[k]["id"])
                if idx_i is not None and idx_k is not None:
                    row.append(round(float(matrix[idx_i][idx_k]), 4))
                else:
                    row.append(0.0)
        heatmap_data.append(row)

    return {
        "cluster_index": cluster_index,
        "records": [
            {"id": r["id"], "text": r["text"], "language": r.get("language", "")}
            for r in cluster
        ],
        "matrix": heatmap_data,
        "threshold": j["results"].get("threshold_used", 0.76),
    }
    
    # ---- Duplicate groups ----
    story.append(Paragraph(f"Duplicate Groups ({len(clusters)} groups)", heading_style))
    story.append(Paragraph(
        "Records in the same group refer to the same real-world entity across languages.",
        small_style
    ))
    story.append(Spacer(1, 0.3*cm))

    for idx, cluster in enumerate(clusters[:50]):  # cap at 50 groups in PDF
        story.append(Paragraph(
            f"Group {idx + 1} — {len(cluster)} records",
            ParagraphStyle("GroupHeader", parent=styles["Normal"],
                          fontSize=9, fontName="Helvetica-Bold",
                          textColor=colors.HexColor("#16213e"))
        ))
        group_data = [["ID", "Text", "Language"]]
        for record in cluster:
            text = record["text"][:60] + "..." if len(record["text"]) > 60 else record["text"]
            group_data.append([record["id"], text, record.get("language", "")])

        group_table = Table(group_data, colWidths=[2.5*cm, 11*cm, 2.5*cm])
        group_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8eaf6")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#e0e0e0")),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
        ]))
        story.append(group_table)
        story.append(Spacer(1, 0.2*cm))

    if len(clusters) > 50:
        story.append(Paragraph(
            f"... and {len(clusters) - 50} more groups. Download CSV for full data.",
            small_style
        ))

    # ---- Full records table ----
    story.append(Spacer(1, 0.4*cm))
    story.append(Paragraph("All Records", heading_style))
    story.append(Paragraph("Complete list with duplicate flags.", small_style))
    story.append(Spacer(1, 0.3*cm))

    records_data = [["ID", "Text", "Lang", "Cluster", "Duplicate"]]
    for record in records[:200]:  # cap at 200 rows for PDF readability
        text = record["text"][:45] + "..." if len(record["text"]) > 45 else record["text"]
        cluster_id = record_to_cluster.get(record["id"], "-")
        is_dup = "Yes" if record["id"] in record_to_cluster else "No"
        records_data.append([
            record["id"], text, record.get("language", ""),
            str(cluster_id), is_dup
        ])

    records_table = Table(records_data, colWidths=[2*cm, 9.5*cm, 1.5*cm, 2*cm, 1*cm])
    records_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a1a2e")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#e0e0e0")),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9f9f9")]),
        # Highlight duplicate rows
        *[
            ("TEXTCOLOR", (4, i+1), (4, i+1), colors.red)
            for i, record in enumerate(records[:200])
            if record["id"] in record_to_cluster
        ],
    ]))
    story.append(records_table)

    if len(records) > 200:
        story.append(Spacer(1, 0.2*cm))
        story.append(Paragraph(
            f"Showing 200 of {len(records)} records. Download CSV for complete data.",
            small_style
        ))

    doc.build(story)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=dedup_report_{job_id[:8]}.pdf"
        },
    )

# ============================================================
# BACKGROUND PIPELINE RUNNER
# ============================================================

def _run_pipeline_thread(job_id: str, raw_rows: List[Dict], req: RunRequest):
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

        # ---- Stage 4: Similarity + Domain config ----
        update_job(job_id, stage="Computing similarity matrix...", progress=45)
        from dedupe_pipeline import (
            compute_semantic_similarity,
            compute_combined_scores,
            get_domain_config,
            DEFAULT_DOMAIN,
        )
        domain = req.domain or DEFAULT_DOMAIN
        config = get_domain_config(domain)
        threshold = req.threshold if req.threshold is not None else config["threshold"]

        sem_matrix = compute_semantic_similarity(embeddings)
        combined_matrix = compute_combined_scores(records, sem_matrix, domain=domain)

        # Cache matrix and records for rethreshold + feedback
        jobs[job_id]["combined_matrix"] = combined_matrix.tolist()
        jobs[job_id]["records"] = records
        jobs[job_id]["domain"] = domain

        # ---- Stage 5: Clustering ----
        update_job(job_id, stage="Clustering duplicates...", progress=65)
        from dedupe_pipeline import cluster_duplicates, find_grey_zone_pairs
        clusters_ids = cluster_duplicates(records, combined_matrix, threshold)
        grey_zone = find_grey_zone_pairs(
            records, combined_matrix, threshold, domain=domain
        )

        # ---- Stage 6: LLM Arbitration ----
        update_job(job_id, stage="Running LLM arbitration...", progress=75)
        arbiter_decisions = []
        arbiter_status = "skipped"
        arbiter_message = "LLM arbiter did not run for this job."
        try:
            from llm_arbiter import run_arbitration, UnionFind as ArbiterUF
            openai_key = os.getenv("OPENAI_API_KEY")
            if not openai_key:
                raise ValueError("No OPENAI_API_KEY set - skipping arbiter.")

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
            arbiter_status = "completed"
            arbiter_message = f"Reviewed {len(arbiter_decisions)} grey-zone pairs with the LLM arbiter."
        except Exception as e:
            print(f"[arbiter] Skipped: {e}")
            arbiter_status = "skipped"
            arbiter_message = str(e)
            update_job(job_id, stage="Arbiter skipped - clustering complete...")

        # ---- Stage 7: Build response payload ----
        update_job(job_id, stage="Preparing results...", progress=90)
        id_to_record = {r["id"]: r for r in records}

        clusters_enriched = [
            [id_to_record[rid] for rid in cluster]
            for cluster in clusters_ids
        ]
        grey_zone_enriched = [
            {
                "score": round(float(score), 4),
                "record_a": records[i],
                "record_b": records[j],
            }
            for i, j, score in grey_zone[:50]
        ]

        # Language breakdown
        lang_breakdown = _language_breakdown(clusters_enriched, records)

        results = {
            "total_records": len(records),
            "total_clusters": len(clusters_ids),
            "metrics": None,
            "clusters": clusters_enriched,
            "grey_zone_pairs": grey_zone_enriched,
            "arbiter_decisions": arbiter_decisions,
            "arbiter_status": arbiter_status,
            "arbiter_message": arbiter_message,
            "domain": domain,
            "threshold_used": threshold,
            "domain_config": config,
            "language_breakdown": lang_breakdown,
        }

        # Evaluate against ground truth if demo dataset
        gt_path = Path(__file__).parent.parent / "data" / "ground_truth.json"
        if gt_path.exists() and _is_demo_dataset(records):
            from dedupe_pipeline import load_ground_truth, evaluate
            ground_truth = load_ground_truth(gt_path)
            metrics = evaluate(
                clusters_ids, ground_truth, [r["id"] for r in records]
            )
            results["metrics"] = {
                k: round(v, 3) if isinstance(v, float) else v
                for k, v in metrics.items()
            }

        update_job(
            job_id,
            status="done",
            progress=100,
            stage="Complete",
            results=results,
        )

    except Exception as e:
        tb = traceback.format_exc()
        print(f"[pipeline error] {tb}")
        update_job(
            job_id,
            status="error",
            progress=0,
            stage="Error",
            error=str(e),
        )


# ============================================================
# HELPERS
# ============================================================

def _map_columns(raw_rows: List[Dict], req: RunRequest) -> List[Dict]:
    records = []
    for idx, row in enumerate(raw_rows):
        text = str(row.get(req.text_column, "")).strip()
        if not text:
            continue  # skip empty rows

        record_id = (
            str(row[req.id_column])
            if req.id_column and req.id_column in row
            else f"R{idx:04d}"
        )

        if req.language_column and req.language_column in row:
            language = str(row[req.language_column])
        else:
            language = _detect_language(text)

        records.append({
            "id": record_id,
            "text": text,
            "language": language,
            "entity_type": row.get("entity_type", "unknown"),
            "_original": dict(row),
        })
    return records


def _is_demo_dataset(records: List[Dict]) -> bool:
    return any(
        r["id"].startswith("R") and r["id"][1:].isdigit()
        for r in records[:5]
    )


def _language_breakdown(clusters: List[List[Dict]], all_records: List[Dict]) -> Dict:
    clustered_ids = {r["id"] for cluster in clusters for r in cluster}
    breakdown: Dict[str, Dict[str, int]] = {}
    for record in all_records:
        lang = record.get("language", "unknown")
        if lang not in breakdown:
            breakdown[lang] = {"clustered": 0, "unique": 0}
        if record["id"] in clustered_ids:
            breakdown[lang]["clustered"] += 1
        else:
            breakdown[lang]["unique"] += 1
    return breakdown


def _optimize_threshold_from_feedback(
    records: List[Dict],
    matrix: np.ndarray,
    feedback: List[Dict],
) -> float:
    id_to_idx = {r["id"]: i for i, r in enumerate(records)}
    best_threshold = 0.76
    best_agreement = -1

    for t in np.arange(0.65, 0.96, 0.01):
        agreement = 0
        total = 0
        for fb in feedback:
            idx_a = id_to_idx.get(fb["record_id_a"])
            idx_b = id_to_idx.get(fb["record_id_b"])
            if idx_a is None or idx_b is None:
                continue
            score = float(matrix[idx_a][idx_b])
            predicted_dup = score >= t
            if predicted_dup == fb["is_duplicate"]:
                agreement += 1
            total += 1
        if total > 0 and agreement > best_agreement:
            best_agreement = agreement
            best_threshold = float(round(t, 2))

    return best_threshold


# ============================================================
# ENTRY POINT
# ============================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
