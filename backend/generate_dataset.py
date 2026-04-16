"""
Generate a multilingual duplicate detection demo dataset.

Produces:
- data/demo_dataset.csv : records to deduplicate
- data/ground_truth.json : entity_id -> [record_ids] mapping for evaluation
"""

import csv
import json
import random
import os
from pathlib import Path

random.seed(42)  # reproducibility

# ============================================================
# SEED DATA: Well-known entities in multiple languages
# Each entity has a canonical name in 7 languages/scripts
# ============================================================

ENTITIES = [
    # === TECH PRODUCTS ===
    {
        "id": "E001", "type": "product",
        "en": "iPhone 15 Pro",
        "ja": "アイフォン 15 プロ",
        "zh": "苹果手机 15 Pro",
        "ar": "آيفون 15 برو",
        "hi": "आईफोन 15 प्रो",
        "th": "ไอโฟน 15 โปร",
        "ko": "아이폰 15 프로",
    },
    {
        "id": "E002", "type": "product",
        "en": "Samsung Galaxy S24",
        "ja": "サムスン ギャラクシー S24",
        "zh": "三星 Galaxy S24",
        "ar": "سامسونج جالاكسي S24",
        "hi": "सैमसंग गैलेक्सी S24",
        "th": "ซัมซุง กาแลคซี่ S24",
        "ko": "삼성 갤럭시 S24",
    },
    {
        "id": "E003", "type": "product",
        "en": "Sony PlayStation 5",
        "ja": "ソニー プレイステーション 5",
        "zh": "索尼 PlayStation 5",
        "ar": "سوني بلايستيشن 5",
        "hi": "सोनी प्लेस्टेशन 5",
        "th": "โซนี่ เพลย์สเตชั่น 5",
        "ko": "소니 플레이스테이션 5",
    },
    {
        "id": "E004", "type": "product",
        "en": "Nike Air Max 90",
        "ja": "ナイキ エアマックス 90",
        "zh": "耐克 Air Max 90",
        "ar": "نايكي اير ماكس 90",
        "hi": "नाइकी एयर मैक्स 90",
        "th": "ไนกี้ แอร์แม็กซ์ 90",
        "ko": "나이키 에어맥스 90",
    },
    {
        "id": "E005", "type": "product",
        "en": "Toyota Camry",
        "ja": "トヨタ カムリ",
        "zh": "丰田凯美瑞",
        "ar": "تويوتا كامري",
        "hi": "टोयोटा कैमरी",
        "th": "โตโยต้า แคมรี่",
        "ko": "토요타 캠리",
    },
    # === COMPANIES ===
    {
        "id": "E006", "type": "company",
        "en": "Microsoft Corporation",
        "ja": "マイクロソフト株式会社",
        "zh": "微软公司",
        "ar": "شركة مايكروسوفت",
        "hi": "माइक्रोसॉफ्ट कॉर्पोरेशन",
        "th": "บริษัท ไมโครซอฟท์",
        "ko": "마이크로소프트",
    },
    {
        "id": "E007", "type": "company",
        "en": "Apple Inc",
        "ja": "アップル",
        "zh": "苹果公司",
        "ar": "شركة آبل",
        "hi": "एप्पल इंक",
        "th": "บริษัท แอปเปิล",
        "ko": "애플",
    },
    {
        "id": "E008", "type": "company",
        "en": "Google LLC",
        "ja": "グーグル",
        "zh": "谷歌",
        "ar": "شركة جوجل",
        "hi": "गूगल",
        "th": "บริษัท กูเกิล",
        "ko": "구글",
    },
    {
        "id": "E009", "type": "company",
        "en": "Amazon",
        "ja": "アマゾン",
        "zh": "亚马逊",
        "ar": "أمازون",
        "hi": "अमेज़न",
        "th": "แอมะซอน",
        "ko": "아마존",
    },
    {
        "id": "E010", "type": "company",
        "en": "Tesla Motors",
        "ja": "テスラ",
        "zh": "特斯拉",
        "ar": "تسلا موتورز",
        "hi": "टेस्ला मोटर्स",
        "th": "เทสลา",
        "ko": "테슬라 모터스",
    },
    # === FOOD ITEMS ===
    {
        "id": "E011", "type": "product",
        "en": "Coca-Cola",
        "ja": "コカ・コーラ",
        "zh": "可口可乐",
        "ar": "كوكا كولا",
        "hi": "कोका कोला",
        "th": "โคคา-โคล่า",
        "ko": "코카콜라",
    },
    {
        "id": "E012", "type": "product",
        "en": "Green Tea",
        "ja": "緑茶",
        "zh": "绿茶",
        "ar": "شاي أخضر",
        "hi": "हरी चाय",
        "th": "ชาเขียว",
        "ko": "녹차",
    },
    {
        "id": "E013", "type": "product",
        "en": "Red Apple",
        "ja": "赤いりんご",
        "zh": "红苹果",
        "ar": "تفاحة حمراء",
        "hi": "लाल सेब",
        "th": "แอปเปิ้ลแดง",
        "ko": "빨간 사과",
    },
    {
        "id": "E014", "type": "product",
        "en": "Chocolate Bar",
        "ja": "チョコレートバー",
        "zh": "巧克力棒",
        "ar": "لوح شوكولاتة",
        "hi": "चॉकलेट बार",
        "th": "ช็อกโกแลตบาร์",
        "ko": "초콜릿 바",
    },
    {
        "id": "E015", "type": "product",
        "en": "Orange Juice",
        "ja": "オレンジジュース",
        "zh": "橙汁",
        "ar": "عصير برتقال",
        "hi": "संतरे का रस",
        "th": "น้ำส้ม",
        "ko": "오렌지 주스",
    },
    # === APPLIANCES / ELECTRONICS ===
    {
        "id": "E016", "type": "product",
        "en": "LG Washing Machine",
        "ja": "LG 洗濯機",
        "zh": "LG 洗衣机",
        "ar": "غسالة LG",
        "hi": "एलजी वॉशिंग मशीन",
        "th": "เครื่องซักผ้า LG",
        "ko": "LG 세탁기",
    },
    {
        "id": "E017", "type": "product",
        "en": "Dell Laptop XPS 15",
        "ja": "デル ノートパソコン XPS 15",
        "zh": "戴尔笔记本电脑 XPS 15",
        "ar": "حاسوب محمول ديل XPS 15",
        "hi": "डेल लैपटॉप XPS 15",
        "th": "เดลล์ แล็ปท็อป XPS 15",
        "ko": "델 노트북 XPS 15",
    },
    {
        "id": "E018", "type": "product",
        "en": "Canon EOS Camera",
        "ja": "キヤノン EOS カメラ",
        "zh": "佳能 EOS 相机",
        "ar": "كاميرا كانون EOS",
        "hi": "कैनन EOS कैमरा",
        "th": "กล้องแคนนอน EOS",
        "ko": "캐논 EOS 카메라",
    },
    # === CLOTHING ===
    {
        "id": "E019", "type": "product",
        "en": "Blue Denim Jeans",
        "ja": "ブルーデニムジーンズ",
        "zh": "蓝色牛仔裤",
        "ar": "جينز أزرق",
        "hi": "नीली डेनिम जींस",
        "th": "กางเกงยีนส์สีน้ำเงิน",
        "ko": "블루 데님 진",
    },
    {
        "id": "E020", "type": "product",
        "en": "Leather Wallet",
        "ja": "革の財布",
        "zh": "皮革钱包",
        "ar": "محفظة جلدية",
        "hi": "चमड़े का बटुआ",
        "th": "กระเป๋าสตางค์หนัง",
        "ko": "가죽 지갑",
    },
]

