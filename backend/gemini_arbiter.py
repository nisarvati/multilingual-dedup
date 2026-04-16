"""
gemini_arbiter.py

LLM arbitration layer for grey-zone duplicate pairs that fall near
the pipeline's similarity threshold (±0.02 band).

Strategy:
  - All grey-zone pairs are ranked by ambiguity (closest to threshold first)
  - Only the top N most ambiguous are sent to Gemini (default: 15)
  - Each pair gets: is_duplicate decision, confidence, reasoning
  - Decisions are merged back into a Union-Find to update cluster assignments
"""

import json
import os
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

# ============================================================
# CONFIG
# ============================================================

MODEL_NAME = "gemini-2.0-flash-lite"
MAX_RETRIES      = 3
RETRY_DELAY      = 2.0   # seconds between retries
BATCH_DELAY      = 0.3   # seconds between successive API calls
TOP_N_AMBIGUOUS  = 15    # how many grey zone pairs to send to LLM
CONFIDENCE_FLOOR = 0.55  # below this → abstain, keep pipeline decision

DATA_DIR         = Path(__file__).parent.parent / "data"
CSV_PATH         = DATA_DIR / "demo_dataset.csv"
GROUND_TRUTH_PATH= DATA_DIR / "ground_truth.json"

# ============================================================
# DATA STRUCTURES
# ============================================================

@dataclass
class GreyZonePair:
    index_a: int
    index_b: int
    text_a: str
    text_b: str
    language_a: str
    language_b: str
    entity_type: str
    similarity_score: float
    distance_from_threshold: float   # |score - threshold|, lower = more ambiguous


@dataclass
class ArbiterDecision:
    index_a: int
    index_b: int
    text_a: str
    text_b: str
    similarity_score: float
    is_duplicate: bool
    confidence: float
    reasoning: str
    abstained: bool = False          # True if Gemini was too uncertain


# ============================================================
# UNION-FIND
# ============================================================

class UnionFind:
    def __init__(self, n: int):
        self.parent = list(range(n))
        self.rank   = [0] * n

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, x: int, y: int) -> None:
        px, py = self.find(x), self.find(y)
        if px == py:
            return
        if self.rank[px] < self.rank[py]:
            px, py = py, px
        self.parent[py] = px
        if self.rank[px] == self.rank[py]:
            self.rank[px] += 1

    def clusters(self, record_ids: List[str]) -> List[List[str]]:
        groups: Dict[int, List[str]] = {}
        for i, rid in enumerate(record_ids):
            root = self.find(i)
            groups.setdefault(root, []).append(rid)
        return [ids for ids in groups.values() if len(ids) > 1]


# ============================================================
# PROMPT BUILDER
# ============================================================

SYSTEM_PROMPT = """You are a multilingual data deduplication expert.
You will be given two records from a product/company database that a similarity model
flagged as borderline — their similarity score landed within ±0.02 of the decision
threshold, meaning the model is genuinely uncertain.

Your job: decide whether these two records refer to the SAME real-world entity or
DIFFERENT entities.

Critical rules:
- "iPhone 15 Pro" and "iPhone 15 Pro Max" are DIFFERENT entities (different product lines).
- "Apple Inc" and "Apple Incorporated" are the SAME entity (legal suffix variation).
- A typo, extra space, case difference, or marketing suffix (e.g. "New", "2024 Model",
  "Free Shipping") does NOT make records different entities.
- Cross-language records that clearly transliterate the same name ARE duplicates.
- When in doubt between close product variants (S24 vs S24 Ultra), lean NOT duplicate.

Respond ONLY with a JSON object. No markdown, no explanation outside the JSON.

{
  "is_duplicate": true | false,
  "confidence": 0.0 to 1.0,
  "reasoning": "one concise sentence explaining the decision"
}"""


def build_user_prompt(pair: GreyZonePair) -> str:
    cross = pair.language_a != pair.language_b
    lang_note = (
        f"Note: these records are in different languages ({pair.language_a} and "
        f"{pair.language_b}), so script/transliteration differences are expected."
        if cross else
        f"Both records are in the same language ({pair.language_a})."
    )
    return f"""Borderline pair (similarity score: {pair.similarity_score:.4f})

Record A [{pair.language_a}]: {pair.text_a}
Record B [{pair.language_b}]: {pair.text_b}

Entity type: {pair.entity_type}
{lang_note}

Are these the same real-world entity?"""


# ============================================================
# GEMINI CLIENT
# ============================================================

