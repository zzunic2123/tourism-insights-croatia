export const state = {
  year: null,
  month: 7,
  metric: "nights",     // "nights" | "arrivals"
  countyKey: null,      // e.g. "splitsko dalmatinska"
};

const listeners = new Set();

export function setState(patch) {
  Object.assign(state, patch);
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
