// -----------------------------
// CONFIG: Map your CSV headers here (adjust if needed)
// -----------------------------
const COL = {
  region: "Region",
  productCode: "Product code",
  productDesc: "Product Description",
  protocol: "Protocol Term",
  cooking: "Cooking Method",
  cookingTime: "Time (mm:ss)",          // <-- NEW: adjust to your exact header if different
  testSample: "TestSample_ID",
  studyName: "Study name",
  studyId: "Study ID",
  testName: "Test Name",
  testStartDate: "Test start date",
  testId: "Test ID",
  question: "Question Description",
  value: "CLT Average Response",        // numeric
};

// -----------------------------
let RAW = [];
let barChart = null;
let radarChart = null;
let DATE_VALUES = [];
let dateFilterActive = false;
let isUpdatingFilters = false;
let lastPivotCsv = null;

// -----------------------------
const els = {
  status: document.getElementById("status"),
  csv: document.getElementById("csvFile"),
  clearAllBtn: document.getElementById("clearAllBtn"),

  f_question: document.getElementById("f_question"),
  f_region: document.getElementById("f_region"),
  f_product_code: document.getElementById("f_product_code"),
  f_product_desc: document.getElementById("f_product_desc"),
  f_protocol: document.getElementById("f_protocol"),
  f_cooking: document.getElementById("f_cooking"),
  f_testsample: document.getElementById("f_testsample"),
  f_study_name: document.getElementById("f_study_name"),
  f_study_id: document.getElementById("f_study_id"),
  f_test_name: document.getElementById("f_test_name"),
  f_test_date: document.getElementById("f_test_date"),
  f_test_date_label: document.getElementById("f_test_date_label"),
  f_test_id: document.getElementById("f_test_id"),

  kpiLine: document.getElementById("kpiLine"),
  pivotWrap: document.getElementById("pivotWrap"),
  legendTip: document.getElementById("legendTip"),
  exportPivotBtn: document.getElementById("exportPivotBtn"),
};

// -----------------------------
function setStatus(msg) { els.status.textContent = msg; }

function safeGet(row, col) {
  return row && Object.prototype.hasOwnProperty.call(row, col) ? row[col] : undefined;
}

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function normalizeHeader(s) {
  return String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function resolveCol(headers, candidates) {
  const map = new Map(headers.map(h => [normalizeHeader(h), h]));
  for (const c of candidates) {
    const key = normalizeHeader(c);
    if (map.has(key)) return map.get(key);
  }
  return null;
}

function resolveColumns(headers) {
  const candidates = {
    region: [COL.region],
    productCode: [COL.productCode],
    productDesc: [COL.productDesc],
    protocol: [COL.protocol],
    cooking: [COL.cooking, "Cooking method", "Cooking m"],
    cookingTime: [COL.cookingTime, "Time (mm:ss)"],
    testSample: [COL.testSample],
    studyName: [COL.studyName],
    studyId: [COL.studyId],
    testName: [COL.testName],
    testStartDate: [COL.testStartDate, "Test Start Date"],
    testId: [COL.testId],
    question: [COL.question],
    value: [COL.value]
  };

  for (const [key, list] of Object.entries(candidates)) {
    const resolved = resolveCol(headers, list);
    if (resolved) {
      COL[key] = resolved;
    } else {
      console.warn(`Column not found for "${key}". Tried: ${list.join(", ")}`);
    }
  }
}

function uniqueValues(data, col) {
  const s = new Set();
  for (const r of data) {
    const v = safeGet(r, col);
    if (v !== undefined && v !== null && String(v).trim() !== "") s.add(String(v));
  }
  return Array.from(s).sort((a,b)=>a.localeCompare(b, undefined, {numeric:true, sensitivity:"base"}));
}

function uniqueDates(data, col) {
  const s = new Set();
  for (const r of data) {
    const v = safeGet(r, col);
    if (v !== undefined && v !== null && String(v).trim() !== "") s.add(String(v));
  }
  return Array.from(s).sort((a, b) => {
    const da = Date.parse(a);
    const db = Date.parse(b);
    if (Number.isFinite(da) && Number.isFinite(db)) return da - db;
    return String(a).localeCompare(String(b), undefined, {numeric:true, sensitivity:"base"});
  });
}

function setMultiSelectOptions(selectEl, values, selectedValues = []) {
  const selected = new Set(selectedValues);
  selectEl.innerHTML = "";
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    opt.selected = selected.has(v);
    selectEl.appendChild(opt);
  }
}

