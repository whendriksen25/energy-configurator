// Prints the reference data (connections, tariff bands, tax, defaults, scenarios, site types, sources)
// as JSON, for the energy_reference seed row.
import { CONNECTIONS, LIANDER_2026_BANDS, SCENARIOS, SITE_TYPES, SOURCES, MODEL_VERSION, defaultParams } from "../lib/engine/params";
const j = (x: unknown) => JSON.parse(JSON.stringify(x, (_k, v) => (v === Infinity ? null : v)));
console.log(JSON.stringify({
  model_version: MODEL_VERSION,
  connections: j(CONNECTIONS), grid_bands: j(LIANDER_2026_BANDS), defaults: j(defaultParams()),
  scenarios: j(SCENARIOS), site_types: j(SITE_TYPES), sources: SOURCES,
}));
