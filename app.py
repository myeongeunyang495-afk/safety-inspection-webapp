import json
import os
import uuid
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"
DATA_DIR = ROOT / "data"
DB_FILE = DATA_DIR / "db.json"
PORT = int(os.environ.get("PORT", "3000"))
LEGACY_DEFAULTS = {
    "themes": ["추락 예방", "끼임 예방", "화재 예방", "보호구 착용", "전기 안전", "정리정돈"],
    "targets": ["1공장", "2공장", "물류창고", "전기실", "옥상", "외주 작업장"],
    "inspectors": ["김안전", "이보건", "박관리", "최점검"],
}
PREVIOUS_DEFAULTS = {
    "targets": ["역", "사업소", "수급업체"],
}

DEFAULT_DB = {
    "themes": ["중처법 점검", "계절별 점검", "도급사업 점검", "보건대행 점검"],
    "detailThemes": ["MSDS", "밀폐공간", "휴게시설"],
    "themeLaws": {
        "중처법 점검": [
            "중대재해 처벌 등에 관한 법률 제4조: 사업주와 경영책임자등의 안전 및 보건 확보의무",
            "산업안전보건법 제36조·제38조·제39조: 위험성평가, 안전조치 및 보건조치"
        ],
        "계절별 점검": [
            "산업안전보건법 제38조·제39조: 계절성 위험요인에 대한 안전조치 및 보건조치",
            "산업안전보건기준에 관한 규칙: 폭염·한랭·화재·질식 등 작업환경별 예방조치 관련 기준"
        ],
        "도급사업 점검": [
            "산업안전보건법 제63조: 도급인의 안전조치 및 보건조치",
            "산업안전보건법 제64조: 도급에 따른 산업재해 예방조치"
        ],
        "보건대행 점검": [
            "산업안전보건법 제18조: 보건관리자",
            "산업안전보건법 제39조: 보건조치 및 건강장해 예방"
        ],
    },
    "targets": ["영업", "승무", "차량", "시설", "건축", "전기"],
    "contractors": ["코레일테크", "코레일네트웍스", "코레일유통", "코레일관광개발", "코레일로지스"],
    "inspectors": ["양명은", "최연호", "박지민", "안재현", "황희진", "박대현"],
    "resultSamples": [
        {
            "id": "sample-1",
            "title": "즉시개선",
            "content": "작업장 내 위험요인을 확인하여 현장에서 즉시 제거하고 작업자에게 재발 방지 교육을 실시함.",
            "actionType": "즉시조치완료",
        },
        {
            "id": "sample-2",
            "title": "개선요청",
            "content": "안전표지와 방호장치 상태가 미흡하여 담당 부서에 보완 조치를 요청함.",
            "actionType": "조치필요",
        },
        {
            "id": "sample-3",
            "title": "추적관리",
            "content": "개선 계획 수립이 필요한 사항으로 담당자 지정 후 다음 점검 시 조치 완료 여부를 확인 예정임.",
            "actionType": "조치필요",
        },
    ],
    "inspections": [],
}


def ensure_db():
    DATA_DIR.mkdir(exist_ok=True)
    if not DB_FILE.exists():
        write_db(DEFAULT_DB)
        return
    db = read_db_raw()
    changed = False
    if db.get("targets") != DEFAULT_DB["targets"]:
        db["targets"] = DEFAULT_DB["targets"]
        changed = True
    filtered_themes = [theme for theme in db.get("themes", []) if theme.strip().lower() not in ["밀폐공간", "msds"]]
    if filtered_themes != db.get("themes", []):
        db["themes"] = filtered_themes
        changed = True
    for key in ["themes", "inspectors"]:
        if db.get(key) == LEGACY_DEFAULTS[key] or db.get(key) == PREVIOUS_DEFAULTS.get(key) or key not in db:
            db[key] = DEFAULT_DB[key]
            changed = True
    for key, value in DEFAULT_DB.items():
        if key not in db:
            db[key] = value
            changed = True
    db.setdefault("themeLaws", {})
    for theme, laws in DEFAULT_DB["themeLaws"].items():
        if theme not in db["themeLaws"]:
            db["themeLaws"][theme] = laws
            changed = True
    for sample in db.get("resultSamples", []):
        default_sample = next((item for item in DEFAULT_DB["resultSamples"] if item["id"] == sample.get("id")), None)
        if default_sample:
            sample.update(default_sample)
            changed = True
        if sample.get("actionType") in ["A 조치", "교육", "점검완료"]:
            sample["actionType"] = "즉시조치완료"
            changed = True
        if sample.get("actionType") in ["B 조치", "C 조치"]:
            sample["actionType"] = "조치필요"
            changed = True
    for inspection in db.get("inspections", []):
        if inspection.get("actionType") in ["A 조치", "교육", "점검완료"]:
            inspection["actionType"] = "즉시조치완료"
            changed = True
        if inspection.get("actionType") in ["B 조치", "C 조치"]:
            inspection["actionType"] = "조치필요"
            changed = True
    if changed:
        write_db(db)


