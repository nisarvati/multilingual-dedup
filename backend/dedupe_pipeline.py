"""
Core multilingual duplicate detection pipeline.

Pipeline stages:
1. Load CSV
2. Enrich short records with category context
3. Generate multilingual embeddings (LaBSE)
4. Compute pairwise semantic similarity (cosine)
5. Compute fuzzy string similarity (rapidfuzz) on ORIGINAL text
6. Combine into weighted score with script-aware weighting
7. Cluster records above threshold using Union-Find
8. Evaluate against ground truth

Usage:
    python dedupe_pipeline.py
"""

import csv
import json
import time
import unicodedata
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
from rapidfuzz import fuzz
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity

from dotenv import load_dotenv
load_dotenv()
# ============================================================
# CONFIG
# ============================================================

MODEL_NAME = "sentence-transformers/LaBSE"
DATA_DIR = Path(__file__).parent.parent / "data"
CSV_PATH = DATA_DIR / "demo_dataset.csv"
GROUND_TRUTH_PATH = DATA_DIR / "ground_truth.json"

THRESHOLD = 0.76
SAME_SCRIPT_WEIGHTS = {"semantic": 0.85, "fuzzy": 0.15}
CROSS_SCRIPT_WEIGHTS = {"semantic": 0.97, "fuzzy": 0.03}

DOMAIN_CONFIG = {
    "E-commerce Products": {
        "threshold": 0.82,
        "grey_zone": 0.04,
        "same_script":  {"semantic": 0.80, "fuzzy": 0.20},
        "cross_script": {"semantic": 0.97, "fuzzy": 0.03},
    },
    "Company Names": {
        "threshold": 0.76,
        "grey_zone": 0.05,
        "same_script":  {"semantic": 0.75, "fuzzy": 0.25},
        "cross_script": {"semantic": 0.97, "fuzzy": 0.03},
    },
    "Person Names": {
        "threshold": 0.79,
        "grey_zone": 0.05,
        "same_script":  {"semantic": 0.55, "fuzzy": 0.45},
        "cross_script": {"semantic": 0.90, "fuzzy": 0.10},
    },
    "Medical Records": {
        "threshold": 0.91,
        "grey_zone": 0.03,
        "same_script":  {"semantic": 0.85, "fuzzy": 0.15},
        "cross_script": {"semantic": 0.98, "fuzzy": 0.02},
    },
}
DOMAIN_CONFIG["Others"] = DOMAIN_CONFIG["E-commerce Products"]
DEFAULT_DOMAIN = "E-commerce Products"

def get_domain_config(domain: str) -> dict:
    if domain == "Others":
        domain = DEFAULT_DOMAIN
    return DOMAIN_CONFIG.get(domain, DOMAIN_CONFIG[DEFAULT_DOMAIN])

# Disable category enrichment for now - it was causing under-clustering
# by making all records in a category look too similar
SHORT_TEXT_THRESHOLD = 0  # effectively disables enrichment


# ============================================================
# CONTEXT ENRICHMENT
# ============================================================

# Category labels in multiple languages so we don't force English context
# onto non-English records (which would confuse the embedding)
CATEGORY_LABELS = {
    "product": {
        "en": "product", "ja": "製品", "zh": "产品", "ar": "منتج",
        "hi": "उत्पाद", "th": "สินค้า", "ko": "제품",
    },
    "company": {
        "en": "company", "ja": "会社", "zh": "公司", "ar": "شركة",
        "hi": "कंपनी", "th": "บริษัท", "ko": "회사",
    },
    "person": {
        "en": "person", "ja": "人", "zh": "人", "ar": "شخص",
        "hi": "व्यक्ति", "th": "บุคคล", "ko": "사람",
    },
}


def enrich_text_for_embedding(record: Dict) -> str:
    """Context enrichment disabled - was causing under-clustering on category-heavy data."""
    return record["text"]


# ============================================================
# SCRIPT DETECTION
# ============================================================

def detect_script(text: str) -> str:
    scripts = {}
    for char in text:
        if char.isspace() or char.isdigit() or not char.isalpha():
            continue
        try:
            name = unicodedata.name(char)
            if "LATIN" in name:
                script = "latin"
            elif "CJK" in name or "HIRAGANA" in name or "KATAKANA" in name:
                script = "cjk"
            elif "HANGUL" in name:
                script = "hangul"
            elif "ARABIC" in name:
                script = "arabic"
            elif "DEVANAGARI" in name:
                script = "devanagari"
            elif "THAI" in name:
                script = "thai"
            else:
                script = "other"
            scripts[script] = scripts.get(script, 0) + 1
        except ValueError:
            continue
    if not scripts:
        return "latin"
    return max(scripts, key=scripts.get)


