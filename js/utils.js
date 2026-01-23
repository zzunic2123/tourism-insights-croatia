export const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function formatInt(x){
  if (x == null || Number.isNaN(x)) return "n/a";
  return new Intl.NumberFormat("en-US").format(Math.round(x));
}

export function formatFloat(x, digits=2){
  if (x == null || Number.isNaN(x)) return "n/a";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(x);
}

export function showTooltip(el, html, x, y){
  el.innerHTML = html;
  el.style.opacity = 1;
  el.style.left = (x + 12) + "px";
  el.style.top  = (y + 12) + "px";
}

export function hideTooltip(el){
  el.style.opacity = 0;
}

export function clamp(v, a, b){
  return Math.max(a, Math.min(b, v));
}

export function niceMetricLabel(metric){
  return metric === "arrivals" ? "Arrivals" : "Nights";
}
