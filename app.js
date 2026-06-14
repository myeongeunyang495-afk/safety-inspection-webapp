const state = {
  themes: [],
  themeLaws: {},
  detailThemes: [],
  targets: [],
  contractors: [],
  inspectors: [],
  resultSamples: [],
  inspections: [],
  stats: { total: 0, byTheme: [], byAction: {}, targetByMonth: {} },
  googleAccessToken: "",
  googleTokenClient: null,
  supabase: null,
  supabaseUser: null,
  supabaseEnabled: false,
  photos: {
    beforePhoto: ""
  },
  currentLaws: []
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function todayLocalDateTime() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "요청 처리에 실패했습니다.");
  return data;
}

async function initSupabase() {
  try {
    const config = await api("/api/config");
    if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) {
      renderAuthState("Supabase 미설정: 현재는 공용 저장 방식입니다.");
      return;
    }
    state.supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    state.supabaseEnabled = true;
    const { data } = await state.supabase.auth.getUser();
    state.supabaseUser = data.user || null;
    state.supabase.auth.onAuthStateChange(async (_event, session) => {
      state.supabaseUser = session?.user || null;
      renderAuthState();
      await loadSupabaseInspections();
    });
    renderAuthState();
  } catch (error) {
    renderAuthState(`Supabase 설정 확인 실패: ${error.message}`);
  }
}

function renderAuthState(message = "") {
  const panel = $("#auth-panel");
  if (!panel) return;
  const status = $("#auth-status");
  const signedIn = Boolean(state.supabaseUser);
  panel.classList.toggle("is-disabled", !state.supabaseEnabled);
  $("#auth-sign-out").hidden = !signedIn;
  $("#auth-sign-in").hidden = signedIn;
  $("#auth-sign-up").hidden = signedIn;
  $("#auth-email").disabled = signedIn || !state.supabaseEnabled;
  $("#auth-password").disabled = signedIn || !state.supabaseEnabled;
  if (message) {
    status.textContent = message;
  } else if (!state.supabaseEnabled) {
    status.textContent = "Supabase 환경변수를 설정하면 개인별 저장이 켜집니다.";
  } else if (signedIn) {
    status.textContent = `${state.supabaseUser.email} 계정으로 저장 중`;
  } else {
    status.textContent = "로그인하면 본인 자료만 저장/조회됩니다.";
  }
}

async function signInSupabase() {
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  if (!email || !password) return setStatus("이메일과 비밀번호를 입력하세요.");
  const { error } = await state.supabase.auth.signInWithPassword({ email, password });
  if (error) return setStatus(error.message);
  setStatus("로그인되었습니다.");
}

async function signUpSupabase() {
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  if (!email || !password) return setStatus("이메일과 비밀번호를 입력하세요.");
  const { error } = await state.supabase.auth.signUp({ email, password });
  if (error) return setStatus(error.message);
  setStatus("가입되었습니다. 이메일 확인 설정이 켜져 있으면 메일 인증 후 로그인하세요.");
}

async function signOutSupabase() {
  const { error } = await state.supabase.auth.signOut();
  if (error) return setStatus(error.message);
  state.inspections = [];
  state.stats = buildStatsFromInspections(state.inspections);
  renderList();
  renderStats();
  setStatus("로그아웃되었습니다.");
}

function fillSelect(select, items, placeholder) {
  select.innerHTML = "";
  if (placeholder) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = placeholder;
    select.append(option);
  }
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item;
    option.textContent = item;
    select.append(option);
  }
}