def same_script(text_a: str, text_b: str) -> bool:
    return detect_script(text_a) == detect_script(text_b)


# ============================================================
# DATA LOADING
# ============================================================

def load_records(csv_path: Path) -> List[Dict]:
    records = []
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            records.append(row)
    return records


def load_ground_truth(gt_path: Path) -> Dict[str, List[str]]:
    with open(gt_path, "r", encoding="utf-8") as f:
        return json.load(f)


# ============================================================
# EMBEDDING GENERATION
# ============================================================

def generate_embeddings(texts: List[str], model: SentenceTransformer) -> np.ndarray:
    print(f"  Generating embeddings for {len(texts)} records...")
    start = time.time()
    embeddings = model.encode(
        texts,
        batch_size=32,
        show_progress_bar=True,
        convert_to_numpy=True,
        normalize_embeddings=True,
    )
    elapsed = time.time() - start
    print(f"  Done in {elapsed:.2f}s ({len(texts)/elapsed:.1f} records/sec)")
    return embeddings


# ============================================================
# SIMILARITY COMPUTATION
# ============================================================

def compute_semantic_similarity(embeddings: np.ndarray) -> np.ndarray:
    print("  Computing semantic similarity matrix...")
    return cosine_similarity(embeddings)


def compute_fuzzy_similarity(text_a: str, text_b: str) -> float:
    return fuzz.token_sort_ratio(text_a, text_b) / 100.0


def compute_combined_scores(
    records: List[Dict],
    semantic_matrix: np.ndarray,
    domain: str = DEFAULT_DOMAIN,        # NEW parameter
) -> np.ndarray:
    config = get_domain_config(domain)   # NEW
    print(f"  Using domain: '{domain}'")
    print(f"  Computing combined scores (script-aware weights)...")
    n = len(records)
    combined = np.zeros((n, n))

    for i in range(n):
        for j in range(i + 1, n):
            text_a = records[i]["text"]
            text_b = records[j]["text"]
            semantic = semantic_matrix[i, j]
            fuzzy = compute_fuzzy_similarity(text_a, text_b)

            if same_script(text_a, text_b):
                w = config["same_script"]    # domain-specific weights
            else:
                w = config["cross_script"]   # domain-specific weights

            score = w["semantic"] * semantic + w["fuzzy"] * fuzzy
            combined[i, j] = score
            combined[j, i] = score

    np.fill_diagonal(combined, 1.0)
    return combined

def find_candidate_pairs_faiss(
    embeddings: np.ndarray,
    top_k: int = 15,
) -> List[Tuple[int, int]]:
    """Use FAISS to find top-K nearest neighbors per record instead of all pairs."""
    import faiss
    n, d = embeddings.shape

    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    normalized = (embeddings / np.maximum(norms, 1e-10)).astype(np.float32)

    index = faiss.IndexFlatIP(d)
    index.add(normalized)
    _, indices = index.search(normalized, top_k + 1)

    seen = set()
    pairs = []
    for i in range(n):
        for k in range(1, top_k + 1):
            j = int(indices[i, k])
            if j < 0:
                continue
            pair = (min(i, j), max(i, j))
            if pair not in seen:
                seen.add(pair)
                pairs.append(pair)
    return pairs


def compute_combined_scores_faiss(
    records: List[Dict],
    embeddings: np.ndarray,
    domain: str = DEFAULT_DOMAIN,
    top_k: int = 15,
) -> np.ndarray:
    """
    Sparse similarity computation using FAISS candidate pairs.
    O(n log n) instead of O(n²) — much faster for large datasets.
    Accuracy tradeoff: may miss pairs outside top-K neighbors.
    """
    n = len(records)
    combined = np.zeros((n, n))
    np.fill_diagonal(combined, 1.0)

    config = get_domain_config(domain)
    candidate_pairs = find_candidate_pairs_faiss(embeddings, top_k=top_k)

    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    normalized = embeddings / np.maximum(norms, 1e-10)

    for i, j in candidate_pairs:
        semantic = float(np.dot(normalized[i], normalized[j]))
        fuzzy = compute_fuzzy_similarity(records[i]["text"], records[j]["text"])
        w = config["same_script"] if same_script(
            records[i]["text"], records[j]["text"]
        ) else config["cross_script"]
        score = w["semantic"] * semantic + w["fuzzy"] * fuzzy
        combined[i, j] = score
        combined[j, i] = score

    return combined


