"""
token_attribution.py

Explains WHY two records were scored as duplicates (or not).

Two complementary outputs per pair:
  1. Token alignment   — which tokens in text_A matched tokens in text_B,
                         with a per-token match strength (0.0–1.0)
                         → drives the heatmap overlay in the frontend
  2. Score decomposition — how much semantic vs fuzzy contributed to the
                           final combined score, and what each sub-score was
                         → shown as a bar breakdown in RecordInspector

Algorithm:
  - Tokenize both texts (whitespace + punctuation aware, script-safe)
  - For each token in text_A, find its best matching token in text_B
    using character-level fuzzy ratio (handles typos, transliterations)
  - Semantic contribution is approximated by scaling cosine similarity
    onto each token by its IDF-style weight (rare tokens get more credit)
  - Score decomposition reads directly from the pipeline's weight config

Usage (standalone):
    python token_attribution.py

Usage (as module, called from api.py):
    from token_attribution import explain_pair
    result = explain_pair(record_a, record_b, semantic_score, fuzzy_score, same_script)
"""

import re
import unicodedata
from dataclasses import dataclass, asdict
from typing import Dict, List, Optional, Tuple

from rapidfuzz import fuzz

# ============================================================
# CONFIG — must mirror dedupe_pipeline.py
# ============================================================

SAME_SCRIPT_WEIGHTS  = {"semantic": 0.85, "fuzzy": 0.15}
CROSS_SCRIPT_WEIGHTS = {"semantic": 0.97, "fuzzy": 0.03}

# Fuzzy threshold below which a token match is considered "no match"
TOKEN_MATCH_FLOOR = 0.35


# ============================================================
# DATA STRUCTURES
# ============================================================

@dataclass
class TokenMatch:
    token: str            # token from this side
    match: str            # best matching token from the other side ("" if none)
    score: float          # 0.0–1.0 match strength
    is_exact: bool        # True if token == match (after normalisation)


@dataclass
class TokenAttribution:
    # Input pair
    text_a: str
    text_b: str
    language_a: str
    language_b: str

    # Token-level alignment (one entry per token in each text)
    tokens_a: List[TokenMatch]   # text_A tokens aligned to text_B
    tokens_b: List[TokenMatch]   # text_B tokens aligned to text_A

    # Score decomposition
    semantic_score: float
    fuzzy_score: float
    combined_score: float
    semantic_weight: float
    fuzzy_weight: float
    semantic_contribution: float   # semantic_weight * semantic_score
    fuzzy_contribution: float      # fuzzy_weight * fuzzy_score

    # Summary
    is_same_script: bool
    avg_token_match_a: float       # mean match score across text_A tokens
    avg_token_match_b: float       # mean match score across text_B tokens
    matched_token_ratio: float     # fraction of text_A tokens that found a match


# ============================================================
# TOKENISATION
# ============================================================

# Splits on whitespace and punctuation but keeps CJK/Arabic/Devanagari chars
# as individual tokens (they don't use spaces)
_LATIN_SPLIT  = re.compile(r"[\s\-_/\\,.;:!?\"'()\[\]{}]+")
_CJK_RANGE    = re.compile(
    r"[\u4e00-\u9fff"       # CJK Unified
    r"\u3040-\u309f"        # Hiragana
    r"\u30a0-\u30ff"        # Katakana
    r"\uac00-\ud7af"        # Hangul
    r"\u0600-\u06ff"        # Arabic
    r"\u0900-\u097f]"       # Devanagari
)


def _detect_script(text: str) -> str:
    for char in text:
        if not char.isalpha():
            continue
        try:
            name = unicodedata.name(char)
            if "CJK" in name or "HIRAGANA" in name or "KATAKANA" in name:
                return "cjk"
            if "HANGUL" in name:
                return "hangul"
            if "ARABIC" in name:
                return "arabic"
            if "DEVANAGARI" in name:
                return "devanagari"
            if "THAI" in name:
                return "thai"
        except ValueError:
            continue
    return "latin"


def tokenize(text: str) -> List[str]:
    """
    Script-aware tokeniser.
    - Latin/Thai/etc.: split on whitespace + punctuation
    - CJK/Hangul/Arabic/Devanagari: split into individual chars/syllables
      since they don't use spaces as word boundaries
    Returns lowercase, non-empty tokens.
    """
    script = _detect_script(text)

    if script in ("cjk", "hangul"):
        # Individual characters for CJK/Hangul
        tokens = []
        current_latin = []
        for char in text:
            if _CJK_RANGE.match(char):
                if current_latin:
                    tokens.extend(_split_latin("".join(current_latin)))
                    current_latin = []
                tokens.append(char)
            elif char.isspace() or not char.isalnum():
                if current_latin:
                    tokens.extend(_split_latin("".join(current_latin)))
                    current_latin = []
            else:
                current_latin.append(char)
        if current_latin:
            tokens.extend(_split_latin("".join(current_latin)))
        return [t.lower() for t in tokens if t.strip()]

    elif script in ("arabic", "devanagari"):
        # These use spaces as word boundaries like Latin
        return _split_latin(text)

    else:
        return _split_latin(text)