function renderFormOptions() {
  const currentTheme = $("#theme").value;
  const currentDetailTheme = $("#detailTheme").value;
  const currentTarget = $("#targetCategory").value;
  const themeFilter = $("#filter-theme").value;
  const detailFilter = $("#filter-detail-theme").value;
  const themeFilterItems = [...new Set([
    ...state.themes,
    ...state.inspections.map((item) => item.theme).filter(Boolean)
  ])];
  const detailFilterItems = [...new Set([
    ...state.detailThemes,
    ...state.inspections.map((item) => item.detailTheme).filter(Boolean)
  ])];
  fillSelect($("#theme"), state.themes);
  fillSelect($("#detailTheme"), state.detailThemes);
  fillSelect($("#filter-theme"), ["전체", ...themeFilterItems]);
  fillSelect($("#filter-detail-theme"), ["전체 세부테마", ...detailFilterItems]);
  if (state.themes.includes(currentTheme)) $("#theme").value = currentTheme;
  if (state.detailThemes.includes(currentDetailTheme)) $("#detailTheme").value = currentDetailTheme;
  if (themeFilterItems.includes(themeFilter)) $("#filter-theme").value = themeFilter;
  if (detailFilterItems.includes(detailFilter)) $("#filter-detail-theme").value = detailFilter;
  renderTargetOptions(currentTarget);

  const sampleSelect = $("#result-sample");
  const selectedSample = sampleSelect.value;
  sampleSelect.innerHTML = '<option value="">직접작성</option>';
  const previousResults = uniquePreviousResults();
  for (const sample of previousResults) {
    const option = document.createElement("option");
    option.value = sample.id;
    option.textContent = sample.title;
    sampleSelect.append(option);
  }
  sampleSelect.value = selectedSample;
  renderInspectors();
  renderThemeLaws();
  updateResultMode();
}

function renderTargetOptions(previousValue = "") {
  const owner = $("#targetOwner").value;
  const items = owner === "수급업체(공사업체 포함)" ? state.contractors : state.targets;
  fillSelect($("#targetCategory"), items);
  if (items.includes(previousValue)) $("#targetCategory").value = previousValue;
}

function renderInspectors() {
  const selected = new Set(getSelectedInspectors());
  $("#inspector-options").innerHTML = state.inspectors.map((name) => `
    <label class="check-item">
      <input type="checkbox" name="inspectors" value="${escapeHtml(name)}" ${selected.has(name) ? "checked" : ""}>
      <span>${escapeHtml(name)}</span>
      <button class="delete-inspector" type="button" data-action="delete-inspector" data-name="${escapeHtml(name)}">삭제</button>
    </label>
  `).join("");
}

function getSelectedInspectors() {
  return $$('input[name="inspectors"]:checked').map((item) => item.value);
}

function uniquePreviousResults() {
  const seen = new Set();
  const samples = [];
  for (const item of state.inspections) {
    const content = String(item.resultText || "").trim();
    if (!content || seen.has(content)) continue;
    seen.add(content);
    samples.push({
      id: `previous:${item.id}`,
      title: content.length > 28 ? `${content.slice(0, 28)}...` : content,
      content,
      actionType: item.actionType || "즉시조치완료"
    });
  }
  return samples;
}

function selectedPreviousResult(value) {
  return uniquePreviousResults().find((item) => item.id === value);
}

function renderThemeLaws() {
  const theme = $("#theme").value;
  const detailTheme = $("#detailTheme").value;
  const laws = state.currentLaws;
  $("#law-theme-name").textContent = [theme, detailTheme].filter(Boolean).join(" / ");
  $("#theme-laws").innerHTML = laws.length
    ? laws.map((law) => `<li>${escapeHtml(law)}</li>`).join("")
    : "<li>세부 점검테마를 선택하면 국가법령정보센터 Open API로 관련 법령을 조회합니다.</li>";
}

async function loadLaws() {
  const theme = $("#theme").value;
  const detailTheme = $("#detailTheme").value;
  if (!theme && !detailTheme) return renderThemeLaws();
  state.currentLaws = [];
  renderThemeLaws();
  const query = new URLSearchParams({ theme, detailTheme });
  const data = await api(`/api/laws?${query.toString()}`);
  state.currentLaws = data.laws || [];
  renderThemeLaws();
}