// Multi-select: selected values; if none selected -> treat as "All"
function getSelected(selectEl) {
  return Array.from(selectEl.selectedOptions).map(o => o.value).filter(Boolean);
}

function clearMultiSelect(selectEl) {
  Array.from(selectEl.options).forEach(o => o.selected = false);
}

function updateDateLabel() {
  if (!els.f_test_date_label) return;
  if (!DATE_VALUES.length || !dateFilterActive) {
    els.f_test_date_label.textContent = "All";
    return;
  }
  const idx = Number(els.f_test_date.value);
  els.f_test_date_label.textContent = DATE_VALUES[idx] || "All";
}

function getDateFilterValue() {
  if (!dateFilterActive || !DATE_VALUES.length) return null;
  const idx = Number(els.f_test_date.value);
  return DATE_VALUES[idx] || null;
}

function setDateSliderValues(values, selectedValue) {
  DATE_VALUES = values;
  const max = Math.max(values.length - 1, 0);
  els.f_test_date.min = 0;
  els.f_test_date.max = max;
  els.f_test_date.disabled = values.length === 0;

  if (selectedValue && values.includes(selectedValue)) {
    els.f_test_date.value = values.indexOf(selectedValue);
    dateFilterActive = true;
  } else {
    els.f_test_date.value = 0;
    dateFilterActive = false;
  }
  updateDateLabel();
}

// Returns first selected question (or "" if none)
function getPrimaryQuestion() {
  const qs = getSelected(els.f_question);
  return qs.length ? qs[0] : "";
}

// -----------------------------
// FILTERS (all are multi-select; empty means ALL)
// -----------------------------
function getFilterState() {
  return {
    question: getSelected(els.f_question),
    region: getSelected(els.f_region),
    studyName: getSelected(els.f_study_name),
    studyId: getSelected(els.f_study_id),
    testName: getSelected(els.f_test_name),
    testId: getSelected(els.f_test_id),
    testStartDate: getDateFilterValue(),
    protocol: getSelected(els.f_protocol),
    cooking: getSelected(els.f_cooking),
    productDesc: getSelected(els.f_product_desc),
    productCode: getSelected(els.f_product_code),
    testSample: getSelected(els.f_testsample),
  };
}

function applyFiltersWithState(data, f, excludeKey = "") {
  return data.filter(r => {
    const inList = (list, col, key) => {
      if (excludeKey === key) return true;
      if (!list.length) return true;
      const cell = safeGet(r, col);
      return cell !== undefined && list.includes(String(cell));
    };

    const inValue = (value, col, key) => {
      if (excludeKey === key) return true;
      if (!value) return true;
      const cell = safeGet(r, col);
      return cell !== undefined && String(cell) === String(value);
    };

    return (
      inList(f.question, COL.question, "question") &&
      inList(f.region, COL.region, "region") &&
      inList(f.studyName, COL.studyName, "studyName") &&
      inList(f.studyId, COL.studyId, "studyId") &&
      inList(f.testName, COL.testName, "testName") &&
      inList(f.testId, COL.testId, "testId") &&
      inValue(f.testStartDate, COL.testStartDate, "testStartDate") &&
      inList(f.protocol, COL.protocol, "protocol") &&
      inList(f.cooking, COL.cooking, "cooking") &&
      inList(f.productDesc, COL.productDesc, "productDesc") &&
      inList(f.productCode, COL.productCode, "productCode") &&
      inList(f.testSample, COL.testSample, "testSample")
    );
  });
}

function applyFilters(data) {
  return applyFiltersWithState(data, getFilterState());
}

function updateDependentFilters() {
  if (!RAW.length) return;
  isUpdatingFilters = true;

  const f = getFilterState();

  const updateSelect = (key, col, el) => {
    const filtered = applyFiltersWithState(RAW, f, key);
    const values = uniqueValues(filtered, col);
    const selected = getSelected(el);
    setMultiSelectOptions(el, values, selected.filter(v => values.includes(v)));
  };

  updateSelect("question", COL.question, els.f_question);
  updateSelect("region", COL.region, els.f_region);
  updateSelect("studyName", COL.studyName, els.f_study_name);
  updateSelect("studyId", COL.studyId, els.f_study_id);
  updateSelect("testName", COL.testName, els.f_test_name);
  updateSelect("testId", COL.testId, els.f_test_id);
  updateSelect("protocol", COL.protocol, els.f_protocol);
  updateSelect("cooking", COL.cooking, els.f_cooking);
  updateSelect("productDesc", COL.productDesc, els.f_product_desc);
  updateSelect("productCode", COL.productCode, els.f_product_code);
  updateSelect("testSample", COL.testSample, els.f_testsample);

  const dateFiltered = applyFiltersWithState(RAW, f, "testStartDate");
  const dateValues = uniqueDates(dateFiltered, COL.testStartDate);
  setDateSliderValues(dateValues, f.testStartDate);

  isUpdatingFilters = false;
}

