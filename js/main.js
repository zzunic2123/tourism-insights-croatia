import { state, setState, subscribe } from "./state.js";
import { MONTHS } from "./utils.js";

import { createMapChart } from "./charts/map.js";
import { createLineChart } from "./charts/line.js";
import { createBarsChart } from "./charts/bars.js";
import { createScatterChart } from "./charts/scatter.js";

const PATH = "data/normalized/";

const ui = {
  yearSelect: document.getElementById("yearSelect"),
  monthRange: document.getElementById("monthRange"),
  monthLabel: document.getElementById("monthLabel"),
  metricSelect: document.getElementById("metricSelect"),
  resetBtn: document.getElementById("resetBtn"),
};

const tooltipEl = document.getElementById("tooltip");

const mapSvg = d3.select("#mapSvg");
const lineSvg = d3.select("#lineSvg");
const barSvg = d3.select("#barSvg");
const scatterSvg = d3.select("#scatterSvg");

const mapLegendEl = document.getElementById("mapLegend");
const barEmptyEl = document.getElementById("barEmpty");


// Charts
const mapChart = createMapChart({ svg: mapSvg, legendEl: mapLegendEl, tooltipEl });
const lineChart = createLineChart({ svg: lineSvg, tooltipEl });
const barsChart = createBarsChart({ svg: barSvg, tooltipEl, emptyEl: barEmptyEl });
const scatterChart = createScatterChart({ svg: scatterSvg, tooltipEl });

let DATA = null;

// Precomputed indexes (fast updates)
let countyMonthIndex = null;
let townToCounty = new Map(); // spatial_unit -> county_key

function ymKey(y,m){ return `${y}-${String(m).padStart(2,"0")}`; }

function normalizeCountyKey(raw) {
  if (raw == null) return null;

  let k = String(raw)
    .toLowerCase()
    .replace(/\ufeff/g, "")
    .trim()
    .replace(/-/g, " ")
    .replace(/\s+/g, " ");

  // makni moguce sufikse
  k = k.replace(/\s+zupanija$/i, "").trim();

  // REMAP za problematicne zapise iz normalized.zip
  const remap = new Map([
    ["istria", "istarska"],
    ["slavonski brod posavina", "brodsko posavska"],
    ["vukovar sirmium", "vukovarsko srijemska"],
  ]);

  return remap.get(k) ?? k;
}


async function loadData() {
  const [geo, countyTotalsRaw, hrWideRaw, originLongRaw, intensityLongRaw, meta] = await Promise.all([
    d3.json(PATH + "zupanije_simplified.geojson"),
    d3.csv(PATH + "tourism_counties_monthly_total.csv", d3.autoType),
    d3.csv(PATH + "tourism_hr_monthly_wide.csv", d3.autoType),
    d3.csv(PATH + "tourism_origin_long.csv", d3.autoType),
    d3.csv(PATH + "tourism_intensity_long.csv", d3.autoType),
    d3.json(PATH + "meta.json"),
  ]);

  // ---- helperi za pronalazak kolona (radi i ako imaju BOM / razmake) ----
  const cleanKey = (k) => k.replace(/\ufeff/g, "").trim();
  const findCol = (obj, wanted) =>
    Object.keys(obj).find(k => cleanKey(k) === wanted);

  function normalizeCountyTotals(rows) {
    if (!rows.length) return rows;

    const kCounty = findCol(rows[0], "county_key");
    const kYear   = findCol(rows[0], "year");
    const kMonth  = findCol(rows[0], "month");
    const kArr    = findCol(rows[0], "arrivals");
    const kNig    = findCol(rows[0], "nights");

    return rows.map(r => ({
      county_key: normalizeCountyKey(r[kCounty]),
      year: +r[kYear],
      month: +r[kMonth],
      arrivals: r[kArr] == null ? null : +r[kArr],
      nights: r[kNig] == null ? null : +r[kNig]
    }));
  }

  function normalizeOriginLong(rows) {
    if (!rows.length) return rows;

    const kCounty = findCol(rows[0], "county_key");
    const kYear   = findCol(rows[0], "year");
    const kMonth  = findCol(rows[0], "month");
    const kCountry= findCol(rows[0], "origin_country");
    const kArr    = findCol(rows[0], "arrivals");
    const kNig    = findCol(rows[0], "nights");

    return rows.map(r => ({
    county_key: normalizeCountyKey(r[kCounty]),
      year: +r[kYear],
      month: +r[kMonth],
      origin_country: String(r[kCountry]).trim(),
      arrivals: r[kArr] == null ? null : +r[kArr],
      nights: r[kNig] == null ? null : +r[kNig],
    }));
  }

  const countyTotals = normalizeCountyTotals(countyTotalsRaw);
  const originLong = normalizeOriginLong(originLongRaw);
  const hrWide = hrWideRaw;
  const intensityLong = intensityLongRaw;


  for (const r of intensityLongRaw) {
    // uzimamo samo gradove/opcine (ne agregate)
    if (r.spatial_level !== "municipality") continue;

    const town = String(r.spatial_unit ?? "").trim();
    const county = String(r.county_key ?? "").trim();

    if (!town || !county) continue;

    // ako se isti town pojavi vise puta s drugacijim county -> log warning
    if (townToCounty.has(town) && townToCounty.get(town) !== county) {
      console.warn(`[townToCounty] collision: "${town}" -> "${townToCounty.get(town)}" vs "${county}"`);
    } else {
      townToCounty.set(town, county);
    }
  }

  // Index for map: (year-month) -> Map(county_key -> value)
  const grouped = d3.group(countyTotals, d => ymKey(d.year, d.month));
  countyMonthIndex = new Map();

  for (const [k, rows] of grouped) {
    const mp = new Map();
    for (const r of rows) {
      mp.set(r.county_key, {
        arrivals: r.arrivals ?? 0,
        nights: r.nights ?? 0
      });
    }
    countyMonthIndex.set(k, mp);
  }

  return { geo, countyTotals, hrWide, originLong, intensityLong, meta };
}


function initControls(meta) {
  // years: prefer table13 years (map dataset)
  const years = (meta.years_table13 ?? []).slice().sort((a,b)=>a-b);
  const defaultYear = years.at(-1) ?? 2024;

  ui.yearSelect.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");

  setState({ year: defaultYear });


  ui.metricSelect.value = state.metric;
  ui.yearSelect.value = String(defaultYear);

  ui.yearSelect.addEventListener("change", () => setState({ year: +ui.yearSelect.value }));

  ui.metricSelect.addEventListener("change", () => setState({ metric: ui.metricSelect.value }));

  ui.resetBtn.addEventListener("click", () => setState({ countyKey: null }));
}

function updateAll() {
  const { geo, countyTotals, hrWide, originLong, intensityLong } = DATA;

  // Map values for current year-month
  const idx = countyMonthIndex.get(ymKey(state.year, state.month)) ?? new Map();
  const valuesByCountyKey = new Map();
  for (const [key, obj] of idx.entries()) {
    valuesByCountyKey.set(key, state.metric === "arrivals" ? obj.arrivals : obj.nights);
  }

  mapChart.update({ geojson: geo, valuesByCountyKey, state });
  lineChart.update({ hrMonthlyWide: hrWide, countyMonthlyTotals: countyTotals, state });
  barsChart.update({ originLong, state });
  scatterChart.update({ intensityLong, townToCounty, state });
}

async function main() {
  DATA = await loadData();
  initControls(DATA.meta);

  subscribe(() => updateAll());
  updateAll();

  window.addEventListener("resize", () => updateAll());
}

main();