function renderList() {
  const list = $("#inspection-list");
  const filter = $("#filter-theme").value || "전체";
  const detailFilter = $("#filter-detail-theme").value || "전체 세부테마";
  const items = state.inspections.filter((item) => {
    const themeMatches = filter === "전체" || item.theme === filter;
    const detailMatches = detailFilter === "전체 세부테마" || item.detailTheme === detailFilter;
    return themeMatches && detailMatches;
  });

  if (!items.length) {
    list.innerHTML = '<div class="empty">저장된 점검결과가 없습니다.</div>';
    return;
  }

  list.innerHTML = items.map((item) => `
    <article class="inspection-card" data-id="${escapeHtml(item.id)}">
      <button class="inspection-summary" type="button" data-action="toggle-detail" data-id="${escapeHtml(item.id)}">
        <span><span class="summary-label">테마</span><strong>${escapeHtml(item.theme)}</strong></span>
        <span><span class="summary-label">일시</span>${formatDate(item.inspectedAt)}</span>
        <span><span class="summary-label">대상</span>${escapeHtml(displayTarget(item))}</span>
        <span><span class="summary-label">점검자</span>${escapeHtml(displayInspectors(item))}</span>
      </button>
      <div class="inspection-detail">
        <div class="meta">
          <span>조치 구분: ${escapeHtml(item.actionType)}</span>
          <span>제목: ${escapeHtml(item.resultTitle || "-")}</span>
          <span>세부 점검테마: ${escapeHtml(item.detailTheme || "-")}</span>
        </div>
        ${item.resultText ? `<div class="result">${escapeHtml(item.resultText)}</div>` : ""}
        ${lawBlock(item.theme, item.laws)}
        <div class="card-photos">
          ${photoFigure(item.beforePhoto, "조치 전")}
        </div>
        <div class="download-actions">
          <button type="button" data-action="download-doc" data-id="${escapeHtml(item.id)}">한글파일 다운로드</button>
          <button type="button" data-action="download-excel" data-id="${escapeHtml(item.id)}">엑셀파일 다운로드</button>
          <button type="button" data-action="drive-doc" data-id="${escapeHtml(item.id)}">드라이브 한글 저장</button>
          <button type="button" data-action="drive-excel" data-id="${escapeHtml(item.id)}">드라이브 엑셀 저장</button>
        </div>
      </div>
    </article>
  `).join("");
}

function displayTarget(item) {
  if (item.targetOwner || item.targetCategory || item.targetDetail) {
    return `${item.targetOwner || ""} ${item.targetCategory || ""} ${item.targetDetail || ""}`.trim();
  }
  if (item.targetCategory || item.targetDetail) return `${item.targetCategory || ""} ${item.targetDetail || ""}`.trim();
  return item.target || "";
}

function displayInspectors(item) {
  if (Array.isArray(item.inspectors) && item.inspectors.length) return item.inspectors.join(", ");
  return item.inspector || "";
}

function lawBlock(theme, itemLaws = []) {
  const laws = itemLaws;
  if (!laws.length) return "";
  return `
    <div class="card-laws">
      <strong>관련 산업안전보건 법령</strong>
      <ul>${laws.map((law) => `<li>${escapeHtml(law)}</li>`).join("")}</ul>
    </div>
  `;
}

function photoFigure(src, label) {
  if (!src) {
    return `<figure><img alt="${label} 사진 없음"><figcaption>${label} 사진 없음</figcaption></figure>`;
  }
  return `<figure><img src="${src}" alt="${label} 사진"><figcaption>${label} 사진</figcaption></figure>`;
}

function renderStats() {
  $("#total-count").textContent = `총 ${state.stats.total}건`;
  renderBarStats("#theme-stats", state.stats.byTheme.map((item) => ({
    label: item.theme,
    value: item.total,
    detail: Object.entries(item.actions).map(([name, count]) => `${name} ${count}건`).join(", ")
  })));
  renderBarStats("#action-stats", Object.entries(state.stats.byAction).map(([label, value]) => ({ label, value })));
  renderTargetMonthStats();
}