def read_db_raw():
    with DB_FILE.open("r", encoding="utf-8") as file:
        return json.load(file)


def read_db():
    ensure_db()
    return read_db_raw()


def write_db(db):
    DATA_DIR.mkdir(exist_ok=True)
    with DB_FILE.open("w", encoding="utf-8") as file:
        json.dump(db, file, ensure_ascii=False, indent=2)


def unique_push(items, value):
    text = str(value or "").strip()
    if text and text not in items:
        items.append(text)


def normalize_inspection(payload):
    inspectors = payload.get("inspectors")
    if not isinstance(inspectors, list):
        inspector_text = str(payload.get("inspector") or "").strip()
        inspectors = [name.strip() for name in inspector_text.split(",") if name.strip()]
    inspectors = [str(name).strip() for name in inspectors if str(name).strip()]
    target_category = str(payload.get("targetCategory") or "").strip()
    target_detail = str(payload.get("targetDetail") or "").strip()
    target_owner = str(payload.get("targetOwner") or "").strip()
    target = str(payload.get("target") or "").strip()
    if target_category or target_detail:
        target = f"{target_owner} {target_category} {target_detail}".strip()
    return {
        "id": str(uuid.uuid4()),
        "theme": str(payload.get("theme") or "").strip(),
        "detailTheme": str(payload.get("detailTheme") or "").strip(),
        "laws": payload.get("laws") if isinstance(payload.get("laws"), list) else [],
        "inspectedAt": str(payload.get("inspectedAt") or "").strip(),
        "targetOwner": target_owner,
        "targetCategory": target_category,
        "targetDetail": target_detail,
        "target": target,
        "inspectors": inspectors,
        "inspector": ", ".join(inspectors),
        "resultTitle": str(payload.get("resultTitle") or "").strip(),
        "resultText": str(payload.get("resultText") or "").strip(),
        "actionType": str(payload.get("actionType") or "즉시조치완료").strip(),
        "beforePhoto": payload.get("beforePhoto") or "",
        "afterPhoto": payload.get("afterPhoto") or "",
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }


def is_valid_inspection(item):
    return all(item.get(key) for key in ["theme", "inspectedAt", "target", "inspector"])


def fallback_laws(theme, detail_theme):
    query = " ".join([theme, detail_theme, "산업안전보건법"]).strip()
    search_url = f"https://www.law.go.kr/LSW/lsSc.do?query={quote(query)}"
    curated = {
        "msds": [
            "산업안전보건법 제110조: 물질안전보건자료의 작성 및 제출",
            "산업안전보건법 제111조: 물질안전보건자료의 제공",
            "산업안전보건법 제114조: 물질안전보건자료의 게시 및 교육",
        ],
        "밀폐공간": [
            "산업안전보건기준에 관한 규칙 제618조: 밀폐공간의 정의",
            "산업안전보건기준에 관한 규칙 제619조의2: 산소 및 유해가스 농도의 측정 및 기록 등",
            "산업안전보건기준에 관한 규칙 제620조: 환기 등 밀폐공간 작업 시 필요한 조치",
        ],
        "휴게시설": [
            "산업안전보건법 제128조의2: 휴게시설의 설치",
            "산업안전보건법 시행령 제96조의2: 휴게시설 설치ㆍ관리기준 준수 대상 사업장의 사업주",
            "산업안전보건법 시행규칙 제194조의2: 휴게시설의 설치ㆍ관리기준",
        ],
    }
    laws = curated.get(detail_theme.strip().lower(), [
        "산업안전보건법 제38조: 안전조치",
        "산업안전보건법 제39조: 보건조치",
        "산업안전보건법 제63조·제64조: 도급인의 안전보건조치 및 산업재해 예방조치",
    ])
    laws.append(f"국가법령정보센터 검색: {search_url}")
    return laws


