const state = {
  themes: [],
  themeLaws: {},
  detailThemes: [],
  targets: [],
  contractors: [],
  inspectors: [],
  resultSamples: [],
  visibleResultSampleIds: new Set(),
  inspections: [],
  trash: [],
  trashVisible: false,
  stats: { total: 0, byTheme: [], byAction: {}, targetByMonth: {} },
  storageClient: null,
  storageEnabled: false,
  selectedInspectionIds: new Set(),
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
  if (!response.ok) throw new Error(data.message || "?遺욧퍕 筌ｌ꼶?????쎈솭??됰뮸??덈뼄.");
  return data;
}

async function initPhotoStorage() {
  try {
    const config = await api("/api/config");
    if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) return;
    state.storageClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    state.storageEnabled = true;
  } catch (error) {
    setStatus(`??彛????關???怨뚭퍙 ??쎈솭: ${error.message}`);
  }
}

function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: match[1] });
}

function storagePublicUrl(path) {
  if (!path || !state.storageClient) return "";
  const { data } = state.storageClient.storage.from("inspection-photos").getPublicUrl(path);
  return data?.publicUrl || "";
}

async function uploadPhotoToStorage(dataUrl) {
  if (!dataUrl || !state.storageEnabled || !state.storageClient) return { beforePhoto: dataUrl };
  const blob = dataUrlToBlob(dataUrl);
  if (!blob) return { beforePhoto: dataUrl };
  const path = `public/${Date.now()}-${crypto.randomUUID()}.jpg`;
  const { error } = await state.storageClient.storage
    .from("inspection-photos")
    .upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false });
  if (error) {
    setStatus(`Supabase ??彛???????쎈솭: ${error.message}`);
    return { beforePhoto: dataUrl };
  }
  return { beforePhoto: storagePublicUrl(path), beforePhotoPath: path };
}

function hydrateStoragePhotos() {
  if (!state.storageClient) return;
  state.inspections = state.inspections.map((item) => {
    if (!item.beforePhotoPath) return item;
    return { ...item, beforePhoto: storagePublicUrl(item.beforePhotoPath) || item.beforePhoto };
  });
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
  fillSelect($("#filter-theme"), ["?袁⑷퍥", ...themeFilterItems]);
  fillSelect($("#filter-detail-theme"), ["?袁⑷퍥 ?紐????춳", ...detailFilterItems]);
  if (state.themes.includes(currentTheme)) $("#theme").value = currentTheme;
  if (state.detailThemes.includes(currentDetailTheme)) $("#detailTheme").value = currentDetailTheme;
  if (themeFilterItems.includes(themeFilter)) $("#filter-theme").value = themeFilter;
  if (detailFilterItems.includes(detailFilter)) $("#filter-detail-theme").value = detailFilter;
  renderTargetOptions(currentTarget);

  const sampleSelect = $("#result-sample");
  const selectedSample = sampleSelect.value;
  sampleSelect.innerHTML = '<option value="">筌욊낯??臾믨쉐</option>';
  for (const sample of state.resultSamples.filter((item) => state.visibleResultSampleIds.has(item.id))) {
    const option = document.createElement("option");
    option.value = sample.id;
    option.textContent = sample.title;
    sampleSelect.append(option);
  }
  if ([...sampleSelect.options].some((option) => option.value === selectedSample)) {
    sampleSelect.value = selectedSample;
  }
  renderInspectors();
  renderThemeLaws();
  updateResultMode();
}

function renderTargetOptions(previousValue = "") {
  const owner = $("#targetOwner").value;
  const items = owner === "??랁닋??녾퍥(?⑤벊沅??녾퍥 ??釉?" ? state.contractors : state.targets;
  fillSelect($("#targetCategory"), items);
  if (items.includes(previousValue)) $("#targetCategory").value = previousValue;
}

function renderInspectors() {
  const selected = new Set(getSelectedInspectors());
  $("#inspector-options").innerHTML = state.inspectors.map((name) => `
    <label class="check-item">
      <input type="checkbox" name="inspectors" value="${escapeHtml(name)}" ${selected.has(name) ? "checked" : ""}>
      <span>${escapeHtml(name)}</span>
      <button class="delete-inspector" type="button" data-action="delete-inspector" data-name="${escapeHtml(name)}">????/button>
    </label>
  `).join("");
}