# ============================================================
# CLUSTERING (Union-Find)
# ============================================================

class UnionFind:
    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, x, y):
        px, py = self.find(x), self.find(y)
        if px == py:
            return
        if self.rank[px] < self.rank[py]:
            px, py = py, px
        self.parent[py] = px
        if self.rank[px] == self.rank[py]:
            self.rank[px] += 1


def cluster_duplicates(
    records: List[Dict],
    score_matrix: np.ndarray,
    threshold: float,
) -> List[List[str]]:
    n = len(records)
    uf = UnionFind(n)
    for i in range(n):
        for j in range(i + 1, n):
            if score_matrix[i, j] >= threshold:
                uf.union(i, j)
    clusters = {}
    for i in range(n):
        root = uf.find(i)
        clusters.setdefault(root, []).append(records[i]["id"])
    return [ids for ids in clusters.values() if len(ids) > 1]


# ============================================================
# EVALUATION
# ============================================================

def evaluate(
    predicted_clusters: List[List[str]],
    ground_truth: Dict[str, List[str]],
    all_record_ids: List[str],
) -> Dict:
    true_pairs = set()
    for record_ids in ground_truth.values():
        if len(record_ids) < 2:
            continue
        for i in range(len(record_ids)):
            for j in range(i + 1, len(record_ids)):
                pair = tuple(sorted([record_ids[i], record_ids[j]]))
                true_pairs.add(pair)

    predicted_pairs = set()
    for cluster in predicted_clusters:
        for i in range(len(cluster)):
            for j in range(i + 1, len(cluster)):
                pair = tuple(sorted([cluster[i], cluster[j]]))
                predicted_pairs.add(pair)

    tp = len(true_pairs & predicted_pairs)
    fp = len(predicted_pairs - true_pairs)
    fn = len(true_pairs - predicted_pairs)

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

    return {
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "total_predicted_pairs": len(predicted_pairs),
        "total_true_pairs": len(true_pairs),
    }


# ============================================================
# GREY-ZONE DETECTION
# ============================================================

def find_grey_zone_pairs(records, score_matrix, threshold, band=None, domain=DEFAULT_DOMAIN):
    if band is None:
        band = get_domain_config(domain)["grey_zone"]  # use domain-specific band
    n = len(records)
    grey = []
    seen = set()
    for i in range(n):
        for j in range(i + 1, n):
            s = score_matrix[i, j]
            if abs(s - threshold) <= band:
                key = tuple(sorted([
                    records[i]["text"].strip().lower(),
                    records[j]["text"].strip().lower()
                ]))
                if key not in seen:
                    seen.add(key)
                    grey.append((i, j, s))
    return grey


# ============================================================
# MAIN PIPELINE
# ============================================================