class GeminiArbiter:
    def __init__(self, api_key=None, top_n=TOP_N_AMBIGUOUS):
        key = api_key or os.getenv("GEMINI_API_KEY")
        if not key:
            raise ValueError("Gemini API key required. Set GEMINI_API_KEY in .env or pass api_key=...")
        self.client = genai.Client(api_key=key)
        self.top_n = top_n

    def _call_gemini(self, pair: GreyZonePair) -> dict:
        prompt = build_user_prompt(pair)
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = self.client.models.generate_content(
                    model=MODEL_NAME,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT,
                        temperature=0.1,
                        max_output_tokens=256,
                    ),
                )
                raw = response.text.strip()
                if raw.startswith("```"):
                    raw = raw.split("```")[1]
                    if raw.startswith("json"):
                        raw = raw[4:]
                return json.loads(raw)
            except json.JSONDecodeError as e:
                print(f"    [!] JSON parse error on attempt {attempt}: {e}")
            except Exception as e:
                print(f"    [!] API error on attempt {attempt}: {e}")
            
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY * attempt)
        return {}

    def arbitrate_pair(self, pair: GreyZonePair) -> ArbiterDecision:
        result = self._call_gemini(pair)

        if not result or "is_duplicate" not in result:
            return ArbiterDecision(
                index_a=pair.index_a,
                index_b=pair.index_b,
                text_a=pair.text_a,
                text_b=pair.text_b,
                similarity_score=pair.similarity_score,
                is_duplicate=False,
                confidence=0.0,
                reasoning="Abstained — API error or unparseable response.",
                abstained=True,
            )

        confidence = float(result.get("confidence", 0.0))
        abstained  = confidence < CONFIDENCE_FLOOR

        return ArbiterDecision(
            index_a=pair.index_a,
            index_b=pair.index_b,
            text_a=pair.text_a,
            text_b=pair.text_b,
            similarity_score=pair.similarity_score,
            is_duplicate=bool(result["is_duplicate"]) if not abstained else False,
            confidence=confidence,
            reasoning=result.get("reasoning", ""),
            abstained=abstained,
        )

    def run(
        self,
        grey_zone_pairs: List[Tuple[int, int, float]],
        records: List[Dict],
        uf: UnionFind,
        threshold: float,
    ) -> Tuple[List[ArbiterDecision], UnionFind]:
        ranked = sorted(grey_zone_pairs, key=lambda t: abs(t[2] - threshold))
        selected = ranked[:self.top_n]

        print(f"\n{'='*60}")
        print(f"GEMINI ARBITER")
        print(f"{'='*60}")
        print(f"  Grey zone pairs total : {len(grey_zone_pairs)}")
        print(f"  Sending top {self.top_n} most ambiguous to {MODEL_NAME}")

        decisions: List[ArbiterDecision] = []

        for idx, (i, j, score) in enumerate(selected, 1):
            ra, rb = records[i], records[j]
            pair = GreyZonePair(
                index_a=i,
                index_b=j,
                text_a=ra["text"],
                text_b=rb["text"],
                language_a=ra["language"],
                language_b=rb["language"],
                entity_type=ra.get("entity_type", "unknown"),
                similarity_score=score,
                distance_from_threshold=abs(score - threshold),
            )

            print(f"\n  [{idx}/{self.top_n}] score={score:.4f}  Δ={pair.distance_from_threshold:.4f}")
            decision = self.arbitrate_pair(pair)
            decisions.append(decision)

            status = "ABSTAIN" if decision.abstained else ("DUPLICATE" if decision.is_duplicate else "DIFFERENT")
            print(f"    → {status}  (conf={decision.confidence:.2f})  {decision.reasoning}")

            if decision.is_duplicate and not decision.abstained:
                uf.union(i, j)

            if idx < self.top_n:
                time.sleep(BATCH_DELAY)

        return decisions, uf


# ============================================================
# RESULTS I/O & WRAPPERS
# ============================================================

def save_decisions(decisions: List[ArbiterDecision], path: Path) -> None:
    data = [asdict(d) for d in decisions]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"\n  Decisions saved → {path}")


def run_arbitration(
    grey_zone_pairs: List[Tuple[int, int, float]],
    records: List[Dict],
    uf: UnionFind,
    threshold: float,
    api_key: Optional[str] = None,
    top_n: int = TOP_N_AMBIGUOUS,
    save_path: Optional[Path] = None,
) -> Tuple[List[List[str]], List[ArbiterDecision]]:
    arbiter = GeminiArbiter(api_key=api_key, top_n=top_n)
    decisions, updated_uf = arbiter.run(grey_zone_pairs, records, uf, threshold)

    if save_path:
        save_decisions(decisions, save_path)

    record_ids = [r["id"] for r in records]
    updated_clusters = updated_uf.clusters(record_ids)
    return updated_clusters, decisions


def main():
    # Placeholder for standalone execution logic
    pass

if __name__ == "__main__":
    main()