function getSelectedInspectors() {
  return $$('input[name="inspectors"]:checked').map((item) => item.value);
}

function selectedResultSample() {
  const value = $("#result-sample").value;
  return state.resultSamples.find((item) => item.id === value);
}

function renderThemeLaws() {
  const theme = $("#theme").value;
  const detailTheme = $("#detailTheme").value;
  const laws = state.currentLaws;
  $("#law-theme-name").textContent = [theme, detailTheme].filter(Boolean).join(" / ");
  $("#theme-laws").innerHTML = laws.length
    ? laws.map((law) => `<li>${escapeHtml(law)}</li>`).join("")
    : "<li>?紐? ?癒????춳???醫뤾문??롢늺 ???甕곕베議?類ｋ궖??녠숲 Open API嚥??온??甕곕베議??鈺곌퀬???몃빍??</li>";
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
  const items = filteredInspectionItems();
  const visibleIds = new Set(items.map((item) => item.id));
  for (const id of [...state.selectedInspectionIds]) {
    if (!state.inspections.some((item) => item.id === id)) state.selectedInspectionIds.delete(id);
  }

  if (!items.length) {
    list.innerHTML = '<div class="empty">\uC800\uC7A5\uB41C \uC810\uAC80\uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>';
    renderBulkDownloadState(items);
    renderTrash();
    return;
  }

  list.innerHTML = items.map((item) => `
    <article class="inspection-card" data-id="${escapeHtml(item.id)}">
      <label class="inspection-select">
        <input type="checkbox" data-action="select-inspection" data-id="${escapeHtml(item.id)}" ${state.selectedInspectionIds.has(item.id) ? "checked" : ""}>
        <span>\uC120\uD0DD</span>
      </label>
      <button class="inspection-summary" type="button" data-action="toggle-detail" data-id="${escapeHtml(item.id)}">
        <span><span class="summary-label">\uD14C\uB9C8 / \uC138\uBD80\uD14C\uB9C8</span><strong>${escapeHtml(item.theme)} / ${escapeHtml(item.detailTheme || "-")}</strong></span>
        <span><span class="summary-label">\uC77C\uC2DC</span>${formatDate(item.inspectedAt)}</span>
        <span><span class="summary-label">\uB300\uC0C1</span>${escapeHtml(displayTarget(item))}</span>
        <span><span class="summary-label">\uC810\uAC80\uC790</span>${escapeHtml(displayInspectors(item))}</span>
      </button>
      <div class="inspection-detail">
        <div class="meta">
          <span>\uC870\uCE58 \uAD6C\uBD84: ${escapeHtml(item.actionType)}</span>
          <span>\uC81C\uBAA9: ${escapeHtml(item.resultTitle || "-")}</span>
          <span>\uC138\uBD80 \uC810\uAC80\uD14C\uB9C8: ${escapeHtml(item.detailTheme || "-")}</span>
        </div>
        ${item.resultText ? `<div class="result">${escapeHtml(item.resultText)}</div>` : ""}
        ${lawBlock(item.theme, item.laws)}
        <div class="card-photos">
          ${photoFigure(item.beforePhoto, "\uC870\uCE58 \uC804")}
        </div>
        <div class="download-actions">
          <button type="button" data-action="download-doc" data-id="${escapeHtml(item.id)}">\uD55C\uAE00\uD30C\uC77C \uB2E4\uC6B4\uB85C\uB4DC</button>
          <button type="button" data-action="download-excel" data-id="${escapeHtml(item.id)}">\uC5D1\uC140\uD30C\uC77C \uB2E4\uC6B4\uB85C\uB4DC</button>
        </div>
      </div>
    </article>
  `).join("");
  for (const id of [...state.selectedInspectionIds]) {
    if (!visibleIds.has(id)) state.selectedInspectionIds.delete(id);
  }
  renderBulkDownloadState(items);
  renderTrash();
}

function filteredInspectionItems() {
  const filter = $("#filter-theme").value || "\uC804\uCCB4";
  const detailFilter = $("#filter-detail-theme").value || "\uC804\uCCB4 \uC138\uBD80\uD14C\uB9C8";
  return state.inspections.filter((item) => {
    const themeMatches = filter === "\uC804\uCCB4" || item.theme === filter;
    const detailMatches = detailFilter === "\uC804\uCCB4 \uC138\uBD80\uD14C\uB9C8" || item.detailTheme === detailFilter;
    return themeMatches && detailMatches;
  });
}