# ============================================================
# GREY-ZONE PAIRS: Engineered to land near the threshold
# These are CRITICAL - they're what triggers LLM arbitration
# during your demo
# ============================================================

GREY_ZONE_PAIRS = [
    # Similar products but DIFFERENT (should NOT merge)
    {"a": "iPhone 15 Pro", "b": "iPhone 15 Pro Max", "is_duplicate": False,
     "note": "Different models - Pro vs Pro Max"},
    {"a": "Samsung Galaxy S24", "b": "Samsung Galaxy S24 Ultra", "is_duplicate": False,
     "note": "Different variants"},
    {"a": "Nike Air Max 90", "b": "Nike Air Max 95", "is_duplicate": False,
     "note": "Different Air Max models"},

    # Same entity with legal suffix variations (SHOULD merge)
    {"a": "Microsoft Corporation", "b": "Microsoft Corp.", "is_duplicate": True,
     "note": "Same company, abbreviated suffix"},
    {"a": "Apple Inc", "b": "Apple Incorporated", "is_duplicate": True,
     "note": "Same company, expanded suffix"},
    {"a": "Google LLC", "b": "Google Limited Liability Company", "is_duplicate": True,
     "note": "Same company, expanded legal form"},
]

# ============================================================
# NOISE FUNCTIONS: Add realistic messiness to the data
# ============================================================

