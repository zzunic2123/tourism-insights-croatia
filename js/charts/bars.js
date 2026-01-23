import { formatInt, niceMetricLabel, showTooltip, hideTooltip } from "../utils.js";

export function createBarsChart({ svg, tooltipEl, emptyEl }) {
  const margin = { top: 12, right: 18, bottom: 34, left: 140 };
  const g = svg.append("g");
  const gx = g.append("g");
  const barsG = g.append("g");

  function update({ originLong, state }) {
    const W = svg.node().clientWidth;
    const H = svg.node().clientHeight;
    const width = W - margin.left - margin.right;
    const height = H - margin.top - margin.bottom;
    g.attr("transform", `translate(${margin.left},${margin.top})`);

    if (!state.countyKey) {
      emptyEl.style.display = "block";
      barsG.selectAll("*").remove();
      gx.selectAll("*").remove();
      return;
    }
    emptyEl.style.display = "none";

    const rows = originLong
    .filter(d =>
        d.county_key === state.countyKey &&
        d.year === state.year &&
        d.month === state.month
    )
    .filter(d => {
        const k = String(d.origin_country).toLowerCase().trim();
        return !["countries - total", "foreign countries - total", "total"].includes(k);
    });


    const metric = state.metric;
    const top = rows
      .map(d => ({
        country: d.origin_country,
        value: metric === "arrivals" ? d.arrivals : d.nights,
        arrivals: d.arrivals,
        nights: d.nights
      }))
      .filter(d => d.value != null)
      .sort((a,b) => b.value - a.value)
      .slice(0, 10)
      .reverse(); // for nicer top-to-bottom ordering

    const xMax = d3.max(top, d => d.value) ?? 1;

    const x = d3.scaleLinear().domain([0, xMax]).range([0, width]);
    const y = d3.scaleBand().domain(top.map(d => d.country)).range([height, 0]).padding(0.12);

    gx.attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(5));

    // bars
    const bars = barsG.selectAll("rect.bar").data(top, d => d.country);

    bars.enter().append("rect")
      .attr("class","bar")
      .attr("x", 0)
      .attr("y", d => y(d.country))
      .attr("height", y.bandwidth())
      .attr("width", d => x(d.value))
      .attr("fill", "#0b57d0")
      .style("cursor","default")
      .on("mousemove", (event,d) => {
        const html = `
          <div style="font-weight:700;margin-bottom:4px">${d.country}</div>
          <div>${niceMetricLabel(metric)}: <b>${formatInt(d.value)}</b></div>
          <div style="opacity:.85">Arrivals: ${formatInt(d.arrivals)}</div>
          <div style="opacity:.85">Nights: ${formatInt(d.nights)}</div>
        `;
        showTooltip(tooltipEl, html, event.clientX, event.clientY);
      })
      .on("mouseleave", () => hideTooltip(tooltipEl))
      .merge(bars)
      .transition().duration(250)
      .attr("y", d => y(d.country))
      .attr("height", y.bandwidth())
      .attr("width", d => x(d.value));

    bars.exit().remove();

    // labels
    const labels = barsG.selectAll("text.lbl").data(top, d => d.country);
    labels.enter().append("text")
      .attr("class","lbl")
      .attr("x", -10)
      .attr("y", d => (y(d.country) ?? 0) + y.bandwidth()/2)
      .attr("dy","0.35em")
      .attr("text-anchor","end")
      .attr("fill","#1d2433")
      .attr("font-size", 12)
      .text(d => d.country)
      .merge(labels)
      .transition().duration(250)
      .attr("y", d => (y(d.country) ?? 0) + y.bandwidth()/2)
      .text(d => d.country);

    labels.exit().remove();
  }

  return { update };
}