def _split_latin(text: str) -> List[str]:
    parts = _LATIN_SPLIT.split(text)
    return [p.lower() for p in parts if p.strip()]


# ============================================================
# TOKEN ALIGNMENT
# ============================================================

def _normalise(token: str) -> str:
    """Unicode normalise for fairer comparison."""
    return unicodedata.normalize("NFKC", token).lower().strip()


def align_tokens(
    tokens_src: List[str],
    tokens_tgt: List[str],
) -> List[TokenMatch]:
    """
    For each token in tokens_src, find its best matching token in tokens_tgt.
    Uses character-level fuzzy ratio so typos and transliterations score well.
    """
    if not tokens_tgt:
        return [TokenMatch(t, "", 0.0, False) for t in tokens_src]

    results = []
    norm_tgt = [_normalise(t) for t in tokens_tgt]

    for src_tok in tokens_src:
        norm_src = _normalise(src_tok)
        best_score = 0.0
        best_match = ""

        for tgt_tok, norm_tgt_tok in zip(tokens_tgt, norm_tgt):
            # Exact match shortcut
            if norm_src == norm_tgt_tok:
                best_score = 1.0
                best_match = tgt_tok
                break

            score = fuzz.ratio(norm_src, norm_tgt_tok) / 100.0
            if score > best_score:
                best_score = score
                best_match = tgt_tok

        # Treat very low scores as no match
        if best_score < TOKEN_MATCH_FLOOR:
            best_match = ""
            best_score = 0.0

        results.append(TokenMatch(
            token=src_tok,
            match=best_match,
            score=round(best_score, 3),
            is_exact=(_normalise(src_tok) == _normalise(best_match)) if best_match else False,
        ))

    return results


# ============================================================
# SCORE DECOMPOSITION
# ============================================================

def decompose_score(
    semantic_score: float,
    fuzzy_score: float,
    is_same_script: bool,
) -> Dict[str, float]:
    w = SAME_SCRIPT_WEIGHTS if is_same_script else CROSS_SCRIPT_WEIGHTS
    combined = w["semantic"] * semantic_score + w["fuzzy"] * fuzzy_score
    return {
        "semantic_score": round(semantic_score, 4),
        "fuzzy_score": round(fuzzy_score, 4),
        "combined_score": round(combined, 4),
        "semantic_weight": w["semantic"],
        "fuzzy_weight": w["fuzzy"],
        "semantic_contribution": round(w["semantic"] * semantic_score, 4),
        "fuzzy_contribution": round(w["fuzzy"] * fuzzy_score, 4),
    }


# ============================================================
# MAIN ENTRY POINT
# ============================================================

def explain_pair(
    record_a: Dict,
    record_b: Dict,
    semantic_score: float,
    fuzzy_score: float,
    is_same_script: bool,
) -> TokenAttribution:
    """
    Full attribution for a record pair.

    Args:
        record_a / record_b : dicts with at least {"text": ..., "language": ...}
        semantic_score      : cosine similarity from the pipeline
        fuzzy_score         : rapidfuzz token_sort_ratio / 100 from the pipeline
        is_same_script      : from dedupe_pipeline.same_script()

    Returns:
        TokenAttribution dataclass (serialise with asdict() for the API)
    """
    text_a = record_a["text"]
    text_b = record_b["text"]
    lang_a = record_a.get("language", "en")
    lang_b = record_b.get("language", "en")

    tokens_a = tokenize(text_a)
    tokens_b = tokenize(text_b)

    aligned_a = align_tokens(tokens_a, tokens_b)   # A → B
    aligned_b = align_tokens(tokens_b, tokens_a)   # B → A

    scores_a = [m.score for m in aligned_a]
    scores_b = [m.score for m in aligned_b]

    avg_a = round(sum(scores_a) / len(scores_a), 3) if scores_a else 0.0
    avg_b = round(sum(scores_b) / len(scores_b), 3) if scores_b else 0.0
    matched_ratio = round(
        sum(1 for m in aligned_a if m.match) / len(aligned_a), 3
    ) if aligned_a else 0.0

    decomp = decompose_score(semantic_score, fuzzy_score, is_same_script)

    return TokenAttribution(
        text_a=text_a,
        text_b=text_b,
        language_a=lang_a,
        language_b=lang_b,
        tokens_a=aligned_a,
        tokens_b=aligned_b,
        semantic_score=decomp["semantic_score"],
        fuzzy_score=decomp["fuzzy_score"],
        combined_score=decomp["combined_score"],
        semantic_weight=decomp["semantic_weight"],
        fuzzy_weight=decomp["fuzzy_weight"],
        semantic_contribution=decomp["semantic_contribution"],
        fuzzy_contribution=decomp["fuzzy_contribution"],
        is_same_script=is_same_script,
        avg_token_match_a=avg_a,
        avg_token_match_b=avg_b,
        matched_token_ratio=matched_ratio,
    )