// -----------------------------
// Update pipeline
// -----------------------------
function updateAll() {
  if (!RAW.length) return;

  const filtered = applyFilters(RAW);

  // KPI + Pivot use first selected question (if none, show notice)
  const primaryQ = getPrimaryQuestion();
  renderKPI(filtered, primaryQ);

  // Charts: use selected questions if any, else top 12
  const selectedQuestions = getSelected(els.f_question);
  renderRadarByTestSample(filtered, selectedQuestions);
  renderBarByTestSample(filtered, selectedQuestions);

  // Pivot
  renderPivot(filtered, selectedQuestions);
}

// -----------------------------
// KPI
// -----------------------------
function renderKPI(data, primaryQ) {
  if (!primaryQ) {
    els.kpiLine.textContent = 'Select at least 1 "Question Description" (KPI + Pivot use the FIRST selected).';
    return;
  }

  const subset = data.filter(r => String(safeGet(r, COL.question) || "") === String(primaryQ));
  const nums = subset.map(r => toNumber(safeGet(r, COL.value))).filter(v => v != null);

  if (!nums.length) {
    els.kpiLine.textContent = `No numeric values for KPI question: "${primaryQ}" after filters.`;
    return;
  }

  const avg = nums.reduce((a,b)=>a+b,0) / nums.length;
  els.kpiLine.textContent = `KPI "${primaryQ}" = ${avg.toFixed(2)} (from ${nums.length} row(s) after filters)`;
}

// -----------------------------
// Choose question axes: selectedQuestions (if any) else top 12 by overall avg
// -----------------------------
function pickQuestionAxes(data, selectedQuestions, maxAxes = 12) {
  if (selectedQuestions && selectedQuestions.length) {
    // keep selected order but cap max
    return selectedQuestions.slice(0, maxAxes);
  }

  const qAgg = new Map(); // q -> {sum,n}
  for (const r of data) {
    const q = safeGet(r, COL.question);
    const v = toNumber(safeGet(r, COL.value));
    if (!q || v == null) continue;
    if (!qAgg.has(q)) qAgg.set(q, {sum:0, n:0});
    const o = qAgg.get(q);
    o.sum += v; o.n += 1;
  }

  return Array.from(qAgg.entries())
    .map(([q,o]) => ({ q, v: o.n ? (o.sum/o.n) : null }))
    .filter(x => x.v != null)
    .sort((a,b)=>b.v-a.v)
    .slice(0, maxAxes)
    .map(x => x.q);
}

// -----------------------------
// Datasets by TestSample_ID (legend = TestSample_ID)
// -----------------------------
function buildDatasetsBySample(data, questions, maxSamples = 8) {
  // Determine which samples to include: selected in slicer, otherwise top by frequency
  const selectedSamples = getSelected(els.f_testsample);
  let samples = selectedSamples;

  if (!samples.length) {
    const freq = new Map();
    for (const r of data) {
      const sid = safeGet(r, COL.testSample);
      if (!sid) continue;
      freq.set(String(sid), (freq.get(String(sid)) || 0) + 1);
    }
    samples = Array.from(freq.entries())
      .sort((a,b)=>b[1]-a[1])
      .slice(0, maxSamples)
      .map(x => x[0]);
  } else {
    samples = samples.slice(0, maxSamples);
  }

  const metaMap = new Map();
  for (const r of data) {
    const sid = String(safeGet(r, COL.testSample) ?? "");
    if (!sid) continue;
    if (!metaMap.has(sid)) {
      metaMap.set(sid, {
        testNames: new Set(),
        productDescs: new Set(),
        protocols: new Set()
      });
    }
    const meta = metaMap.get(sid);
    const testName = safeGet(r, COL.testName);
    const productDesc = safeGet(r, COL.productDesc);
    const protocol = safeGet(r, COL.protocol);
    if (testName) meta.testNames.add(String(testName));
    if (productDesc) meta.productDescs.add(String(productDesc));
    if (protocol) meta.protocols.add(String(protocol));
  }

  const datasets = samples.map(sid => {
    const map = new Map(); // q -> {sum,n}

    for (const r of data) {
      const sampleId = String(safeGet(r, COL.testSample) ?? "");
      if (sampleId !== String(sid)) continue;

      const q = safeGet(r, COL.question);
      const v = toNumber(safeGet(r, COL.value));
      if (!q || v == null) continue;

      if (!map.has(q)) map.set(q, {sum:0, n:0});
      const o = map.get(q);
      o.sum += v; o.n += 1;
    }

    const values = questions.map(q => {
      const o = map.get(q);
      return o && o.n ? (o.sum/o.n) : null;
    });

    const meta = metaMap.get(String(sid)) || {
      testNames: new Set(),
      productDescs: new Set(),
      protocols: new Set()
    };
    const pickFirst = (set) => Array.from(set).sort((a,b)=>a.localeCompare(b)).find(Boolean) || "";
    const legendDetail = [
      pickFirst(meta.testNames) || "N/A",
      pickFirst(meta.productDescs) || "N/A",
      pickFirst(meta.protocols) || "N/A"
    ].join("_");

    return {
      label: `TestSample_ID: ${sid}`,
      data: values,
      spanGaps: true,
      legendDetail
    };
  });

  return datasets;
}