def add_typo(text: str) -> str:
    """Introduce a single-character typo."""
    if len(text) < 4:
        return text
    pos = random.randint(1, len(text) - 2)
    return text[:pos] + text[pos + 1] + text[pos] + text[pos + 2:]  # swap adjacent

def add_whitespace_noise(text: str) -> str:
    """Extra spaces or missing spaces."""
    if " " in text and random.random() < 0.5:
        # Remove a space
        idx = text.index(" ")
        return text[:idx] + text[idx + 1:]
    else:
        # Add extra space
        pos = random.randint(0, len(text))
        return text[:pos] + " " + text[pos:]

def add_case_variation(text: str) -> str:
    """Change casing."""
    choice = random.choice(["lower", "upper", "title"])
    if choice == "lower":
        return text.lower()
    elif choice == "upper":
        return text.upper()
    else:
        return text.title()

def add_punctuation_noise(text: str) -> str:
    """Add or remove punctuation."""
    if "," in text or "." in text:
        return text.replace(",", "").replace(".", "")
    else:
        return text + random.choice([".", "!", ""])

def add_marketing_fluff(text: str, lang: str) -> str:
    """Append extra descriptive words (simulates real e-commerce listings)."""
    fluff = {
        "en": ["- New", "(Brand New)", "- Official", "2024 Model", "Free Shipping"],
        "ja": ["新品", "正規品", "送料無料"],
        "zh": ["全新", "正品", "包邮"],
        "ar": ["جديد", "أصلي"],
        "hi": ["नया", "असली"],
        "th": ["ใหม่", "ของแท้"],
        "ko": ["신제품", "정품"],
    }
    suffix = random.choice(fluff.get(lang, fluff["en"]))
    return f"{text} {suffix}"

NOISE_FUNCTIONS = [
    add_typo,
    add_whitespace_noise,
    add_case_variation,
    add_punctuation_noise,
]

# ============================================================
# DATASET GENERATION
# ============================================================

