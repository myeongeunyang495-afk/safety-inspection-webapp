import { getStore } from "@netlify/blobs";

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
  resultSamples: [
    {
      id: "sample-1",
      title: "즉시개선",
      content: "작업장 내 위험요인을 확인하여 현장에서 즉시 제거하고 작업자에게 재발 방지 교육을 실시함.",
      actionType: "즉시조치완료"
    },
    {
      id: "sample-2",
      title: "개선요청",
      content: "안전표지와 방호장치 상태가 미흡하여 담당 부서에 보완 조치를 요청함.",
      actionType: "조치필요"
    },
    {
      id: "sample-3",
      title: "추적관리",
      content: "개선 계획 수립이 필요한 사항으로 담당자 지정 후 다음 점검 시 조치 완료 여부를 확인 예정임.",
      actionType: "조치필요"
    }
  ],
  inspections: []
};

const previousDefaults = {
  targets: ["역", "사업소", "수급업체"]
};

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function mergeDefaults(db) {
  const next = db || structuredClone(defaultDb);
  for (const [key, value] of Object.entries(defaultDb)) {
    if (!(key in next)) next[key] = structuredClone(value);
  }
  for (const [key, value] of Object.entries(previousDefaults)) {
    if (JSON.stringify(next[key]) === JSON.stringify(value)) next[key] = structuredClone(defaultDb[key]);
  }
  if (JSON.stringify(next.targets) !== JSON.stringify(defaultDb.targets)) {
    next.targets = structuredClone(defaultDb.targets);
  }
  next.themes = (next.themes || []).filter((theme) => !["밀폐공간", "msds"].includes(String(theme).trim().toLowerCase()));
  next.themeLaws ||= {};
  for (const [theme, laws] of Object.entries(defaultDb.themeLaws)) {
    if (!(theme in next.themeLaws)) next.themeLaws[theme] = [...laws];
  }
  for (const item of [...(next.resultSamples || []), ...(next.inspections || [])]) {
    const defaultSample = defaultDb.resultSamples.find((sample) => sample.id === item.id);
    if (defaultSample && next.resultSamples?.includes(item)) Object.assign(item, defaultSample);
    if (["A 조치", "교육", "점검완료"].includes(item.actionType)) item.actionType = "즉시조치완료";
    if (["B 조치", "C 조치"].includes(item.actionType)) item.actionType = "조치필요";
  }
  return next;
}

async function readDb() {
  const store = getStore({ name: "inspection-db", consistency: "strong" });
  const db = await store.get("db", { type: "json" });
  const merged = mergeDefaults(db);
  if (!db) await writeDb(merged);
  return merged;
}

async function writeDb(db) {
  const store = getStore({ name: "inspection-db", consistency: "strong" });
  await store.setJSON("db", db);
}

function getLawApiOc(db) {
  return String(process.env.LAW_API_OC || db.lawApiOc || "").trim();
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
    resultText: String(payload.resultText || "").trim(),
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

async function lookupLaws(theme, detailTheme, db) {
  const oc = getLawApiOc(db);
  const rules = detailThemeLawRules[normalizeLawTheme(detailTheme)];
  if (rules) return lookupThemeArticles(oc, detailTheme, rules);
  if (!oc) return fallbackLaws(theme, detailTheme);
  const query = encodeURIComponent([theme, detailTheme].filter(Boolean).join(" ") || "산업안전보건법");
  try {
    const response = await fetch(`https://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(oc)}&target=law&type=JSON&search=2&query=${query}&display=5`);
    const payload = await response.json();
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
        cache.set(source.id, fetch(`https://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(oc)}&target=law&ID=${source.id}&type=JSON`).then((response) => response.json()));
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

function apiPath(request) {
  const url = new URL(request.url);
  let path = url.pathname;
  path = path.replace(/^\/\.netlify\/functions\/api/, "");
  path = path.replace(/^\/api/, "");
  return path || "/";
}

export default async function handler(request) {
  try {
    const path = apiPath(request);
    const db = await readDb();

    if (request.method === "GET" && path === "/bootstrap") {
      return json(200, {
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

    if (request.method === "POST" && path === "/law-api-oc") {
      const body = await request.json();
      const lawApiOc = String(body.lawApiOc || "").trim();
      if (!lawApiOc) return json(400, { message: "국가법령정보센터 Open API ID가 필요합니다." });
      db.lawApiOc = lawApiOc;
      await writeDb(db);
      return json(200, { hasLawApiOc: true });
    }

    if (request.method === "POST" && path === "/themes") {
      const body = await request.json();
      const theme = String(body.theme || "").trim();
      if (["밀폐공간", "msds"].includes(theme.toLowerCase())) {
        return json(400, { message: "삭제 대상 테마는 등록할 수 없습니다." });
      }
      const laws = String(body.laws || "").trim();
      uniquePush(db.themes, theme);
      if (theme && laws) {
        db.themeLaws[theme] = laws.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      }
      await writeDb(db);
      return json(201, { themes: db.themes, themeLaws: db.themeLaws });
    }

    if (request.method === "POST" && path === "/detail-themes") {
      const body = await request.json();
      uniquePush(db.detailThemes, body.detailTheme);
      await writeDb(db);
      return json(201, { detailThemes: db.detailThemes });
    }

    if (request.method === "GET" && path === "/laws") {
      const url = new URL(request.url);
      const theme = url.searchParams.get("theme") || "";
      const detailTheme = url.searchParams.get("detailTheme") || "";
      return json(200, { laws: await lookupLaws(theme, detailTheme, db) });
    }

    if (request.method === "POST" && path === "/contractors") {
      const body = await request.json();
      uniquePush(db.contractors, body.contractor);
      await writeDb(db);
      return json(201, { contractors: db.contractors });
    }

    if (request.method === "POST" && path === "/inspectors") {
      const body = await request.json();
      uniquePush(db.inspectors, body.inspector);
      await writeDb(db);
      return json(201, { inspectors: db.inspectors });
    }

    if (request.method === "POST" && path === "/inspectors/delete") {
      const body = await request.json();
      const inspector = String(body.inspector || "").trim();
      db.inspectors = db.inspectors.filter((name) => name !== inspector);
      await writeDb(db);
      return json(200, { inspectors: db.inspectors });
    }

    if (request.method === "POST" && path === "/result-samples") {
      const body = await request.json();
      const sample = {
        id: crypto.randomUUID(),
        title: String(body.title || "").trim() || "새 점검결과",
        content: String(body.content || "").trim(),
        actionType: String(body.actionType || "즉시조치완료").trim()
      };
      if (!sample.content) return json(400, { message: "점검결과 내용이 필요합니다." });
      db.resultSamples.unshift(sample);
      await writeDb(db);
      return json(201, { sample, resultSamples: db.resultSamples });
    }

    if (request.method === "POST" && path === "/inspections") {
      const body = await request.json();
      const inspection = normalizeInspection(body);
      if (!isValidInspection(inspection)) {
        return json(400, { message: "테마, 일시, 대상, 점검자, 점검결과는 필수입니다." });
      }
      uniquePush(db.themes, inspection.theme);
      db.themeLaws[inspection.theme] ||= [];
      for (const inspector of inspection.inspectors) uniquePush(db.inspectors, inspector);
      db.inspections.unshift(inspection);
      await writeDb(db);
      return json(201, { inspection, inspections: db.inspections, stats: buildStats(db) });
    }

    return json(404, { message: "API를 찾을 수 없습니다." });
  } catch (error) {
    return json(500, { message: error.message || "서버 오류가 발생했습니다." });
  }
}
