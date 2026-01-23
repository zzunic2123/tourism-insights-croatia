import { MONTHS, formatInt, niceMetricLabel, showTooltip, hideTooltip } from "../utils.js";
import { setState } from "../state.js";

export function createLineChart({ svg, tooltipEl }) {
  const margin = { top: 16, right: 18, bottom: 28, left: 46 };
  const g = svg.append("g");
  const gx = g.append("g");
  const gy = g.append("g");

  const seriesG = g.append("g");
  const pointsG = g.append("g");

  function update({ hrMonthlyWide, countyMonthlyTotals, state }) {
    const W = svg.node().clientWidth;
    const H = svg.node().clientHeight;
    const width = W - margin.left - margin.right;
    const height = H - margin.top - margin.bottom;

    g.attr("transform", `translate(${margin.left},${margin.top})`);

    // Croatia total for year
    const hr = hrMonthlyWide
      .filter(d => d.year === state.year)
      .map(d => ({
        month: d.month,
        value: state.metric === "arrivals" ? d.total_arrivals : d.total_nights,
      }))
      .sort((a,b) => a.month - b.month);

    // County for same year if selected
    let county = [];
    if (state.countyKey) {
      county = countyMonthlyTotals
        .filter(d => d.year === state.year && d.county_key === state.countyKey)
        .map(d => ({
          month: d.month,
          value: state.metric === "arrivals" ? d.arrivals : d.nights,
        }))
        .sort((a,b) => a.month - b.month);
    }

    const x = d3.scaleLinear().domain([1, 12]).range([0, width]);
    const yMax = d3.max([...hr, ...county], d => d.value) ?? 1;
    const y = d3.scaleLinear().domain([0, yMax]).nice().range([height, 0]);

    gx.attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(12).tickFormat(m => MONTHS[m-1]));
    gy.call(d3.axisLeft(y).ticks(6));

    // labels
    seriesG.selectAll("text.metricLabel").data([0]).join("text")
      .attr("class","metricLabel")
      .attr("x", 0)
      .attr("y", -4)
      .attr("fill", "#5a6477")
      .attr("font-size", 11)
      .text(`${niceMetricLabel(state.metric)} in ${state.year}`);

    const line = d3.line()
      .x(d => x(d.month))
      .y(d => y(d.value));

    // Croatia line
    seriesG.selectAll("path.hrLine")
      .data([hr])
      .join("path")
      .attr("class", "hrLine")
      .attr("fill", "none")
      .attr("stroke", "#111827")
      .attr("stroke-width", 2)
      .attr("d", line);

    // County line (if selected)
    seriesG.selectAll("path.countyLine")
      .data(state.countyKey ? [county] : [])
      .join("path")
      .attr("class", "countyLine")
      .attr("fill", "none")
      .attr("stroke", "#0b57d0")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "5,4")
      .attr("d", line);

    // points for interaction (click month)
    const pts = pointsG.selectAll("circle.hrPt")
      .data(hr, d => d.month);

    pts.enter().append("circle")
      .attr("class","hrPt")
      .attr("r", 4.5)
      .attr("cx", d => x(d.month))
      .attr("cy", d => y(d.value))
      .attr("fill", "#111827")
      .style("cursor","pointer")
      .on("mousemove", (event,d) => {
        const html = `
          <div style="font-weight:700;margin-bottom:4px">Croatia</div>
          <div>Month: <b>${MONTHS[d.month-1]}</b></div>
          <div>${niceMetricLabel(state.metric)}: <b>${formatInt(d.value)}</b></div>
          <div style="opacity:.8">Click to set month</div>
        `;
        showTooltip(tooltipEl, html, event.clientX, event.clientY);
      })
      .on("mouseleave", () => hideTooltip(tooltipEl))
      .on("click", (_, d) => setState({ month: d.month }))
      .merge(pts)
      .transition().duration(200)
      .attr("cx", d => x(d.month))
      .attr("cy", d => y(d.value));

    pts.exit().remove();

    // highlight selected month
    pointsG.selectAll("circle.monthHi")
      .data([state.month])
      .join("circle")
      .attr("class","monthHi")
      .attr("r", 8)
      .attr("fill","none")
      .attr("stroke","#0b57d0")
      .attr("stroke-width",2)
      .attr("cx", m => x(m))
      .attr("cy", () => {
        const row = hr.find(r => r.month === state.month);
        return row ? y(row.value) : y(0);
      });
  }

  return { update };
}
