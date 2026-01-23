import { formatInt, formatFloat, showTooltip, hideTooltip } from "../utils.js";
import { townToCounty as townToCountyRaw } from "./townToCounty.js";

export function createScatterChart({ svg, tooltipEl }) {
  const margin = { top: 16, right: 18, bottom: 40, left: 56 };
  const g = svg.append("g");
  const gx = g.append("g");
  const gy = g.append("g");
  const ptsG = g.append("g");

  // ---- normalizacija teksta (radi stabilan join) ----
  const norm = (s) =>
    String(s ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // makni dijakritiku
      .toLowerCase()
      .replace(/-/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  // ---- napravi NORMALIZIRANI lookup: town -> county ----
  const townToCounty = new Map();
  for (const [town, county] of townToCountyRaw.entries()) {
    townToCounty.set(norm(town), norm(county));
  }

  function update({ intensityLong, state }) {
    const W = svg.node().clientWidth;
    const H = svg.node().clientHeight;
    const width = W - margin.left - margin.right;
    const height = H - margin.top - margin.bottom;

    g.attr("transform", `translate(${margin.left},${margin.top})`);

    // Ako zupanija nije odabrana -> ocisti graf
    if (!state.countyKey) {
      ptsG.selectAll("*").remove();
      gx.selectAll("*").remove();
      gy.selectAll("*").remove();
      return;
    }

    const selectedCounty = norm(state.countyKey);

    // 1) filtriraj po godini + municipality
    // 2) filtriraj po gradovima koji pripadaju odabranoj zupaniji (preko townToCounty mape)
    const rows = intensityLong
      .filter((d) => d.year === state.year)
      .filter((d) => d.spatial_level === "municipality")
      .filter((d) => {
        const townKey = norm(d.spatial_unit);
        const mappedCounty = townToCounty.get(townKey);

        // fallback: nekad se spatial_unit razlikuje, ali county_key u intensity je vec "town key"
        const fallbackCounty = townToCounty.get(norm(d.county_key));

        return mappedCounty === selectedCounty || fallbackCounty === selectedCounty;
      });

    // DEBUG (da odmah vidis jel join radi)
    console.log("[scatter] county =", state.countyKey, "year =", state.year, "rows =", rows.length);

    // Ako nema podataka -> ocisti i exit
    if (!rows.length) {
      ptsG.selectAll("*").remove();
      gx.selectAll("*").remove();
      gy.selectAll("*").remove();
      return;
    }

    // X = nights_per_100, Y = nights_per_km2, size = permanent_beds
    const clean = rows
      .map((d) => ({
        name: d.spatial_unit,
        x: +d.nights_per_100,
        y: +d.nights_per_km2,
        beds: +d.permanent_beds || 0,
        nights: +d.nights || 0,
        arrivals: +d.arrivals || 0,
      }))
      .filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));

    if (!clean.length) {
      ptsG.selectAll("*").remove();
      gx.selectAll("*").remove();
      gy.selectAll("*").remove();
      return;
    }

    const x = d3.scaleLinear()
      .domain(d3.extent(clean, (d) => d.x)).nice()
      .range([0, width]);

    const y = d3.scaleLinear()
      .domain(d3.extent(clean, (d) => d.y)).nice()
      .range([height, 0]);

    const r = d3.scaleSqrt()
      .domain([0, d3.max(clean, (d) => d.beds) ?? 1])
      .range([2, 12]);

    gx.attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(6));

    gy.call(d3.axisLeft(y).ticks(6));

    // labels
    g.selectAll("text.xLabel").data([0]).join("text")
      .attr("class", "xLabel")
      .attr("x", width)
      .attr("y", height + 34)
      .attr("text-anchor", "end")
      .attr("fill", "#5a6477")
      .attr("font-size", 11)
      .text("Tourist nights per 100 inhabitants");

    g.selectAll("text.yLabel").data([0]).join("text")
      .attr("class", "yLabel")
      .attr("x", 0)
      .attr("y", -4)
      .attr("text-anchor", "start")
      .attr("fill", "#5a6477")
      .attr("font-size", 11)
      .text("Tourist nights per km2");

    const pts = ptsG.selectAll("circle.pt").data(clean, (d) => d.name);

    pts.enter().append("circle")
      .attr("class", "pt")
      .attr("cx", (d) => x(d.x))
      .attr("cy", (d) => y(d.y))
      .attr("r", (d) => r(d.beds))
      .attr("fill", "rgba(11,87,208,0.35)")
      .attr("stroke", "rgba(11,87,208,0.7)")
      .attr("stroke-width", 1)
      .on("mousemove", (event, d) => {
        const html = `
          <div style="font-weight:700;margin-bottom:4px">${d.name}</div>
          <div>Nights/100: <b>${formatFloat(d.x, 2)}</b></div>
          <div>Nights/km2: <b>${formatFloat(d.y, 2)}</b></div>
          <div style="opacity:.85">Nights: ${formatInt(d.nights)}</div>
          <div style="opacity:.85">Arrivals: ${formatInt(d.arrivals)}</div>
          <div style="opacity:.85">Permanent beds: ${formatInt(d.beds)}</div>
        `;
        showTooltip(tooltipEl, html, event.clientX, event.clientY);
      })
      .on("mouseleave", () => hideTooltip(tooltipEl))
      .merge(pts)
      .transition().duration(250)
      .attr("cx", (d) => x(d.x))
      .attr("cy", (d) => y(d.y))
      .attr("r", (d) => r(d.beds));

    pts.exit().remove();
  }

  return { update };
}