def generate_records():
    records = []
    ground_truth = {}  # entity_id -> [record_ids]
    record_counter = 1

    # For each entity, generate multiple variants across languages
    for entity in ENTITIES:
        entity_records = []
        languages = ["en", "ja", "zh", "ar", "hi", "th", "ko"]

        for lang in languages:
            base_text = entity[lang]
            # Each language gets 2-4 variants (original + noisy versions)
            num_variants = random.randint(2, 4)

            for i in range(num_variants):
                if i == 0:
                    # First variant is clean
                    text = base_text
                elif random.random() < 0.4:
                    # Apply a noise function
                    noise_fn = random.choice(NOISE_FUNCTIONS)
                    text = noise_fn(base_text)
                elif random.random() < 0.3:
                    # Add marketing fluff
                    text = add_marketing_fluff(base_text, lang)
                else:
                    text = base_text  # exact duplicate

                record_id = f"R{record_counter:04d}"
                records.append({
                    "id": record_id,
                    "text": text,
                    "language": lang,
                    "entity_type": entity["type"],
                })
                entity_records.append(record_id)
                record_counter += 1

        ground_truth[entity["id"]] = entity_records

    # Add grey-zone pairs
    for gz in GREY_ZONE_PAIRS:
        a_id = f"R{record_counter:04d}"
        records.append({"id": a_id, "text": gz["a"], "language": "en", "entity_type": "product"})
        record_counter += 1

        b_id = f"R{record_counter:04d}"
        records.append({"id": b_id, "text": gz["b"], "language": "en", "entity_type": "product"})
        record_counter += 1

        if gz["is_duplicate"]:
            # Same entity - create a new entity ID for this pair
            gz_entity_id = f"GZ_{a_id}_{b_id}"
            ground_truth[gz_entity_id] = [a_id, b_id]
        else:
            # Different entities - separate singleton groups
            ground_truth[f"GZ_{a_id}"] = [a_id]
            ground_truth[f"GZ_{b_id}"] = [b_id]

    # Add unique distractors (records that are NOT duplicates of anything)
    distractors = [
        ("Lenovo ThinkPad X1", "en"), ("Nintendo Switch", "en"),
        ("BMW Series 3", "en"), ("Honda Civic", "en"),
        ("Adidas Stan Smith", "en"), ("Pepsi Cola", "en"),
        ("パナソニック テレビ", "ja"), ("ニコン カメラ", "ja"),
        ("华为手机 P60", "zh"), ("小米电视", "zh"),
        ("هواوي ماتي 50", "ar"), ("ميرسيدس بنز", "ar"),
        ("शाओमी फोन", "hi"), ("एमजी मोटर", "hi"),
        ("ยาสูบ", "th"), ("รองเท้าผ้าใบ", "th"),
        ("LG 냉장고", "ko"), ("현대 자동차", "ko"),
    ]
    for text, lang in distractors:
        record_id = f"R{record_counter:04d}"
        records.append({
            "id": record_id,
            "text": text,
            "language": lang,
            "entity_type": "product",
        })
        ground_truth[f"UNIQUE_{record_id}"] = [record_id]
        record_counter += 1

    # Shuffle so duplicates aren't grouped together in the CSV
    random.shuffle(records)
    return records, ground_truth


def write_outputs(records, ground_truth):
    # Ensure data directory exists
    data_dir = Path(__file__).parent.parent / "data"
    data_dir.mkdir(exist_ok=True)

    csv_path = data_dir / "demo_dataset.csv"
    gt_path = data_dir / "ground_truth.json"

    # Write CSV
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["id", "text", "language", "entity_type"])
        writer.writeheader()
        writer.writerows(records)

    # Write ground truth
    with open(gt_path, "w", encoding="utf-8") as f:
        json.dump(ground_truth, f, ensure_ascii=False, indent=2)

    return csv_path, gt_path


def print_summary(records, ground_truth):
    print("\n" + "=" * 60)
    print("DATASET GENERATION COMPLETE")
    print("=" * 60)
    print(f"Total records: {len(records)}")
    print(f"Total entity groups: {len(ground_truth)}")

    # Language breakdown
    lang_counts = {}
    for r in records:
        lang_counts[r["language"]] = lang_counts.get(r["language"], 0) + 1
    print("\nLanguage breakdown:")
    for lang, count in sorted(lang_counts.items()):
        print(f"  {lang}: {count}")

    # Group size breakdown
    duplicate_groups = sum(1 for ids in ground_truth.values() if len(ids) > 1)
    singleton_groups = sum(1 for ids in ground_truth.values() if len(ids) == 1)
    print(f"\nDuplicate groups (2+ records): {duplicate_groups}")
    print(f"Singleton groups (unique records): {singleton_groups}")

    # Sample records
    print("\nSample records:")
    for r in records[:5]:
        print(f"  {r['id']} [{r['language']}] {r['text']}")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    records, ground_truth = generate_records()
    csv_path, gt_path = write_outputs(records, ground_truth)
    print_summary(records, ground_truth)
    print(f"Wrote: {csv_path}")
    print(f"Wrote: {gt_path}")