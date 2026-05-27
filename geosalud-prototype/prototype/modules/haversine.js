/**
 * Módulo Haversine — calcula distancia geodésica entre dos coordenadas.
 */

const EARTH_RADIUS_KM = 6371.0088;

/**
 * @param {{ lat: number, lon: number }} a
 * @param {{ lat: number, lon: number }} b
 * @returns {number} distancia en km
 */
export function haversine(a, b) {
  if (a.lat < -90 || a.lat > 90 || b.lat < -90 || b.lat > 90) {
    throw new RangeError("[invalid_coords] Latitud fuera de rango [-90, 90]");
  }
  if (a.lon < -180 || a.lon > 180 || b.lon < -180 || b.lon > 180) {
    throw new RangeError("[invalid_coords] Longitud fuera de rango [-180, 180]");
  }

  const toRad = (deg) => (deg * Math.PI) / 180;
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dPhi = toRad(b.lat - a.lat);
  const dLambda = toRad(b.lon - a.lon);
  const h =
    Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