function renderBulkDownloadState(items = filteredInspectionItems()) {
  const visibleIds = items.map((item) => item.id);
  const selectedVisibleCount = visibleIds.filter((id) => state.selectedInspectionIds.has(id)).length;
  const selectAll = $("#select-all-inspections");
  if (selectAll) {
    selectAll.checked = Boolean(visibleIds.length && selectedVisibleCount === visibleIds.length);
    selectAll.indeterminate = Boolean(selectedVisibleCount && selectedVisibleCount < visibleIds.length);
    selectAll.disabled = !visibleIds.length;
  }
  $("#download-selected-doc").disabled = !selectedVisibleCount;
  $("#download-selected-excel").disabled = !selectedVisibleCount;
  const deleteSelected = $("#delete-selected");
  if (deleteSelected) deleteSelected.disabled = !visibleIds.length;
  $("#selected-count").textContent = `\uC120\uD0DD ${selectedVisibleCount}\uAC74`;
}

function renderTrash() {
  const panel = $("#trash-panel");
  const toggle = $("#toggle-trash");
  const container = $("#trash-list");
  const items = state.trash || [];
  if (toggle) {
    toggle.textContent = state.trashVisible ? `\uD734\uC9C0\uD1B5 \uB2EB\uAE30 (${items.length}\uAC74)` : `\uD734\uC9C0\uD1B5 \uBCF4\uAE30 (${items.length}\uAC74)`;
    toggle.setAttribute("aria-expanded", String(state.trashVisible));
  }
  if (panel) panel.hidden = !state.trashVisible;
  if (!container || !state.trashVisible) return;
  if (!items.length) {
    container.innerHTML = '<div class="empty">\uD734\uC9C0\uD1B5\uC774 \uBE44\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.</div>';
    return;
  }
  container.innerHTML = items.map((item) => `
    <article class="trash-card">
      <strong>${escapeHtml(item.theme || "-")} / ${escapeHtml(item.detailTheme || "-")}</strong>
      <span>\uC0AD\uC81C\uC790: ${escapeHtml(item.deletedBy || "-")}</span>
      <span>\uC0AD\uC81C\uC77C\uC2DC: ${formatDate(item.deletedAt)}</span>
      <p>${escapeHtml(item.resultText || "-")}</p>
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
  const laws = itemLaws.length ? itemLaws : state.themeLaws[theme] || [];
  if (!laws.length) return "";
  return `
    <div class="card-laws">
      <strong>\uAD6D\uAC00\uBC95\uB839\uC815\uBCF4\uC13C\uD130 \uAD00\uB828 \uBC95\uB839</strong>
      <ul>${laws.map((law) => `<li>${escapeHtml(law)}</li>`).join("")}</ul>
    </div>
  `;
}

function photoFigure(src, label) {
  if (!src) {
    return `<figure><img alt="${label} \uC0AC\uC9C4 \uC5C6\uC74C"><figcaption>${label} \uC0AC\uC9C4 \uC5C6\uC74C</figcaption></figure>`;
  }
  return `<figure><img src="${src}" alt="${label} \uC0AC\uC9C4"><figcaption>${label} \uC0AC\uC9C4</figcaption></figure>`;
}

function renderStats() {
  $("#total-count").textContent = `\uCD1D ${state.stats.total}\uAC74`;
  renderBarStats("#theme-stats", state.stats.byTheme.map((item) => ({
    label: item.theme,
    value: item.total,
    detail: Object.entries(item.actions).map(([name, count]) => `${name} ${count}\uAC74`).join(", ")
  })));
  renderBarStats("#action-stats", Object.entries(state.stats.byAction).map(([label, value]) => ({ label, value })));
  renderTargetMonthStats();
}

function renderBarStats(selector, rows) {
  const container = $(selector);
  if (!rows.length) {
    container.innerHTML = '<div class="empty">\uC9D1\uACC4\uD560 \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>';
    return;
  }
  const max = Math.max(...rows.map((row) => row.value), 1);
  container.innerHTML = rows.map((row) => `
    <div class="stat-row">
      <strong>${escapeHtml(row.label)}</strong>
      <div class="bar" aria-hidden="true"><span style="width: ${(row.value / max) * 100}%"></span></div>
      <span>${row.value}\uAC74</span>
      ${row.detail ? `<small>${escapeHtml(row.detail)}</small>` : ""}
    </div>
  `).join("");
}

function renderTargetMonthStats() {
  const data = state.stats.targetByMonth;
  const targets = Object.keys(data);
  const container = $("#target-month-stats");
  if (!targets.length) {
    container.innerHTML = '<div class="empty">\uBC29\uBB38 \uD1B5\uACC4\uB97C \uBCF4\uC5EC\uC904 \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>';
    return;
  }
  const months = [...new Set(targets.flatMap((target) => Object.keys(data[target])))].sort();
  container.innerHTML = `
    <table class="mini-table">
      <thead>
        <tr><th>\uC810\uAC80\uB300\uC0C1</th>${months.map((month) => `<th>${month}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${targets.map((target) => `
          <tr>
            <th>${escapeHtml(target)}</th>
            ${months.map((month) => `<td>${data[target][month] || 0}\uD68C</td>`).join("")}
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
    const detailTheme = item.detailTheme || "\uC138\uBD80\uD14C\uB9C8 \uBBF8\uC9C0\uC815";
    byTheme[detailTheme] ||= { theme: detailTheme, total: 0, actions: {} };
    byTheme[detailTheme].total += 1;
    byTheme[detailTheme].actions[item.actionType] = (byTheme[detailTheme].actions[item.actionType] || 0) + 1;
    byAction[item.actionType] = (byAction[item.actionType] || 0) + 1;
    const date = new Date(item.inspectedAt);
    const month = Number.isNaN(date.getTime()) ? "\uB0A0\uC9DC \uBBF8\uC9C0\uC815" : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const target = displayTarget(item) || "\uB300\uC0C1 \uBBF8\uC9C0\uC815";
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

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fileSafe(value) {
  return String(value || "\uC810\uAC80\uACB0\uACFC").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
}

function setStatus(message) {
  $("#save-status").textContent = message;
  window.clearTimeout(setStatus.timer);
  setStatus.timer = window.setTimeout(() => {
    $("#save-status").textContent = "";
  }, 3000);
}

function showAlert(message) {
  window.alert(message);
  setStatus(message);
}

function readPhoto(input, key, preview) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const compressed = await compressImage(reader.result);
    state.photos[key] = compressed;
    preview.src = compressed;
    const originalKb = Math.max(1, Math.round(file.size / 1024));
    const compressedKb = Math.max(1, Math.round(estimatedDataUrlBytes(compressed) / 1024));
    setStatus(`??彛??類ㅽ뀧 ?袁⑥┷: ${originalKb}KB -> ${compressedKb}KB`);
  };
  reader.readAsDataURL(file);
}

function estimatedDataUrlBytes(dataUrl) {
  const base64 = String(dataUrl || "").split(",")[1] || "";
  return Math.floor((base64.length * 3) / 4);
}

function compressImage(dataUrl, maxSize = 720, quality = 0.58) {
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
  const photoHtml = item.beforePhoto
    ? `<img src="${item.beforePhoto}" width="50" height="50" alt="鈺곌퀣??????彛? style="width:50px;height:50px;max-width:50px;max-height:50px;mso-width-alt:50;mso-height-alt:50;border:1px solid #999;">`
    : "??彛???곸벉";
  return `
    <!doctype html>
    <html lang="ko">
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Malgun Gothic, Arial, sans-serif; line-height: 1.55; color: #111; }
          h1 { margin: 0 0 14px; font-size: 20px; text-align: center; }
          table { width: 100%; border-collapse: collapse; margin: 10px 0; table-layout: fixed; }
          th, td { border: 1px solid #777; padding: 7px; text-align: left; vertical-align: top; font-size: 10.5pt; word-break: break-all; }
          th { width: 120px; background: #eef4fb; font-weight: 700; }
          .result-cell { min-height: 70px; }
          .photo-cell { height: 62px; text-align: center; vertical-align: middle; }
          .photo-cell img { width: 50px !important; height: 50px !important; max-width: 50px !important; max-height: 50px !important; }
        </style>
      </head>
      <body>
        <h1>??됱읈癰귣떯援??癒?野껉퀗??/h1>
        <table>
          <tr><th>?癒????춳</th><td>${escapeHtml(item.theme)}</td><th>?紐? ?癒????춳</th><td>${escapeHtml(item.detailTheme || "-")}</td></tr>
          <tr><th>?癒???깅뻻</th><td>${formatDate(item.inspectedAt)}</td><th>鈺곌퀣???닌됲뀋</th><td>${escapeHtml(item.actionType)}</td></tr>
          <tr><th>?癒?????/th><td colspan="3">${escapeHtml(displayTarget(item))}</td></tr>
          <tr><th>?癒???/th><td colspan="3">${escapeHtml(displayInspectors(item))}</td></tr>
          <tr><th>?癒?野껉퀗??/th><td class="result-cell" colspan="3">${escapeHtml(item.resultText).replaceAll("\n", "<br>")}</td></tr>
          <tr><th>?온??甕곕베議?/th><td colspan="3">${laws.map(escapeHtml).join("<br>") || "-"}</td></tr>
        </table>
        <table>
          <tr><th>鈺곌퀣??????彛?/th></tr>
          <tr><td class="photo-cell">${photoHtml}</td></tr>
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
            <th>?癒????춳</th><th>?癒???깅뻻</th><th>?癒?????/th><th>?癒???/th>
            <th>?紐? ?癒????춳</th><th>鈺곌퀣???닌됲뀋</th><th>?癒?野껉퀗??/th><th>?온??甕곕베議?/th>
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
    setStatus(`${file.filename} ??쇱뒲嚥≪뮆諭띄몴???뽰삂??됰뮸??덈뼄.`);
  });
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function downloadSelectedInspections(type) {
  const items = filteredInspectionItems().filter((item) => state.selectedInspectionIds.has(item.id));
  if (!items.length) return setStatus("??쇱뒲嚥≪뮆諭???癒?野껉퀗?든몴??醫뤾문??뤾쉭??");
  const buttons = [$("#download-selected-doc"), $("#download-selected-excel")];
  buttons.forEach((button) => {
    button.disabled = true;
  });
  try {
    for (const item of items) {
      await downloadInspection(item, type);
      await delay(250);
    }
    setStatus(`?醫뤾문???癒?野껉퀗??${items.length}椰???쇱뒲嚥≪뮆諭띄몴???뽰삂??됰뮸??덈뼄.`);
  } finally {
    renderBulkDownloadState();
  }
}

async function deleteSelectedInspections() {
  const selectedIds = new Set(state.selectedInspectionIds);
  $$("#inspection-list [data-action=\"select-inspection\"]:checked").forEach((checkbox) => {
    selectedIds.add(checkbox.dataset.id);
  });
  const items = filteredInspectionItems().filter((item) => selectedIds.has(item.id));
  if (!items.length) return showAlert("\uC0AD\uC81C\uD560 \uC810\uAC80\uACB0\uACFC\uB97C \uC120\uD0DD\uD558\uC138\uC694.");
  if (!window.confirm("\uC815\uB9D0 \uC0AD\uC81C\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?")) return;
  const deletedBy = window.prompt("\uC0AD\uC81C\uC790 \uC774\uB984\uC744 \uC785\uB825\uD558\uC138\uC694.");
  if (!deletedBy || !deletedBy.trim()) return showAlert("\uC0AD\uC81C\uC790 \uC774\uB984\uC744 \uC785\uB825\uD574\uC57C \uC0AD\uC81C\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
  const button = $("#delete-selected");
  try {
    if (button) button.disabled = true;
    const ids = items.map((item) => item.id);
    const data = await api("/api/inspections/delete-bulk", {
      method: "POST",
      body: JSON.stringify({ ids, deletedBy: deletedBy.trim() })
    });
    state.inspections = data.inspections;
    state.trash = data.trash || [];
    state.stats = data.stats;
    for (const id of ids) state.selectedInspectionIds.delete(id);
    renderList();
    renderStats();
    renderTrash();
    setStatus(`\uC120\uD0DD\uD55C \uC810\uAC80\uACB0\uACFC ${ids.length}\uAC74\uC774 \uD734\uC9C0\uD1B5\uC73C\uB85C \uC774\uB3D9\uD588\uC2B5\uB2C8\uB2E4.`);
  } catch (error) {
    showAlert(error.message);
  } finally {
    renderBulkDownloadState();
  }
}

function activateView(viewId) {
  $$(".tab").forEach((item) => item.classList.toggle("is-active", item.dataset.view === viewId));
  $$(".view").forEach((view) => view.classList.toggle("is-active", view.id === viewId));
}

async function loadData() {
  const data = await api("/api/bootstrap");
  Object.assign(state, data);
  hydrateStoragePhotos();
  renderFormOptions();
  await loadLaws();
  renderList();
  renderStats();
}

function bindEvents() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => activateView(tab.dataset.view));
  });

  $("#result-sample").addEventListener("change", updateResultMode);

  $("#theme").addEventListener("change", loadLaws);
  $("#detailTheme").addEventListener("change", loadLaws);
  $("#targetOwner").addEventListener("change", () => renderTargetOptions());
  $("#filter-theme").addEventListener("change", renderList);
  $("#filter-detail-theme").addEventListener("change", renderList);
  $("#save-result-sample").addEventListener("click", async () => {
    const content = $("#new-result-content").value.trim();
    if (!content) return setStatus("?源낆쨯???癒?野껉퀗????곸뒠????낆젾??뤾쉭??");
    const duplicate = state.resultSamples.find((item) => item.content === content);
    if (duplicate) {
      state.visibleResultSampleIds.add(duplicate.id);
      renderFormOptions();
      $("#result-sample").value = duplicate.id;
      updateResultMode();
      return setStatus("??? ?源낆쨯???癒?野껉퀗?든몴??醫뤾문??됰뮸??덈뼄.");
    }
    const data = await api("/api/result-samples", {
      method: "POST",
      body: JSON.stringify({
        title: content.length > 28 ? `${content.slice(0, 28)}...` : content,
        content,
        actionType: $("#actionType").value
      })
    });
    state.resultSamples = data.resultSamples;
    state.visibleResultSampleIds.add(data.sample.id);
    renderFormOptions();
    $("#result-sample").value = data.sample.id;
    updateResultMode();
    setStatus("?癒?野껉퀗???怨쀬뵠?怨쀫퓠 ?源낆쨯??뤿???щ빍??");
  });
  $("#select-all-inspections").addEventListener("change", (event) => {
    const items = filteredInspectionItems();
    for (const item of items) {
      if (event.target.checked) {
        state.selectedInspectionIds.add(item.id);
      } else {
        state.selectedInspectionIds.delete(item.id);
      }
    }
    renderList();
  });
  $("#download-selected-doc").addEventListener("click", () => downloadSelectedInspections("doc"));
  $("#download-selected-excel").addEventListener("click", () => downloadSelectedInspections("excel"));
  $("#delete-selected").addEventListener("click", deleteSelectedInspections);
  const toggleTrash = $("#toggle-trash");
  if (toggleTrash) {
    toggleTrash.addEventListener("click", () => {
      state.trashVisible = !state.trashVisible;
      renderTrash();
    });
  }

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
  });
  $("#inspection-list").addEventListener("change", (event) => {
    const checkbox = event.target.closest('[data-action="select-inspection"]');
    if (!checkbox) return;
    if (checkbox.checked) {
      state.selectedInspectionIds.add(checkbox.dataset.id);
    } else {
      state.selectedInspectionIds.delete(checkbox.dataset.id);
    }
    renderBulkDownloadState();
  });

  $("#beforePhoto").addEventListener("change", (event) => readPhoto(event.target, "beforePhoto", $("#before-preview")));
  $("#add-detail-theme").addEventListener("click", async () => {
    const detailTheme = $("#new-detail-theme").value.trim();
    if (!detailTheme) return setStatus("??덉쨮???紐? ?癒????춳????낆젾??뤾쉭??");
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
    setStatus("?紐? ?癒????춳揶쎛 ?源낆쨯??뤿???щ빍??");
  });

  $("#add-contractor").addEventListener("click", async () => {
    const contractor = $("#new-contractor").value.trim();
    if (!contractor) return setStatus("?곕떽?????랁닋??녾퍥筌뤿굞????낆젾??뤾쉭??");
    const data = await api("/api/contractors", {
      method: "POST",
      body: JSON.stringify({ contractor })
    });
    state.contractors = data.contractors;
    $("#new-contractor").value = "";
    $("#targetOwner").value = "??랁닋??녾퍥(?⑤벊沅??녾퍥 ??釉?";
    renderTargetOptions(contractor);
    setStatus("??랁닋??녾퍥揶쎛 ?源낆쨯??뤿???щ빍??");
  });

  $("#add-inspector").addEventListener("click", async () => {
    const inspector = $("#new-inspector").value.trim();
    if (!inspector) return setStatus("?곕떽????紐꾩뜚????낆젾??뤾쉭??");
    const data = await api("/api/inspectors", {
      method: "POST",
      body: JSON.stringify({ inspector })
    });
    state.inspectors = data.inspectors;
    $("#new-inspector").value = "";
    renderInspectors();
    const added = $(`input[name="inspectors"][value="${CSS.escape(inspector)}"]`);
    if (added) added.checked = true;
    setStatus("?癒??癒? ?源낆쨯??뤿???щ빍??");
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
    setStatus("?癒??癒? ?????뤿???щ빍??");
  });

  $("#inspection-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const inspectors = getSelectedInspectors();
    if (!inspectors.length) return showAlert("?癒??癒? ??筌???곴맒 ?醫뤾문??뤾쉭??");
    const sample = selectedResultSample();
    const directText = $("#new-result-content").value.trim();
    if (!sample && !directText) return showAlert("?癒?野껉퀗?든몴??臾믨쉐??띻탢???源낆쨯???癒?野껉퀗?든몴??醫뤾문??뤾쉭??");
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
      actionType: sample?.actionType || $("#actionType").value,
      beforePhoto: state.photos.beforePhoto
    };
    if (payload.beforePhoto) Object.assign(payload, await uploadPhotoToStorage(payload.beforePhoto));
    const data = await api("/api/inspections", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.inspections = data.inspections;
    state.stats = data.stats;
    state.themes = [...new Set([...state.themes, payload.theme])];
    renderFormOptions();
    $("#filter-theme").value = "?袁⑷퍥";
    $("#filter-detail-theme").value = "?袁⑷퍥 ?紐????춳";
    renderList();
    renderStats();
    event.target.reset();
    updateResultMode();
    $("#inspectedAt").value = todayLocalDateTime();
    $("#before-preview").removeAttribute("src");
    state.photos.beforePhoto = "";
    state.currentLaws = [];
    renderTargetOptions();
    renderThemeLaws();
    showAlert("?癒?野껉퀗?????關?욜뙴?");
    window.setTimeout(() => {
      activateView("list");
      renderList();
      $("#list").scrollIntoView({ behavior: "smooth", block: "start" });
    }, 700);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  $("#inspectedAt").value = todayLocalDateTime();
  bindEvents();
  try {
    await initPhotoStorage();
    await loadData();
  } catch (error) {
    setStatus(error.message);
  }
});

function normalizeActionType(actionType) {
  if (["A \uC870\uCE58", "\uAD50\uC721", "\uC810\uAC80\uC644\uB8CC", "\uC989\uC2DC\uC870\uCE58\uC644\uB8CC"].includes(actionType)) return "\uC989\uC2DC\uC870\uCE58\uC644\uB8CC";
  if (["B \uC870\uCE58", "C \uC870\uCE58", "\uC870\uCE58\uD544\uC694"].includes(actionType)) return "\uC870\uCE58\uD544\uC694";
  return actionType || "\uC870\uCE58\uD544\uC694";
}

function updateResultMode() {
  const sample = selectedResultSample();
  const isDirect = !sample;
  if (sample) $("#actionType").value = normalizeActionType(sample.actionType);
  $("#actionType").disabled = !isDirect;
  $("#new-result-content").disabled = !isDirect;
  $("#new-result-content").placeholder = isDirect
    ? "\uC0C8\uB85C\uC6B4 \uC810\uAC80\uACB0\uACFC \uC791\uC131 \uBC0F \uB4F1\uB85D"
    : "\uB4F1\uB85D\uB41C \uC810\uAC80\uACB0\uACFC\uB97C \uC120\uD0DD\uD588\uC2B5\uB2C8\uB2E4.";
}
