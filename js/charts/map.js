import { formatInt, niceMetricLabel, showTooltip, hideTooltip } from "../utils.js";
import { setState } from "../state.js";

export function createMapChart({ svg, legendEl, tooltipEl }) {
  const g = svg.append("g");
  const overlay = svg.append("g");

  let projection = null;
  let path = null;

  function needsIdentity(geojson) {
    // provjeri bounds: ako su koordinate prevelike za lon/lat, koristimo identity
    const b = d3.geoBounds(geojson);
    const maxAbsX = Math.max(Math.abs(b[0][0]), Math.abs(b[1][0]));
    const maxAbsY = Math.max(Math.abs(b[0][1]), Math.abs(b[1][1]));
    return maxAbsX > 180 || maxAbsY > 90;
  }

  function resize(width, height, geojson) {
    if (needsIdentity(geojson)) {
      // GeoJSON je vec u projiciranim koordinatama (metri) -> geoIdentity radi savrseno
      projection = d3.geoIdentity().reflectY(true).fitSize([width, height], geojson);
    } else {
      // GeoJSON je lon/lat -> Mercator
      projection = d3.geoMercator().fitSize([width, height], geojson);
    }
    path = d3.geoPath(projection);
  }

 function update({ geojson, valuesByCountyKey, state }) {
  const width = svg.node().clientWidth;
  const height = svg.node().clientHeight;

  resize(width, height, geojson);

   const joinKey = (raw) =>
    String(raw)
        .toLowerCase()
        .replace(/\s+zupanija$/i, "")
        .replace(/-/g, " ")       // crtica -> razmak
        .replace(/\s+/g, " ")     // vise razmaka -> jedan
        .trim();
  const keyOf = (d) => joinKey(d.properties.county_key);

  const vals = Array.from(valuesByCountyKey.values()).filter(v => v != null);
  const maxV = d3.max(vals) ?? 1;

  const color = d3.scaleSequential()
    .domain([0, maxV])
    .interpolator(d3.interpolateBlues);

  legendEl.innerHTML = `
    <div><b>${niceMetricLabel(state.metric)}</b></div>
    <div>${state.year}-${String(state.month).padStart(2, "0")}</div>
    <div style="opacity:.75">scale: 0 → ${formatInt(maxV)}</div>
  `;

  const features = geojson.features;

  const counties = g.selectAll("path.county")
    .data(features, d => keyOf(d));

  counties.enter()
    .append("path")
    .attr("class", "county")
    .attr("d", path)
    .attr("fill", d => color(valuesByCountyKey.get(keyOf(d)) ?? 0))
    .attr("stroke", "rgba(0,0,0,0.35)")
    .attr("stroke-width", 1.4)
    .attr("vector-effect", "non-scaling-stroke")
    .attr("shape-rendering", "geometricPrecision")

    .style("cursor", "pointer")
    .on("mousemove", (event, d) => {
      const key = keyOf(d);
      const label = d.properties.county_label;
      const v = valuesByCountyKey.get(key);

      const html = `
        <div style="font-weight:700;margin-bottom:4px">${label}</div>
        <div>${niceMetricLabel(state.metric)}: <b>${formatInt(v)}</b></div>
        <div style="opacity:.8">Click to select</div>
      `;
      showTooltip(tooltipEl, html, event.clientX, event.clientY);
    })
    .on("mouseleave", () => hideTooltip(tooltipEl))
    .on("click", (_, d) => {
      const key = keyOf(d);
      setState({ countyKey: state.countyKey === key ? null : key });
    })
    .merge(counties)
    .transition()
    .duration(250)
    .attr("d", path)
    .attr("fill", d => color(valuesByCountyKey.get(keyOf(d)) ?? 0));

  counties.exit().remove();

  overlay.selectAll("*").remove();
  if (state.countyKey) {
    const selectedFeat = features.find(f => keyOf(f) === state.countyKey);
    if (selectedFeat) {
      overlay.append("path")
        .attr("d", path(selectedFeat))
        .attr("fill", "none")
        .attr("stroke", "#0b57d0")
        .attr("stroke-width", 3);
    }
  }

  // Outer border (national outline)
    const outline = { type: "FeatureCollection", features: geojson.features };
    const outer = overlay.selectAll("path.outer").data([outline]);

    outer.join("path")
    .attr("class", "outer")
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", "rgba(0,0,0,0.6)")
    .attr("stroke-width", 2.2)
    .attr("vector-effect", "non-scaling-stroke")
    .attr("pointer-events", "none");

}


  return { update };
}
