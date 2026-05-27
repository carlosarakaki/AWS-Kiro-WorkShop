/**
 * Motor de derivación — calcula ranking de CAPS por proximidad, capacidad y prestación.
 */

import { haversine } from "./haversine.js";

const AVAILABILITY_TO_SCORE = Object.freeze({
  high: 1.0,
  medium: 0.6,
  low: 0.2,
  unknown: 0.4,
  not_implemented: 0.0,
});

/**
 * Normaliza pesos para que sumen 1.
 * @param {{ distance: number, capacity: number, services: number }} weights
 * @returns {{ distance: number, capacity: number, services: number }}
 */
export function normalizeWeights(weights) {
  const sum = weights.distance + weights.capacity + weights.services;
  if (sum <= 0) {
    throw new Error("[config_error] La suma de pesos debe ser mayor a 0.");
  }
  return {
    distance: weights.distance / sum,
    capacity: weights.capacity / sum,
    services: weights.services / sum,
  };
}

/**
 * Construye un ReferralRequest limpio (sin PII).
 * @param {Record<string, unknown>} formInput
 * @param {import('../config.js').AppConfig} cfg
 * @returns {{ request_id: string, location: {lat: number, lon: number}, pathology_code: string, region_codes: string[] }}
 */
export function buildReferralRequest(formInput, cfg) {
  const regionCodes = Array.isArray(cfg.regionCode) ? cfg.regionCode : [cfg.regionCode];
  return {
    request_id: crypto.randomUUID(),
    location: formInput.location,
    pathology_code: formInput.pathology_code,
    region_codes: regionCodes,
  };
}

/**
 * Calcula el score de un CAPS candidato.
 */
function score(distanceKm, capacity, servicesMatchRatio, weights, maxDistanceKm) {
  const distScore = maxDistanceKm > 0 ? 1 - Math.min(distanceKm / maxDistanceKm, 1) : 1;
  const capScore = AVAILABILITY_TO_SCORE[capacity.availability] || 0;
  const svcScore = servicesMatchRatio;

  return weights.distance * distScore + weights.capacity * capScore + weights.services * svcScore;
}

/**
 * Rankea CAPS según la solicitud de derivación.
 * @param {object} request - ReferralRequest
 * @param {Array} caps - CapsRecord[]
 * @param {object} pathology - PathologyEntry
 * @param {object} capacityProvider
 * @param {import('../config.js').AppConfig} cfg
 * @returns {Array} RankedCap[]
 */
export function rank(request, caps, pathology, capacityProvider, cfg) {
  const regionCodes = Array.isArray(cfg.regionCode) ? cfg.regionCode : [cfg.regionCode];
  const weights = normalizeWeights(cfg.rankingWeights);

  // Filtrar por región
  let candidates = caps.filter((c) => regionCodes.includes(c.region_code));

  // Filtrar por compatibilidad de prestación
  const requiredServices = pathology.required_services || [];
  candidates = candidates.filter((c) => {
    return c.services.some((s) => requiredServices.includes(s));
  });

  if (candidates.length === 0) return [];

  // Calcular distancias
  const withDistance = candidates.map((c) => ({
    caps: c,
    distance_km: haversine(request.location, c.coordinates),
  }));

  const maxDistance = Math.max(...withDistance.map((w) => w.distance_km), 1);

  // Calcular scores
  const ranked = withDistance.map((w) => {
    const capacity = capacityProvider.getCapacity(w.caps.caps_id);
    const compatibleServices = w.caps.services.filter((s) => requiredServices.includes(s));
    const servicesMatchRatio =
      requiredServices.length > 0 ? compatibleServices.length / requiredServices.length : 0;

    return {
      caps: w.caps,
      distance_km: Math.round(w.distance_km * 100) / 100,
      capacity,
      compatible_services: compatibleServices,
      score: score(w.distance_km, capacity, servicesMatchRatio, weights, maxDistance),
    };
  });

  // Ordenar descendente por score
  ranked.sort((a, b) => b.score - a.score);

  // Truncar
  return ranked.slice(0, cfg.referralMaxResults);
}