def lookup_laws(theme, detail_theme):
    oc = os.environ.get("LAW_API_OC", "").strip()
    if not oc:
        return fallback_laws(theme, detail_theme)
    query = " ".join([theme, detail_theme]).strip() or "산업안전보건법"
    params = urlencode({"OC": oc, "target": "law", "type": "JSON", "search": 2, "query": query, "display": 5})
    try:
        with urlopen(f"https://www.law.go.kr/DRF/lawSearch.do?{params}", timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
        rows = payload.get("LawSearch", {}).get("law", [])
        if isinstance(rows, dict):
            rows = [rows]
        laws = []
        for row in rows[:5]:
            name = row.get("법령명한글") or row.get("법령명") or "법령"
            link = row.get("법령상세링크", "")
            laws.append(f"{name} - https://www.law.go.kr{link}" if link.startswith("/") else name)
        return laws or fallback_laws(theme, detail_theme)
    except Exception:
        return fallback_laws(theme, detail_theme)


def build_stats(db):
    by_theme = {}
    by_action = {}
    target_by_month = {}

    for item in db["inspections"]:
        theme = item["theme"]
        action = item["actionType"]
        target = item["target"]
        by_theme.setdefault(theme, {"theme": theme, "total": 0, "actions": {}})
        by_theme[theme]["total"] += 1
        by_theme[theme]["actions"][action] = by_theme[theme]["actions"].get(action, 0) + 1
        by_action[action] = by_action.get(action, 0) + 1

        try:
            parsed = datetime.fromisoformat(item["inspectedAt"])
            month = f"{parsed.year}-{parsed.month:02d}"
        except ValueError:
            month = "날짜 미상"
        target_by_month.setdefault(target, {})
        target_by_month[target][month] = target_by_month[target].get(month, 0) + 1

    return {
        "total": len(db["inspections"]),
        "byTheme": sorted(by_theme.values(), key=lambda row: (-row["total"], row["theme"])),
        "byAction": by_action,
        "targetByMonth": target_by_month,
    }


class AppHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        clean = urlparse(path).path
        if clean == "/":
            clean = "/index.html"
        return str(PUBLIC_DIR / clean.lstrip("/"))

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > 20 * 1024 * 1024:
            raise ValueError("요청 데이터가 너무 큽니다.")
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def send_json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/bootstrap":
            db = read_db()
            self.send_json(
                200,
                {
                    "themes": db["themes"],
                    "themeLaws": db["themeLaws"],
                    "detailThemes": db["detailThemes"],
                    "targets": db["targets"],
                    "contractors": db["contractors"],
                    "inspectors": db["inspectors"],
                    "resultSamples": db["resultSamples"],
                    "inspections": db["inspections"],
                    "stats": build_stats(db),
                },
            )
            return
        if parsed.path == "/api/laws":
            query = parse_qs(parsed.query)
            theme = (query.get("theme") or [""])[0]
            detail_theme = (query.get("detailTheme") or [""])[0]
            self.send_json(200, {"laws": lookup_laws(theme, detail_theme)})
            return
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        db = read_db()

        try:
            payload = self.read_json()
            if parsed.path == "/api/themes":
                unique_push(db["themes"], payload.get("theme"))
                theme = str(payload.get("theme") or "").strip()
                if theme.lower() in ["밀폐공간", "msds"]:
                    self.send_json(400, {"message": "삭제 대상 테마는 등록할 수 없습니다."})
                    return
                laws = str(payload.get("laws") or "").strip()
                if theme and laws:
                    db.setdefault("themeLaws", {})[theme] = [line.strip() for line in laws.splitlines() if line.strip()]
                write_db(db)
                self.send_json(201, {"themes": db["themes"], "themeLaws": db["themeLaws"]})
                return

            if parsed.path == "/api/detail-themes":
                unique_push(db["detailThemes"], payload.get("detailTheme"))
                write_db(db)
                self.send_json(201, {"detailThemes": db["detailThemes"]})
                return

            if parsed.path == "/api/contractors":
                unique_push(db["contractors"], payload.get("contractor"))
                write_db(db)
                self.send_json(201, {"contractors": db["contractors"]})
                return

            if parsed.path == "/api/inspectors":
                unique_push(db["inspectors"], payload.get("inspector"))
                write_db(db)
                self.send_json(201, {"inspectors": db["inspectors"]})
                return

            if parsed.path == "/api/inspectors/delete":
                inspector = str(payload.get("inspector") or "").strip()
                db["inspectors"] = [name for name in db["inspectors"] if name != inspector]
                write_db(db)
                self.send_json(200, {"inspectors": db["inspectors"]})
                return

            if parsed.path == "/api/result-samples":
                sample = {
                    "id": str(uuid.uuid4()),
                    "title": str(payload.get("title") or "새 점검결과").strip(),
                    "content": str(payload.get("content") or "").strip(),
                    "actionType": str(payload.get("actionType") or "즉시조치완료").strip(),
                }
                if not sample["content"]:
                    self.send_json(400, {"message": "점검결과 내용이 필요합니다."})
                    return
                db["resultSamples"].insert(0, sample)
                write_db(db)
                self.send_json(201, {"sample": sample, "resultSamples": db["resultSamples"]})
                return

            if parsed.path == "/api/inspections":
                inspection = normalize_inspection(payload)
                if not is_valid_inspection(inspection):
                    self.send_json(400, {"message": "테마, 일시, 대상, 점검자, 점검결과는 필수입니다."})
                    return
                unique_push(db["themes"], inspection["theme"])
                db.setdefault("themeLaws", {}).setdefault(inspection["theme"], [])
                for inspector in inspection["inspectors"]:
                    unique_push(db["inspectors"], inspector)
                db["inspections"].insert(0, inspection)
                write_db(db)
                self.send_json(201, {"inspection": inspection, "inspections": db["inspections"], "stats": build_stats(db)})
                return

            self.send_json(404, {"message": "API를 찾을 수 없습니다."})
        except Exception as error:
            self.send_json(500, {"message": str(error)})


if __name__ == "__main__":
    ensure_db()
    server = ThreadingHTTPServer(("", PORT), AppHandler)
    print(f"Safety inspection app running at http://localhost:{PORT}")
    server.serve_forever()