// -----------------------------
// Radar by TestSample_ID
// -----------------------------
function renderRadarByTestSample(data, selectedQuestions) {
  const questions = pickQuestionAxes(data, selectedQuestions, 12);
  if (!questions.length) {
    if (radarChart) { radarChart.destroy(); radarChart = null; }
    return;
  }

  const datasets = buildDatasetsBySample(data, questions, 8);
  if (!datasets.length) {
    if (radarChart) { radarChart.destroy(); radarChart = null; }
    return;
  }

  const ctx = document.getElementById("radarChart").getContext("2d");
  if (!radarChart) {
    radarChart = new Chart(ctx, {
      type: "radar",
      data: { labels: questions, datasets },
      options: {
        responsive: true,
        animation: false,
        plugins: {
          legend: {
            display: true,
            onHover: (evt, item, legend) => showLegendTip(evt, legend, item),
            onLeave: () => hideLegendTip()
          }
        },
        scales: { r: { beginAtZero: true } }
      }
    });
  } else {
    radarChart.data.labels = questions;
    radarChart.data.datasets = datasets;
    radarChart.update();
  }
}

// -----------------------------
// Bar by TestSample_ID (grouped bars per question, legend = sample)
// -----------------------------
function renderBarByTestSample(data, selectedQuestions) {
  const questions = pickQuestionAxes(data, selectedQuestions, 12);
  if (!questions.length) {
    if (barChart) { barChart.destroy(); barChart = null; }
    return;
  }

  const datasets = buildDatasetsBySample(data, questions, 8);
  if (!datasets.length) {
    if (barChart) { barChart.destroy(); barChart = null; }
    return;
  }

  const ctx = document.getElementById("barChart").getContext("2d");
  if (!barChart) {
    barChart = new Chart(ctx, {
      type: "bar",
      data: { labels: questions, datasets },
      options: {
        responsive: true,
        animation: false,
        plugins: {
          legend: {
            display: true,
            onHover: (evt, item, legend) => showLegendTip(evt, legend, item),
            onLeave: () => hideLegendTip()
          }
        },
        scales: {
          x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 0 } },
          y: { beginAtZero: true }
        }
      }
    });
  } else {
    barChart.data.labels = questions;
    barChart.data.datasets = datasets;
    barChart.update();
  }
}

