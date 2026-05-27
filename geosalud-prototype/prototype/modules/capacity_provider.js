/**
 * Factory de Capacity Provider — despacha según configuración.
 */

import { createMockProvider } from "./capacity_mock.js";
import { createFutureApiProvider } from "./capacity_future_api.js";

/**
 * @param {import('../config.js').AppConfig} cfg
 * @param {object} [data] - datos del capacity_mock.json ya cargados
 * @returns {object} CapacityProvider
 */
export function createCapacityProvider(cfg, data) {
  switch (cfg.capacityProvider) {
    case "mock":
      return createMockProvider(data);
    case "future_api":
      return createFutureApiProvider();
    default:
      throw new Error(
        `[config_error] capacityProvider "${cfg.capacityProvider}" no soportado.`,
      );
  }
}
