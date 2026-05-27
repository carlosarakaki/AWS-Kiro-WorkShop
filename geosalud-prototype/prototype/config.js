/**
 * @typedef {Object} RankingWeights
 * @property {number} distance
 * @property {number} capacity
 * @property {number} services
 */

/**
 * @typedef {Object} AppConfig
 * @property {string|string[]} regionCode
 * @property {string} refesStaticPath
 * @property {string} pathologyCatalogPath
 * @property {"mock"|"future_api"} capacityProvider
 * @property {string} capacityMockPath
 * @property {string} populationMockPath
 * @property {number} lowCoverageThreshold
 * @property {RankingWeights} rankingWeights
 * @property {number} referralMaxResults
 * @property {boolean} roleTabsEnabled
 * @property {"ministry"|"operator"} [role]
 * @property {string} georefApiBaseUrl
 */

/** @type {AppConfig} */
export const APP_CONFIG = Object.freeze({
  regionCode: "06",
  refesStaticPath: "./data/refes.json",
  pathologyCatalogPath: "./data/pathology_catalog.json",
  capacityProvider: "mock",
  capacityMockPath: "./data/capacity_mock.json",
  populationMockPath: "./data/population_mock.json",
  lowCoverageThreshold: 10000,
  rankingWeights: Object.freeze({ distance: 0.5, capacity: 0.3, services: 0.2 }),
  referralMaxResults: 5,
  roleTabsEnabled: false,
  role: "operator",
  georefApiBaseUrl: "https://apis.datos.gob.ar/georef/api",
});

/**
 * Aplica overrides desde query params de la URL.
 * @param {AppConfig} config
 * @param {string} search - window.location.search
 * @returns {AppConfig}
 */
export function applyQueryParamOverrides(config, search) {
  const params = new URLSearchParams(search);
  const overrides = { ...config };

  if (params.has("region")) {
    const val = params.get("region");
    overrides.regionCode = val.includes(",") ? val.split(",") : val;
  }
  if (params.has("role")) {
    overrides.role = params.get("role");
  }
  if (params.has("capacityProvider")) {
    overrides.capacityProvider = params.get("capacityProvider");
  }
  if (params.has("lowCoverageThreshold")) {
    overrides.lowCoverageThreshold = Number(params.get("lowCoverageThreshold"));
  }
  if (params.has("referralMaxResults")) {
    overrides.referralMaxResults = Number(params.get("referralMaxResults"));
  }
  if (params.has("roleTabsEnabled")) {
    overrides.roleTabsEnabled = params.get("roleTabsEnabled") === "true";
  }

  return Object.freeze(overrides);
}

/**
 * Valida que la config tenga las claves obligatorias.
 * @param {AppConfig} config
 * @throws {Error}
 */
export function validateConfig(config) {
  const required = ["regionCode", "refesStaticPath", "pathologyCatalogPath", "capacityProvider"];
  for (const key of required) {
    if (config[key] === undefined || config[key] === null || config[key] === "") {
      throw new Error(`[config_error] Falta la propiedad obligatoria: ${key}`);
    }
  }
  const validProviders = ["mock", "future_api"];
  if (!validProviders.includes(config.capacityProvider)) {
    throw new Error(`[config_error] capacityProvider "${config.capacityProvider}" no soportado. Use: ${validProviders.join(", ")}`);
  }
}