function renderBarStats(selector, rows) {
  const container = $(selector);
  if (!rows.length) {
    container.innerHTML = '<div class="empty">통계 데이터가 없습니다.</div>';
    return;
  }
  const max = Math.max(...rows.map((row) => row.value), 1);
  container.innerHTML = rows.map((row) => `
    <div class="stat-row">
      <strong>${escapeHtml(row.label)}</strong>
      <div class="bar" aria-hidden="true"><span style="width: ${(row.value / max) * 100}%"></span></div>
      <span>${row.value}건</span>
      ${row.detail ? `<small>${escapeHtml(row.detail)}</small>` : ""}
    </div>
  `).join("");
}

function renderTargetMonthStats() {
  const data = state.stats.targetByMonth;
  const targets = Object.keys(data);
  const container = $("#target-month-stats");
  if (!targets.length) {
    container.innerHTML = '<div class="empty">월별 방문 데이터가 없습니다.</div>';
    return;
  }

  const months = [...new Set(targets.flatMap((target) => Object.keys(data[target])))].sort();
  container.innerHTML = `
    <table class="mini-table">
      <thead>
        <tr><th>점검대상</th>${months.map((month) => `<th>${month}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${targets.map((target) => `
          <tr>
            <th>${escapeHtml(target)}</th>
            ${months.map((month) => `<td>${data[target][month] || 0}회</td>`).join("")}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function buildStatsFromInspections(inspections) {
  const byTheme = {};
  const byAction = {};
  const targetByMonth = {};

  for (const item of inspections) {
    byTheme[item.theme] ||= { theme: item.theme, total: 0, actions: {} };
    byTheme[item.theme].total += 1;
    byTheme[item.theme].actions[item.actionType] = (byTheme[item.theme].actions[item.actionType] || 0) + 1;
    byAction[item.actionType] = (byAction[item.actionType] || 0) + 1;

    const date = new Date(item.inspectedAt);
    const month = Number.isNaN(date.getTime()) ? "날짜 미상" : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const target = displayTarget(item) || "대상 미상";
    targetByMonth[target] ||= {};
    targetByMonth[target][month] = (targetByMonth[target][month] || 0) + 1;
  }

  return {
    total: inspections.length,
    byTheme: Object.values(byTheme).sort((a, b) => b.total - a.total || a.theme.localeCompare(b.theme, "ko")),
    byAction,
    targetByMonth
  };
}

function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: match[1] });
}

async function signedPhotoUrl(path) {
  if (!path || !state.supabase) return "";
  const { data, error } = await state.supabase.storage
    .from("inspection-photos")
    .createSignedUrl(path, 60 * 60);
  if (error) return "";
  return data.signedUrl;
}

async function uploadSupabasePhoto(dataUrl) {
  const blob = dataUrlToBlob(dataUrl);
  if (!blob || !state.supabaseUser) return "";
  const path = `${state.supabaseUser.id}/${Date.now()}-${crypto.randomUUID()}.jpg`;
  const { error } = await state.supabase.storage
    .from("inspection-photos")
    .upload(path, blob, {
      contentType: blob.type || "image/jpeg",
      upsert: false
    });
  if (error) throw error;
  return path;
}

async function hydrateSupabaseInspection(row) {
  const item = { id: row.id, ...(row.payload || {}) };
  if (item.beforePhotoPath) item.beforePhoto = await signedPhotoUrl(item.beforePhotoPath);
  return item;
}

async function loadSupabaseInspections() {
  if (!state.supabaseEnabled) return;
  if (!state.supabaseUser) {
    state.inspections = [];
    state.stats = buildStatsFromInspections(state.inspections);
    renderFormOptions();
    renderList();
    renderStats();
    return;
  }
  const { data, error } = await state.supabase
    .from("inspections")
    .select("id,payload,created_at")
    .eq("user_id", state.supabaseUser.id)
    .order("created_at", { ascending: false });
  if (error) {
    setStatus(error.message);
    return;
  }
  state.inspections = await Promise.all((data || []).map(hydrateSupabaseInspection));
  state.stats = buildStatsFromInspections(state.inspections);
  renderFormOptions();
  renderList();
  renderStats();
}

async function saveSupabaseInspection(payload) {
  if (!state.supabaseUser) throw new Error("로그인 후 저장할 수 있습니다.");
  const next = { ...payload };
  if (next.beforePhoto) {
    next.beforePhotoPath = await uploadSupabasePhoto(next.beforePhoto);
    next.beforePhoto = await signedPhotoUrl(next.beforePhotoPath);
  }
  const { data, error } = await state.supabase
    .from("inspections")
    .insert({ user_id: state.supabaseUser.id, payload: next })
    .select("id,payload,created_at")
    .single();
  if (error) throw error;
  const saved = await hydrateSupabaseInspection(data);
  state.inspections = [saved, ...state.inspections];
  state.stats = buildStatsFromInspections(state.inspections);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fileSafe(value) {
  return String(value || "점검결과").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
}

function setStatus(message) {
  $("#save-status").textContent = message;
  window.clearTimeout(setStatus.timer);
  setStatus.timer = window.setTimeout(() => {
    $("#save-status").textContent = "";
  }, 3000);
}

function readPhoto(input, key, preview) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const compressed = await compressImage(reader.result);
    state.photos[key] = compressed;
    preview.src = compressed;
  };
  reader.readAsDataURL(file);
}

function compressImage(dataUrl, maxSize = 900, quality = 0.62) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

function downloadBlob(filename, mimeType, content) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dataUrlToMimePart(dataUrl, contentId) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return "";
  return [
    `Content-Type: ${match[1]}`,
    "Content-Transfer-Encoding: base64",
    `Content-ID: <${contentId}>`,
    `Content-Location: ${contentId}`,
    "",
    match[2].replace(/(.{76})/g, "$1\r\n")
  ].join("\r\n");
}

function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/(.{76})/g, "$1\r\n");
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function inlinePhotoForDocument(item) {
  if (!item.beforePhoto || item.beforePhoto.startsWith("data:")) return item;
  try {
    const response = await fetch(item.beforePhoto);
    if (!response.ok) return item;
    const dataUrl = await blobToDataUrl(await response.blob());
    return { ...item, beforePhoto: dataUrl };
  } catch {
    return item;
  }
}

function inspectionDocHtml(item) {
  const laws = item.laws || [];
  return `
    <!doctype html>
    <html lang="ko">
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Malgun Gothic, Arial, sans-serif; line-height: 1.6; }
          h1 { font-size: 22px; }
          table { width: 100%; border-collapse: collapse; margin: 12px 0; }
          th, td { border: 1px solid #999; padding: 8px; text-align: left; vertical-align: top; }
          th { width: 140px; background: #f0f0f0; }
          img { width: 60px; height: 60px; object-fit: cover; }
          .photo-cell { text-align: center; }
        </style>
      </head>
      <body>
        <h1>점검결과</h1>
        <table>
          <tr><th>점검테마</th><td>${escapeHtml(item.theme)}</td></tr>
          <tr><th>점검일시</th><td>${formatDate(item.inspectedAt)}</td></tr>
          <tr><th>점검대상</th><td>${escapeHtml(displayTarget(item))}</td></tr>
          <tr><th>점검자</th><td>${escapeHtml(displayInspectors(item))}</td></tr>
          <tr><th>세부 점검테마</th><td>${escapeHtml(item.detailTheme || "-")}</td></tr>
          <tr><th>조치 구분</th><td>${escapeHtml(item.actionType)}</td></tr>
          <tr><th>점검결과</th><td>${escapeHtml(item.resultText).replaceAll("\n", "<br>")}</td></tr>
          <tr><th>관련 법령</th><td>${laws.map(escapeHtml).join("<br>") || "-"}</td></tr>
        </table>
        <table>
          <tr><th>조치 전 사진</th></tr>
          <tr><td class="photo-cell">${item.beforePhoto ? `<img src="${item.beforePhoto}" alt="조치 전 사진">` : "사진 없음"}</td></tr>
        </table>
      </body>
    </html>
  `;
}

function inspectionDocMhtml(item) {
  const boundary = `----=_InspectionReport_${Date.now()}`;
  const html = inspectionDocHtml(item).replace(item.beforePhoto || "__NO_PHOTO__", "cid:before-photo.jpg");
  const parts = [
    "MIME-Version: 1.0",
    `Content-Type: multipart/related; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "Content-Location: inspection-report.html",
    "",
    encodeBase64Utf8(html)
  ];
  const imagePart = dataUrlToMimePart(item.beforePhoto, "before-photo.jpg");
  if (imagePart) parts.push(`--${boundary}`, imagePart);
  parts.push(`--${boundary}--`, "");
  return parts.join("\r\n");
}

function inspectionExcelHtml(item) {
  const laws = item.laws || [];
  return `
    <html>
      <head><meta charset="utf-8"></head>
      <body>
        <table border="1">
          <tr>
            <th>점검테마</th><th>점검일시</th><th>점검대상</th><th>점검자</th>
            <th>세부 점검테마</th><th>조치 구분</th><th>점검결과</th><th>관련 법령</th>
          </tr>
          <tr>
            <td>${escapeHtml(item.theme)}</td>
            <td>${formatDate(item.inspectedAt)}</td>
            <td>${escapeHtml(displayTarget(item))}</td>
            <td>${escapeHtml(displayInspectors(item))}</td>
            <td>${escapeHtml(item.detailTheme || "")}</td>
            <td>${escapeHtml(item.actionType)}</td>
            <td>${escapeHtml(item.resultText)}</td>
            <td>${laws.map(escapeHtml).join("\n")}</td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

async function inspectionFile(item, type) {
  const base = `${fileSafe(item.theme)}_${fileSafe(displayTarget(item))}`;
  if (type === "doc") {
    const docItem = await inlinePhotoForDocument(item);
    return {
      filename: `${base}.doc`,
      mimeType: "application/msword",
      content: inspectionDocMhtml(docItem)
    };
  }
  return {
    filename: `${base}.xls`,
    mimeType: "application/vnd.ms-excel",
    content: "\ufeff" + inspectionExcelHtml(item)
  };
}

function downloadInspection(item, type) {
  return inspectionFile(item, type).then((file) => {
  downloadBlob(file.filename, file.mimeType, file.content);
    setStatus(`${file.filename} 다운로드를 시작했습니다.`);
  });
}

function renderDriveStatus() {
  const status = $("#drive-status");
  if (!status) return;
  const clientId = localStorage.getItem("googleClientId") || "";
  status.textContent = clientId
    ? "Google Drive 연결 준비됨"
    : "Google Cloud OAuth Client ID를 저장하세요.";
}

function loadGoogleClientId() {
  const input = $("#google-client-id");
  if (!input) return;
  input.value = localStorage.getItem("googleClientId") || "";
  renderDriveStatus();
}

function activateView(viewId) {
  $$(".tab").forEach((item) => item.classList.toggle("is-active", item.dataset.view === viewId));
  $$(".view").forEach((view) => view.classList.toggle("is-active", view.id === viewId));
}

function saveGoogleClientId() {
  const value = $("#google-client-id").value.trim();
  if (!value) return setStatus("Google OAuth Client ID를 입력하세요.");
  localStorage.setItem("googleClientId", value);
  state.googleTokenClient = null;
  renderDriveStatus();
  setStatus("Google OAuth Client ID가 저장되었습니다.");
}

function requestGoogleAccessToken() {
  return new Promise((resolve, reject) => {
    const clientId = localStorage.getItem("googleClientId") || "";
    if (!clientId) return reject(new Error("Google OAuth Client ID를 먼저 저장하세요."));
    if (!window.google?.accounts?.oauth2) return reject(new Error("Google 로그인 라이브러리를 불러오지 못했습니다."));
    state.googleTokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (response) => {
        if (response?.access_token) {
          state.googleAccessToken = response.access_token;
          resolve(response.access_token);
          return;
        }
        reject(new Error(response?.error || "Google Drive 연결에 실패했습니다."));
      }
    });
    state.googleTokenClient.requestAccessToken({ prompt: state.googleAccessToken ? "" : "consent" });
  });
}

async function uploadInspectionToDrive(item, type) {
  const token = await requestGoogleAccessToken();
  const file = await inspectionFile(item, type);
  const boundary = `inspection_upload_${Date.now()}`;
  const metadata = {
    name: file.filename,
    mimeType: file.mimeType
  };
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${file.mimeType}; charset=UTF-8`,
    "",
    file.content,
    `--${boundary}--`,
    ""
  ].join("\r\n");

  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id%2CwebViewLink%2Cname", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Google Drive 업로드에 실패했습니다.");
  $("#drive-status").innerHTML = `<a href="${data.webViewLink}" target="_blank" rel="noopener">${escapeHtml(data.name)}</a> 저장 완료`;
  return data;
}