def run_pipeline():
    domain = DEFAULT_DOMAIN
    config = get_domain_config(domain)
    threshold = config["threshold"]

    print("=" * 60)
    print("MULTILINGUAL DUPLICATE DETECTION PIPELINE")
    print("=" * 60)

    print("\n[1/7] Loading data...")
    records = load_records(CSV_PATH)
    ground_truth = load_ground_truth(GROUND_TRUTH_PATH)
    print(f"  Loaded {len(records)} records, {len(ground_truth)} entity groups")

    print("\n[2/7] Enriching short records with category context...")
    enriched_texts = [enrich_text_for_embedding(r) for r in records]
    num_enriched = sum(1 for r, e in zip(records, enriched_texts) if e != r["text"])
    print(f"  Enriched {num_enriched}/{len(records)} short records")
    print(f"  Example: '{records[0]['text']}' -> '{enriched_texts[0]}'")

    print(f"\n[3/7] Loading model: {MODEL_NAME}")
    print("  (first run will download ~1.8GB, subsequent runs are instant)")
    model = SentenceTransformer(MODEL_NAME)

    print("\n[4/7] Generating embeddings (from enriched texts)...")
    embeddings = generate_embeddings(enriched_texts, model)

    print("\n[5/7] Computing similarity...")
    semantic_matrix = compute_semantic_similarity(embeddings)
    combined_matrix = compute_combined_scores(records, semantic_matrix, domain=domain)

    print(f"\n[6/7] Clustering duplicates (threshold={THRESHOLD})...")
    clusters = cluster_duplicates(records, combined_matrix, threshold)
    print(f"  Found {len(clusters)} duplicate groups")

    print("\n[7/7] Evaluating against ground truth...")
    metrics = evaluate(clusters, ground_truth, [r["id"] for r in records])

    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)
    print(f"Precision: {metrics['precision']:.3f}")
    print(f"Recall:    {metrics['recall']:.3f}")
    print(f"F1 Score:  {metrics['f1']:.3f}")
    print(f"\nTrue positives:  {metrics['true_positives']}")
    print(f"False positives: {metrics['false_positives']}")
    print(f"False negatives: {metrics['false_negatives']}")
    print(f"\nPredicted duplicate pairs: {metrics['total_predicted_pairs']}")
    print(f"Actual duplicate pairs:    {metrics['total_true_pairs']}")

    grey_zone = find_grey_zone_pairs(records, combined_matrix, threshold, domain=domain)
    print(f"\nGrey zone pairs (±0.05 of threshold): {len(grey_zone)}")
    print("  -> these will be sent to LLM arbitration in the full system")

    print("\n" + "=" * 60)
    print("SAMPLE DUPLICATE GROUPS (first 5)")
    print("=" * 60)
    id_to_record = {r["id"]: r for r in records}
    for i, cluster in enumerate(clusters[:5]):
        print(f"\nGroup {i + 1} ({len(cluster)} records):")
        for rid in cluster:
            r = id_to_record[rid]
            print(f"  [{r['language']}] {rid}: {r['text']}")

    if grey_zone:
        print("\n" + "=" * 60)
        print(f"SAMPLE GREY ZONE PAIRS (first 5 of {len(grey_zone)})")
        print("=" * 60)
        for i, j, score in grey_zone[:5]:
            ra = records[i]
            rb = records[j]
            print(f"\nScore: {score:.3f}")
            print(f"  [{ra['language']}] {ra['text']}")
            print(f"  [{rb['language']}] {rb['text']}")

    try:
        from llm_arbiter import run_arbitration, UnionFind as ArbiterUF
        import os
        print(f"\n  OPENAI_API_KEY: {'SET' if os.getenv('OPENAI_API_KEY') else 'MISSING'}")
        n = len(records)
        uf = ArbiterUF(n)
        for i in range(n):
            for j in range(i + 1, n):
                if combined_matrix[i, j] >= THRESHOLD:
                    uf.union(i, j)
        updated_clusters, decisions = run_arbitration(
            grey_zone_pairs=grey_zone,
            records=records,
            uf=uf,
            threshold=THRESHOLD,
            save_path=Path(__file__).parent / "arbiter_results.json",
        )
        clusters = updated_clusters
    except Exception as e:
        print(f"\n  [!] Arbiter skipped: {e}")
        import traceback
        traceback.print_exc()
        print("      Pipeline continuing with embedding-only clusters.")
    print("\n" + "=" * 60)
    return clusters, metrics, combined_matrix

def calibrate_threshold(records, combined_matrix, ground_truth):
    """Sweep thresholds to find optimal F1."""
    print("\n" + "=" * 60)
    print("THRESHOLD CALIBRATION (Grid Search)")
    print("=" * 60)
    
    best_f1 = 0
    best_threshold = 0
    all_record_ids = [r["id"] for r in records]
    
    for t in np.arange(0.70, 0.96, 0.01):
        clusters = cluster_duplicates(records, combined_matrix, t)
        metrics = evaluate(clusters, ground_truth, all_record_ids)
        marker = " <<<" if metrics["f1"] > best_f1 else ""
        print(f"  t={t:.2f}  P={metrics['precision']:.3f}  R={metrics['recall']:.3f}  F1={metrics['f1']:.3f}{marker}")
        if metrics["f1"] > best_f1:
            best_f1 = metrics["f1"]
            best_threshold = t
    
    print(f"\nOptimal: threshold={best_threshold:.2f}, F1={best_f1:.3f}")
    grey = find_grey_zone_pairs(records, combined_matrix, best_threshold)
    print(f"Grey zone pairs at optimal: {len(grey)}")
    return best_threshold

if __name__ == "__main__":
    clusters, metrics, combined_matrix = run_pipeline()
    
    # Load data again for calibration
    records = load_records(CSV_PATH)
    ground_truth = load_ground_truth(GROUND_TRUTH_PATH)
    calibrate_threshold(records, combined_matrix, ground_truth)
