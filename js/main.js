import { state } from "./state.js";

const paths = {
  t12: "data/table1.2.csv",
  t13: "data/table1.3.csv",
  t19: "data/table1.9.csv",
  geo: "data/zupanije_GeoJson.json",
};

const ui = {
  year: document.getElementById("yearSelect"),
  month: document.getElementById("monthSelect"),
  metric: document.getElementById("metricSelect"),
  reset: document.getElementById("resetBtn"),
};

function parseNumber(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "" || s === "-" || s.toLowerCase() === "z") return null;
  // EU format fallback (if any): "1.234,56" -> "1234.56"
  const normalized = s.replace(/\./g, "").replace(",", ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function parseTable12(row) {
  // probaj pogoditi kolone bez da pucamo ako se razlikuju:
  // prilagodi nakon što vidiš headere
  return { ...row };
}

async function loadAll() {
  const [t12, t13, t19, geo] = await Promise.all([
    d3.csv(paths.t12),
    d3.csv(paths.t13),
    d3.csv(paths.t19),
    d3.json(paths.geo),
  ]);

  return { t12, t13, t19, geo };
}

function initControls({ t12 }) {
  // Izvuci godine/mjesece iz table1.2 (najlakse)
  // Ako table1.2 nema year/month kao kolone, prilagodit cemo nakon.
  const years = Array.from(new Set(t12.map(d => d.Year || d.year).filter(Boolean))).sort();
  const months = Array.from(new Set(t12.map(d => d.Month || d.month).filter(Boolean)));

  // fallback ako nema:
  if (years.length === 0) {
    // Ako nema Year, ručno postavi (ili izvuci iz headera kasnije)
    console.warn("Year column not found in table1.2 - adjust parser.");
  }

  ui.year.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");
  ui.month.innerHTML = months.map(m => `<option value="${m}">${m}</option>`).join("");

  state.year = years.at(-1) ?? null;
  state.month = months.at(0) ?? null;

  ui.year.value = state.year ?? "";
  ui.month.value = state.month ?? "";
  ui.metric.value = state.metric;

  ui.year.addEventListener("change", () => { state.year = ui.year.value; updateAll(); });
  ui.month.addEventListener("change", () => { state.month = ui.month.value; updateAll(); });
  ui.metric.addEventListener("change", () => { state.metric = ui.metric.value; updateAll(); });
  ui.reset.addEventListener("click", () => { state.county = null; updateAll(); });
}

let DATA = null;

function updateAll() {
  // TODO: ovdje zoves updateMap / updateLine / updateBars / updateScatter
  console.log("updateAll", structuredClone(state));
}

(async function main() {
  DATA = await loadAll();
  initControls(DATA);
  updateAll();
})();