// -----------------------------
// Pivot table (selected question only)
// Rows: Region / Test (Name or ID) / ProductCode / ProductDesc / CookingTime
// Cols: Protocol Term
// Values: Avg Response
// -----------------------------
function renderPivot(data, selectedQuestions) {
  const subset = data;
  const questionList = (selectedQuestions && selectedQuestions.length)
    ? selectedQuestions
    : uniqueValues(subset, COL.question);
  const protocolList = uniqueValues(subset, COL.protocol);

  if (!questionList.length) {
    els.pivotWrap.innerHTML = `<div class="muted">No Question Description values after filters.</div>`;
    lastPivotCsv = null;
    return;
  }

  if (!protocolList.length) {
    els.pivotWrap.innerHTML = `<div class="muted">No Protocol Term values after filters.</div>`;
    lastPivotCsv = null;
    return;
  }

  const groups = new Map();

  function groupKey(r) {
    const region = String(safeGet(r, COL.region) ?? "");
    const testName = String(safeGet(r, COL.testName) ?? "");
    const testId = String(safeGet(r, COL.testId) ?? "");
    const test = testName || testId;

    const pc = String(safeGet(r, COL.productCode) ?? "");
    const pd = String(safeGet(r, COL.productDesc) ?? "");
    const ct = String(safeGet(r, COL.cookingTime) ?? ""); // new

    return `${region}||${test}||${pc}||${pd}||${ct}`;
  }

  for (const r of subset) {
    const v = toNumber(safeGet(r, COL.value));
    const q = String(safeGet(r, COL.question) ?? "");
    const p = String(safeGet(r, COL.protocol) ?? "");
    if (v == null || !p || !q) continue;
    if (questionList.length && !questionList.includes(q)) continue;

    const key = groupKey(r);
    if (!groups.has(key)) {
      const [region, test, pc, pd, ct] = key.split("||");
      groups.set(key, {
        region, test, pc, pd, ct,
        cells: new Map() // question -> Map(protocol -> {sum,n})
      });
    }
    const g = groups.get(key);
    if (!g.cells.has(q)) g.cells.set(q, new Map());
    const qMap = g.cells.get(q);
    if (!qMap.has(p)) qMap.set(p, {sum:0, n:0});
    const cell = qMap.get(p);
    cell.sum += v;
    cell.n += 1;
  }

  const rows = Array.from(groups.values());
  const csvHeaders = [
    "Region",
    "Test (Name/ID)",
    "Product Code",
    "Product Description",
    "Cooking Time"
  ];
  const csvMetricHeaders = [];
  for (const p of protocolList) {
    for (const q of questionList) {
      csvMetricHeaders.push(`${p} - ${q}`);
    }
  }

  let html = `<table>
    <thead>
      <tr>
        <th rowspan="2">Region</th>
        <th rowspan="2">Test (Name/ID)</th>
        <th rowspan="2">Product Code</th>
        <th rowspan="2">Product Description</th>
        <th rowspan="2">Cooking Time</th>
        ${protocolList.map(p => `<th colspan="${questionList.length}">${escapeHtml(p)}</th>`).join("")}
      </tr>
      <tr>
        ${protocolList.map(() => questionList.map(q => `<th>${escapeHtml(q)}</th>`).join("")).join("")}
      </tr>
    </thead>
    <tbody>`;

  for (const r of rows) {
    html += `<tr>
      <td>${escapeHtml(r.region)}</td>
      <td>${escapeHtml(r.test)}</td>
      <td>${escapeHtml(r.pc)}</td>
      <td>${escapeHtml(r.pd)}</td>
      <td>${escapeHtml(r.ct)}</td>`;

    for (const p of protocolList) {
      for (const q of questionList) {
        const qMap = r.cells.get(q);
        const c = qMap ? qMap.get(p) : null;
        const val = c && c.n ? (c.sum/c.n) : "";
        html += `<td style="text-align:right;">${val === "" ? "" : Number(val).toFixed(2)}</td>`;
      }
    }

    html += `</tr>`;
  }

  html += `</tbody></table>`;
  els.pivotWrap.innerHTML = html;

  const csvRows = rows.map(r => {
    const out = [r.region, r.test, r.pc, r.pd, r.ct];
    for (const p of protocolList) {
      for (const q of questionList) {
        const qMap = r.cells.get(q);
        const c = qMap ? qMap.get(p) : null;
        const val = c && c.n ? (c.sum / c.n) : "";
        out.push(val === "" ? "" : Number(val).toFixed(2));
      }
    }
    return out;
  });

  lastPivotCsv = {
    headers: csvHeaders.concat(csvMetricHeaders),
    rows: csvRows
  };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, "\"\"")}"`;
  }
  return s;
}

function buildCsv(headers, rows) {
  const lines = [];
  lines.push(headers.map(csvEscape).join(","));
  for (const r of rows) {
    lines.push(r.map(csvEscape).join(","));
  }
  return lines.join("\r\n");
}