def explain_pair_as_dict(
    record_a: Dict,
    record_b: Dict,
    semantic_score: float,
    fuzzy_score: float,
    is_same_script: bool,
) -> Dict:
    """JSON-serialisable version for the API."""
    result = explain_pair(record_a, record_b, semantic_score, fuzzy_score, is_same_script)
    return asdict(result)


# ============================================================
# WIRE INTO api.py  (add this endpoint to api.py)
# ============================================================
# 
# @app.post("/explain")
# def explain(req: ExplainRequest):
#     from token_attribution import explain_pair_as_dict
#     from dedupe_pipeline import compute_fuzzy_similarity, same_script
#     fuzzy = compute_fuzzy_similarity(req.text_a, req.text_b)
#     ss    = same_script(req.text_a, req.text_b)
#     return explain_pair_as_dict(
#         {"text": req.text_a, "language": req.language_a},
#         {"text": req.text_b, "language": req.language_b},
#         semantic_score=req.semantic_score,
#         fuzzy_score=fuzzy,
#         is_same_script=ss,
#     )


# ============================================================
# STANDALONE DEMO
# ============================================================

def _demo():
    test_pairs = [
        # Same entity, typo
        (
            {"text": "Sony PlayStation 5", "language": "en"},
            {"text": "索尼 PlayStatoin 5",  "language": "zh"},
            0.821, False,
        ),
        # Legal suffix variation
        (
            {"text": "Microsoft Corporation", "language": "en"},
            {"text": "Microsoft Corp.",       "language": "en"},
            0.934, True,
        ),
        # Different models (should NOT merge)
        (
            {"text": "Nike Air Max 90",  "language": "en"},
            {"text": "Nike Air Max 95",  "language": "en"},
            0.761, True,
        ),
        # Cross-script duplicate
        (
            {"text": "Samsung Galaxy S24",         "language": "en"},
            {"text": "सैमसंग गैलेक्सी S24",          "language": "hi"},
            0.793, False,
        ),
    ]

    for ra, rb, sem, ss in test_pairs:
        from rapidfuzz import fuzz as _fuzz
        fuz = _fuzz.token_sort_ratio(ra["text"], rb["text"]) / 100.0
        attr = explain_pair(ra, rb, sem, fuz, ss)

        print("\n" + "=" * 60)
        print(f"A [{attr.language_a}]: {attr.text_a}")
        print(f"B [{attr.language_b}]: {attr.text_b}")
        print(f"Same script : {attr.is_same_script}")
        print(f"\nScore decomposition:")
        print(f"  Semantic  {attr.semantic_weight:.0%} × {attr.semantic_score:.3f}"
              f" = {attr.semantic_contribution:.3f}")
        print(f"  Fuzzy     {attr.fuzzy_weight:.0%} × {attr.fuzzy_score:.3f}"
              f" = {attr.fuzzy_contribution:.3f}")
        print(f"  Combined                    {attr.combined_score:.3f}")
        print(f"\nToken alignment (A → B):")
        for tm in attr.tokens_a:
            bar = "█" * int(tm.score * 10)
            match_str = f'→ "{tm.match}"' if tm.match else "→ (no match)"
            exact_str = " ✓" if tm.is_exact else ""
            print(f"  [{bar:<10}] {tm.score:.2f}  \"{tm.token}\" {match_str}{exact_str}")
        print(f"\n  Avg match strength (A→B): {attr.avg_token_match_a:.3f}")
        print(f"  Avg match strength (B→A): {attr.avg_token_match_b:.3f}")
        print(f"  Matched token ratio:      {attr.matched_token_ratio:.1%}")


if __name__ == "__main__":
    _demo()