async function loadData() {
  const data = await api("/api/bootstrap");
  Object.assign(state, data);
  renderFormOptions();
  await loadLaws();
  if (state.supabaseEnabled) {
    await loadSupabaseInspections();
  } else {
    renderList();
    renderStats();
  }
}

function bindEvents() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => activateView(tab.dataset.view));
  });

  $("#result-sample").addEventListener("change", (event) => {
    const sample = selectedPreviousResult(event.target.value);
    if (sample) $("#actionType").value = normalizeActionType(sample.actionType);
    updateResultMode();
  });

  $("#theme").addEventListener("change", loadLaws);
  $("#detailTheme").addEventListener("change", loadLaws);
  $("#targetOwner").addEventListener("change", () => renderTargetOptions());
  $("#filter-theme").addEventListener("change", renderList);
  $("#filter-detail-theme").addEventListener("change", renderList);
  $("#save-google-client-id").addEventListener("click", saveGoogleClientId);
  $("#auth-sign-in").addEventListener("click", signInSupabase);
  $("#auth-sign-up").addEventListener("click", signUpSupabase);
  $("#auth-sign-out").addEventListener("click", signOutSupabase);

  $("#inspection-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const item = state.inspections.find((inspection) => inspection.id === button.dataset.id);
    if (!item) return;
    if (button.dataset.action === "toggle-detail") {
      button.closest(".inspection-card").classList.toggle("is-open");
    }
    if (button.dataset.action === "download-doc" || button.dataset.action === "download-excel") {
      try {
        button.disabled = true;
        const type = button.dataset.action === "download-doc" ? "doc" : "excel";
        await downloadInspection(item, type);
      } catch (error) {
        setStatus(error.message);
      } finally {
        button.disabled = false;
      }
    }
    if (button.dataset.action === "drive-doc" || button.dataset.action === "drive-excel") {
      try {
        button.disabled = true;
        const type = button.dataset.action === "drive-doc" ? "doc" : "excel";
        await uploadInspectionToDrive(item, type);
      } catch (error) {
        setStatus(error.message);
      } finally {
        button.disabled = false;
      }
    }
  });

  $("#beforePhoto").addEventListener("change", (event) => readPhoto(event.target, "beforePhoto", $("#before-preview")));
  $("#add-detail-theme").addEventListener("click", async () => {
    const detailTheme = $("#new-detail-theme").value.trim();
    if (!detailTheme) return setStatus("새로운 세부 점검테마를 입력하세요.");
    const data = await api("/api/detail-themes", {
      method: "POST",
      body: JSON.stringify({ detailTheme })
    });
    state.detailThemes = data.detailThemes;
    renderFormOptions();
    $("#detailTheme").value = detailTheme;
    $("#new-detail-theme").value = "";
    $("#form-top").scrollIntoView({ behavior: "smooth", block: "start" });
    loadLaws();
    setStatus("세부 점검테마가 등록되었습니다.");
  });

  $("#add-contractor").addEventListener("click", async () => {
    const contractor = $("#new-contractor").value.trim();
    if (!contractor) return setStatus("추가할 수급업체명을 입력하세요.");
    const data = await api("/api/contractors", {
      method: "POST",
      body: JSON.stringify({ contractor })
    });
    state.contractors = data.contractors;
    $("#new-contractor").value = "";
    $("#targetOwner").value = "수급업체(공사업체 포함)";
    renderTargetOptions(contractor);
    setStatus("수급업체가 등록되었습니다.");
  });

  $("#add-inspector").addEventListener("click", async () => {
    const inspector = $("#new-inspector").value.trim();
    if (!inspector) return setStatus("추가할 인원을 입력하세요.");
    const data = await api("/api/inspectors", {
      method: "POST",
      body: JSON.stringify({ inspector })
    });
    state.inspectors = data.inspectors;
    $("#new-inspector").value = "";
    renderInspectors();
    const added = $(`input[name="inspectors"][value="${CSS.escape(inspector)}"]`);
    if (added) added.checked = true;
    setStatus("점검자가 등록되었습니다.");
  });

  $("#inspector-options").addEventListener("click", async (event) => {
    const button = event.target.closest('[data-action="delete-inspector"]');
    if (!button) return;
    event.preventDefault();
    const inspector = button.dataset.name;
    const data = await api("/api/inspectors/delete", {
      method: "POST",
      body: JSON.stringify({ inspector })
    });
    state.inspectors = data.inspectors;
    renderInspectors();
    setStatus("점검자가 삭제되었습니다.");
  });

  $("#inspection-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const inspectors = getSelectedInspectors();
    if (!inspectors.length) return setStatus("점검자를 한 명 이상 선택하세요.");
    const sample = selectedPreviousResult($("#result-sample").value);
    const directText = $("#new-result-content").value.trim();
    if (!sample && !directText) return setStatus("직접작성 점검결과 내용을 입력하세요.");
    const payload = {
      theme: $("#theme").value,
      detailTheme: $("#detailTheme").value,
      laws: state.currentLaws,
      inspectedAt: $("#inspectedAt").value,
      targetOwner: $("#targetOwner").value,
      targetCategory: $("#targetCategory").value,
      targetDetail: $("#targetDetail").value.trim(),
      inspectors,
      resultTitle: sample?.title || "",
      resultText: sample?.content || directText,
      actionType: $("#actionType").value,
      beforePhoto: state.photos.beforePhoto
    };
    if (state.supabaseEnabled) {
      await saveSupabaseInspection(payload);
    } else {
      const data = await api("/api/inspections", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      state.inspections = data.inspections;
      state.stats = data.stats;
    }
    state.themes = [...new Set([...state.themes, payload.theme])];
    renderFormOptions();
    renderList();
    renderStats();
    event.target.reset();
    $("#inspectedAt").value = todayLocalDateTime();
    $("#before-preview").removeAttribute("src");
    state.photos.beforePhoto = "";
    state.currentLaws = [];
    renderTargetOptions();
    renderThemeLaws();
    setStatus("점검결과 저장완료!");
    window.setTimeout(() => {
      activateView("list");
      renderList();
    }, 700);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  $("#inspectedAt").value = todayLocalDateTime();
  bindEvents();
  loadGoogleClientId();
  try {
    await initSupabase();
    await loadData();
  } catch (error) {
    setStatus(error.message);
  }
});

function normalizeActionType(actionType) {
  if (["A 조치", "교육", "점검완료"].includes(actionType)) return "즉시조치완료";
  if (["B 조치", "C 조치"].includes(actionType)) return "조치필요";
  return actionType || "즉시조치완료";
}

function updateResultMode() {
  const isDirect = $("#result-sample").value === "";
  $("#actionType").disabled = !isDirect;
  $("#new-result-content").disabled = !isDirect;
  $("#new-result-content").placeholder = isDirect
    ? "직접 작성할 점검결과를 입력하거나, 아래 버튼으로 데이터에 등록하세요."
    : "미리 작성된 점검결과를 선택 중입니다.";
}