function downloadCsv(filename, headers, rows) {
  const csv = buildCsv(headers, rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function showLegendTip(evt, legend, item) {
  const ds = legend.chart.data.datasets[item.datasetIndex];
  const text = ds && ds.legendDetail ? ds.legendDetail : "";
  if (!text || !els.legendTip) {
    hideLegendTip();
    return;
  }

  const rect = legend.chart.canvas.getBoundingClientRect();
  let x;
  let y;

  if (evt && evt.native && typeof evt.native.clientX === "number") {
    x = evt.native.clientX;
    y = evt.native.clientY;
  } else if (evt && typeof evt.x === "number" && typeof evt.y === "number") {
    x = rect.left + evt.x;
    y = rect.top + evt.y;
  } else {
    hideLegendTip();
    return;
  }

  els.legendTip.textContent = text;
  els.legendTip.style.display = "block";
  els.legendTip.style.left = `${x + 12}px`;
  els.legendTip.style.top = `${y + 12}px`;
}

function hideLegendTip() {
  if (!els.legendTip) return;
  els.legendTip.style.display = "none";
}

function handleFilterChange() {
  if (isUpdatingFilters) return;
  updateDependentFilters();
  updateAll();
}

// -----------------------------
// Clear all filters (reset to default)
// - Clears all selections
// - Question defaults to "All" (no selection)
// -----------------------------
function clearAllFiltersToDefault() {
  [
    els.f_question, els.f_region, els.f_product_code, els.f_product_desc, els.f_protocol,
    els.f_cooking, els.f_testsample, els.f_study_name, els.f_study_id,
    els.f_test_name, els.f_test_id
  ].forEach(clearMultiSelect);

  dateFilterActive = false;
  setDateSliderValues(DATE_VALUES, null);

  updateDependentFilters();
  updateAll();
}

els.clearAllBtn.addEventListener("click", () => clearAllFiltersToDefault());
els.exportPivotBtn.addEventListener("click", () => {
  if (!lastPivotCsv || !lastPivotCsv.rows.length) {
    setStatus("No pivot data to export.");
    return;
  }
  downloadCsv("pivot-table.csv", lastPivotCsv.headers, lastPivotCsv.rows);
});

// -----------------------------
// Load CSV
// -----------------------------
els.csv.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  setStatus(`Reading: ${file.name} ...`);

  Papa.parse(file, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    complete: (results) => {
      RAW = (results.data || []).filter(row => row && Object.keys(row).some(k => row[k] !== null && row[k] !== ""));
      if (!RAW.length) {
        setStatus("No rows found. Is the CSV empty?");
        return;
      }

      resolveColumns(RAW[0] ? Object.keys(RAW[0]) : []);

      // Populate dropdowns (multi-select)
      setMultiSelectOptions(els.f_question, uniqueValues(RAW, COL.question));
      setMultiSelectOptions(els.f_region, uniqueValues(RAW, COL.region));
      setMultiSelectOptions(els.f_study_name, uniqueValues(RAW, COL.studyName));
      setMultiSelectOptions(els.f_study_id, uniqueValues(RAW, COL.studyId));
      setMultiSelectOptions(els.f_test_name, uniqueValues(RAW, COL.testName));
      setMultiSelectOptions(els.f_test_id, uniqueValues(RAW, COL.testId));
      setMultiSelectOptions(els.f_protocol, uniqueValues(RAW, COL.protocol));
      setMultiSelectOptions(els.f_cooking, uniqueValues(RAW, COL.cooking));
      setMultiSelectOptions(els.f_product_desc, uniqueValues(RAW, COL.productDesc));
      setMultiSelectOptions(els.f_product_code, uniqueValues(RAW, COL.productCode));
      setMultiSelectOptions(els.f_testsample, uniqueValues(RAW, COL.testSample));

      setDateSliderValues(uniqueDates(RAW, COL.testStartDate), null);

      // Attach change listeners once (safe even if repeated; minimal risk)
      [
        els.f_question, els.f_region, els.f_product_code, els.f_product_desc, els.f_protocol,
        els.f_cooking, els.f_testsample, els.f_study_name, els.f_study_id,
        els.f_test_name, els.f_test_id
      ].forEach(el => el.addEventListener("change", handleFilterChange));

      els.f_test_date.addEventListener("input", () => {
        dateFilterActive = true;
        updateDateLabel();
        handleFilterChange();
      });

      // Apply default selection & render
      setStatus(`Loaded ${RAW.length} rows. Multi-select filters on the left. (No selection = All)`);
      clearAllFiltersToDefault();

      // Helpful: show headers if something doesn't map
      console.log("CSV headers:", RAW[0] ? Object.keys(RAW[0]) : []);
    },
    error: (err) => {
      console.error(err);
      setStatus("Parse error. Check console.");
    }
  });
});
