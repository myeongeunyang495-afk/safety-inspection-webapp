const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const legacyDefaults = {
  themes: ["추락 예방", "끼임 예방", "화재 예방", "보호구 착용", "전기 안전", "정리정돈"],
  targets: ["1공장", "2공장", "물류창고", "전기실", "옥상", "외주 작업장"],
  inspectors: ["김안전", "이보건", "박관리", "최점검"]
};
const previousDefaults = {
  targets: ["역", "사업소", "수급업체"]
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const defaultDb = {
  themes: ["중처법 점검", "계절별 점검", "도급사업 점검", "보건대행 점검"],
  detailThemes: ["MSDS", "밀폐공간", "휴게시설"],
  themeLaws: {
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
    ]
  },
  targets: ["영업", "승무", "차량", "시설", "건축", "전기"],
  contractors: ["코레일테크", "코레일네트웍스", "코레일유통", "코레일관광개발", "코레일로지스"],
  inspectors: ["양명은", "최연호", "박지민", "안재현", "황희진", "박대현"],
  resultSamples: [],
  inspections: []
};

function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2), "utf8");
  }
}

function readDb() {
  ensureDb();
  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  let changed = false;
  if (JSON.stringify(db.targets) !== JSON.stringify(defaultDb.targets)) {
    db.targets = defaultDb.targets;
    changed = true;
  }
  const filteredThemes = (db.themes || []).filter((theme) => !["밀폐공간", "msds"].includes(String(theme).trim().toLowerCase()));
  if (JSON.stringify(filteredThemes) !== JSON.stringify(db.themes || [])) {
    db.themes = filteredThemes;
    changed = true;
  }
  for (const key of ["themes", "inspectors"]) {
    if (!(key in db) || JSON.stringify(db[key]) === JSON.stringify(legacyDefaults[key]) || JSON.stringify(db[key]) === JSON.stringify(previousDefaults[key])) {
      db[key] = defaultDb[key];
      changed = true;
    }
  }
  for (const [key, value] of Object.entries(defaultDb)) {
    if (!(key in db)) {
      db[key] = value;
      changed = true;
    }
  }
  db.themeLaws ||= {};
  for (const [theme, laws] of Object.entries(defaultDb.themeLaws)) {
    if (!(theme in db.themeLaws)) {
      db.themeLaws[theme] = laws;
      changed = true;
    }
  }
  if (db.resultSamples?.length) {
    db.resultSamples = [];
    changed = true;
  }
  for (const item of db.inspections || []) {
    if (["A 조치", "교육", "점검완료"].includes(item.actionType)) {
      item.actionType = "즉시조치완료";
      changed = true;
    }
    if (["B 조치", "C 조치"].includes(item.actionType)) {
      item.actionType = "조치필요";
      changed = true;
    }
  }
  if (changed) writeDb(db);
  return db;
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function getLawApiOc(db) {
  return String(process.env.LAW_API_OC || db.lawApiOc || "").trim();
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) {
        req.destroy();
        reject(new Error("요청 데이터가 너무 큽니다."));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function uniquePush(list, value) {
  const text = String(value || "").trim();
  if (text && !list.includes(text)) list.push(text);
}

function normalizeInspection(payload) {
  let inspectors = Array.isArray(payload.inspectors)
    ? payload.inspectors
    : String(payload.inspector || "").split(",");
  inspectors = inspectors.map((name) => String(name).trim()).filter(Boolean);
  const targetCategory = String(payload.targetCategory || "").trim();
  const targetDetail = String(payload.targetDetail || "").trim();
  const targetOwner = String(payload.targetOwner || "").trim();
  const target = targetCategory || targetDetail
    ? `${targetOwner} ${targetCategory} ${targetDetail}`.trim()
    : String(payload.target || "").trim();
  const resultText = String(payload.resultText || "").trim();
  return {
    id: crypto.randomUUID(),
    theme: String(payload.theme || "").trim(),
    detailTheme: String(payload.detailTheme || "").trim(),
    laws: Array.isArray(payload.laws) ? payload.laws : [],
    inspectedAt: String(payload.inspectedAt || "").trim(),
    targetOwner,
    targetCategory,
    targetDetail,
    target,
    inspectors,
    inspector: inspectors.join(", "),
    resultTitle: String(payload.resultTitle || "").trim(),
    resultText,
    actionType: String(payload.actionType || "즉시조치완료").trim(),
    beforePhoto: payload.beforePhoto || "",
    afterPhoto: payload.afterPhoto || "",
    createdAt: new Date().toISOString()
  };
}

function isValidInspection(inspection) {
  return inspection.theme && inspection.inspectedAt && inspection.target && inspection.inspector;
}

const lawSources = {
  oshAct: { name: "산업안전보건법", id: "001766" },
  oshRule: { name: "산업안전보건법 시행규칙", id: "007364" },
  oshStandard: { name: "산업안전보건기준에 관한 규칙", id: "007363" }
};

const detailThemeLawRules = {
  "msds": [
    { source: "oshAct", articles: ["110", "111", "114", "115"] },
    { source: "oshRule", articles: ["156", "167", "168", "169", "170"] }
  ],
  "물질안전보건자료": [
    { source: "oshAct", articles: ["110", "111", "114", "115"] },
    { source: "oshRule", articles: ["156", "167", "168", "169", "170"] }
  ],
  "특별관리물질": [
    { source: "oshStandard", articles: ["420", "439", "440", "442", "449", "450", "451"] }
  ],
  "안전보호구": [
    { source: "oshStandard", articles: ["31", "32", "33", "34"] }
  ],
  "보호구": [
    { source: "oshStandard", articles: ["31", "32", "33", "34"] }
  ],
  "안전보건표지": [
    { source: "oshAct", articles: ["37"] },
    { source: "oshRule", articles: ["38", "39", "40"] },
    { source: "manual", labels: [
      "산업안전보건법 시행규칙 별표 6(안전보건표지의 종류와 형태)",
      "산업안전보건법 시행규칙 별표 7(안전보건표지의 용도ㆍ설치장소ㆍ형태 및 색채)",
      "산업안전보건법 시행규칙 별표 8(안전보건표지의 색도기준 및 용도)",
      "산업안전보건법 시행규칙 별표 9(안전보건표지의 기본모형)"
    ] }
  ],
  "위험성평가": [
    { source: "oshAct", articles: ["36"] },
    { source: "oshRule", articles: ["37", "37-2", "37-3", "37-4"] }
  ],
  "밀폐공간": [
    { source: "oshRule", articles: ["85"] },
    { source: "oshStandard", articles: ["618", "619", "620", "621", "622", "623", "624", "625", "641", "643"] }
  ],
  "휴게시설": [
    { source: "oshAct", articles: ["128"] },
    { source: "oshRule", articles: ["194"] },
    { source: "oshStandard", articles: ["79", "567"] }
  ]
};

function normalizeLawTheme(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function articleKey(unit) {
  const number = String(unit?.["조문번호"] || "").replace(/^0+/, "");
  const branch = String(unit?.["조문가지번호"] || "").replace(/^0+/, "");
  return branch ? `${number}-${branch}` : number;
}

function articleLabel(source, unit) {
  const number = String(unit?.["조문번호"] || "").replace(/^0+/, "");
  const branch = String(unit?.["조문가지번호"] || "").replace(/^0+/, "");
  const title = String(unit?.["조문제목"] || "").trim();
  return `${source.name} 제${number}조${branch ? `의${branch}` : ""}${title ? `(${title})` : ""}`;
}

function fallbackThemeLaws(detailTheme) {
  const rules = detailThemeLawRules[normalizeLawTheme(detailTheme)];
  if (!rules) return [];
  return rules.flatMap((rule) => {
    if (rule.source === "manual") return rule.labels;
    const source = lawSources[rule.source];
    return rule.articles.map((item) => {
      const [number, branch] = item.split("-");
      return `${source.name} 제${number}조${branch ? `의${branch}` : ""}`;
    });
  });
}

function fallbackLaws(theme, detailTheme) {
  const curated = {
    "msds": [
      "산업안전보건법 제110조: 물질안전보건자료의 작성 및 제출",
      "산업안전보건법 제111조: 물질안전보건자료의 제공",
      "산업안전보건법 제114조: 물질안전보건자료의 게시 및 교육"
    ],
    "밀폐공간": [
      "산업안전보건기준에 관한 규칙 제618조: 밀폐공간의 정의",
      "산업안전보건기준에 관한 규칙 제619조의2: 산소 및 유해가스 농도의 측정 및 기록 등",
      "산업안전보건기준에 관한 규칙 제620조: 환기 등 밀폐공간 작업 시 필요한 조치"
    ],
    "휴게시설": [
      "산업안전보건법 제128조의2: 휴게시설의 설치",
      "산업안전보건법 시행령 제96조의2: 휴게시설 설치ㆍ관리기준 준수 대상 사업장의 사업주",
      "산업안전보건법 시행규칙 제194조의2: 휴게시설의 설치ㆍ관리기준"
    ]
  };
  const laws = curated[String(detailTheme).trim().toLowerCase()] || [
    "산업안전보건법 제38조: 안전조치",
    "산업안전보건법 제39조: 보건조치",
    "산업안전보건법 제63조·제64조: 도급인의 안전보건조치 및 산업재해 예방조치"
  ];
  return laws;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      let body = "";
      response.on("data", (chunk) => body += chunk);
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
  });
}

async function lookupLaws(theme, detailTheme, db) {
  const oc = getLawApiOc(db);
  const rules = detailThemeLawRules[normalizeLawTheme(detailTheme)];
  if (rules) return lookupThemeArticles(oc, detailTheme, rules);
  if (!oc) return fallbackLaws(theme, detailTheme);
  const query = encodeURIComponent([theme, detailTheme].filter(Boolean).join(" ") || "산업안전보건법");
  try {
    const payload = await fetchJson(`https://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(oc)}&target=law&type=JSON&search=2&query=${query}&display=5`);
    let rows = payload?.LawSearch?.law || [];
    if (!Array.isArray(rows)) rows = [rows];
    const laws = rows.slice(0, 5).map((row) => {
      const name = row["법령명한글"] || row["법령명"] || "법령";
      return name;
    });
    return laws.length ? laws : fallbackLaws(theme, detailTheme);
  } catch {
    return fallbackLaws(theme, detailTheme);
  }
}

async function lookupThemeArticles(oc, detailTheme, rules) {
  if (!oc) return fallbackThemeLaws(detailTheme);
  try {
    const labels = [];
    const cache = new Map();
    for (const rule of rules) {
      if (rule.source === "manual") {
        labels.push(...rule.labels);
        continue;
      }
      const source = lawSources[rule.source];
      if (!cache.has(source.id)) {
        cache.set(source.id, fetchJson(`https://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(oc)}&target=law&ID=${source.id}&type=JSON`));
      }
      const payload = await cache.get(source.id);
      const units = payload?.["법령"]?.["조문"]?.["조문단위"] || [];
      const byArticle = new Map(units.map((unit) => [articleKey(unit), unit]));
      for (const article of rule.articles) {
        const unit = byArticle.get(article);
        labels.push(unit ? articleLabel(source, unit) : fallbackThemeLaws(detailTheme).find((label) => label.includes(`제${article.split("-")[0]}조`)));
      }
    }
    return [...new Set(labels)].filter(Boolean);
  } catch {
    return fallbackThemeLaws(detailTheme);
  }
}

function buildStats(db) {
  const byTheme = {};
  const byAction = {};
  const targetByMonth = {};

  for (const item of db.inspections) {
    byTheme[item.theme] ||= { theme: item.theme, total: 0, actions: {} };
    byTheme[item.theme].total += 1;
    byTheme[item.theme].actions[item.actionType] = (byTheme[item.theme].actions[item.actionType] || 0) + 1;

    byAction[item.actionType] = (byAction[item.actionType] || 0) + 1;

    const date = new Date(item.inspectedAt);
    const month = Number.isNaN(date.getTime()) ? "날짜 미상" : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    targetByMonth[item.target] ||= {};
    targetByMonth[item.target][month] = (targetByMonth[item.target][month] || 0) + 1;
  }

  return {
    total: db.inspections.length,
    byTheme: Object.values(byTheme).sort((a, b) => b.total - a.total || a.theme.localeCompare(b.theme, "ko")),
    byAction,
    targetByMonth
  };
}

async function handleApi(req, res, pathname) {
  const db = readDb();

  if (req.method === "GET" && pathname === "/api/bootstrap") {
    return sendJson(res, 200, {
      themes: db.themes,
      themeLaws: db.themeLaws,
      detailThemes: db.detailThemes,
      targets: db.targets,
      contractors: db.contractors,
      inspectors: db.inspectors,
      resultSamples: db.resultSamples,
      inspections: db.inspections,
      stats: buildStats(db),
      hasLawApiOc: Boolean(getLawApiOc(db))
    });
  }

  if (req.method === "GET" && pathname === "/api/config") {
    return sendJson(res, 200, {
      supabaseUrl: process.env.SUPABASE_URL || "",
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ""
    });
  }

  if (req.method === "POST" && pathname === "/api/law-api-oc") {
    const body = await readBody(req);
    const lawApiOc = String(body.lawApiOc || "").trim();
    if (!lawApiOc) return sendJson(res, 400, { message: "국가법령정보센터 Open API ID가 필요합니다." });
    db.lawApiOc = lawApiOc;
    writeDb(db);
    return sendJson(res, 200, { hasLawApiOc: true });
  }

  if (req.method === "POST" && pathname === "/api/themes") {
    const body = await readBody(req);
    const theme = String(body.theme || "").trim();
    if (["밀폐공간", "msds"].includes(theme.toLowerCase())) {
      return sendJson(res, 400, { message: "삭제 대상 테마는 등록할 수 없습니다." });
    }
    uniquePush(db.themes, theme);
    const laws = String(body.laws || "").trim();
    if (theme && laws) {
      db.themeLaws ||= {};
      db.themeLaws[theme] = laws.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    }
    writeDb(db);
    return sendJson(res, 201, { themes: db.themes, themeLaws: db.themeLaws });
  }

  if (req.method === "POST" && pathname === "/api/detail-themes") {
    const body = await readBody(req);
    uniquePush(db.detailThemes, body.detailTheme);
    writeDb(db);
    return sendJson(res, 201, { detailThemes: db.detailThemes });
  }

  if (req.method === "GET" && pathname === "/api/laws") {
    const url = new URL(req.url, `http://${req.headers.host}`);
    return sendJson(res, 200, { laws: await lookupLaws(url.searchParams.get("theme") || "", url.searchParams.get("detailTheme") || "", db) });
  }

  if (req.method === "POST" && pathname === "/api/contractors") {
    const body = await readBody(req);
    uniquePush(db.contractors, body.contractor);
    writeDb(db);
    return sendJson(res, 201, { contractors: db.contractors });
  }

  if (req.method === "POST" && pathname === "/api/inspectors") {
    const body = await readBody(req);
    uniquePush(db.inspectors, body.inspector);
    writeDb(db);
    return sendJson(res, 201, { inspectors: db.inspectors });
  }

  if (req.method === "POST" && pathname === "/api/inspectors/delete") {
    const body = await readBody(req);
    const inspector = String(body.inspector || "").trim();
    db.inspectors = db.inspectors.filter((name) => name !== inspector);
    writeDb(db);
    return sendJson(res, 200, { inspectors: db.inspectors });
  }

  if (req.method === "POST" && pathname === "/api/result-samples") {
    db.resultSamples = [];
    writeDb(db);
    return sendJson(res, 200, { resultSamples: [] });
  }

  if (req.method === "POST" && pathname === "/api/inspections") {
    const body = await readBody(req);
    const inspection = normalizeInspection(body);
    if (!isValidInspection(inspection)) {
      return sendJson(res, 400, { message: "테마, 일시, 대상, 점검자, 점검결과는 필수입니다." });
    }
    uniquePush(db.themes, inspection.theme);
    db.themeLaws ||= {};
    db.themeLaws[inspection.theme] ||= [];
    for (const inspector of inspection.inspectors) uniquePush(db.inspectors, inspector);
    db.inspections.unshift(inspection);
    writeDb(db);
    return sendJson(res, 201, { inspection, inspections: db.inspections, stats: buildStats(db) });
  }

  sendJson(res, 404, { message: "API를 찾을 수 없습니다." });
}

function serveStatic(req, res, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const requested = path.normalize(path.join(PUBLIC_DIR, cleanPath));
  if (!requested.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(requested, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("파일을 찾을 수 없습니다.");
    }
    const ext = path.extname(requested).toLowerCase();
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
    } else {
      serveStatic(req, res, url.pathname);
    }
  } catch (error) {
    sendJson(res, 500, { message: error.message || "서버 오류가 발생했습니다." });
  }
});

ensureDb();
server.listen(PORT, () => {
  console.log(`Safety inspection app running at http://localhost:${PORT}`);
});
