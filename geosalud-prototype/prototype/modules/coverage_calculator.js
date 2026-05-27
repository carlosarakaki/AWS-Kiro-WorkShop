/**
 * Módulo de cálculo de cobertura poblacional por CAPS.
 */

/**
 * @param {{ unit_id: string, unit_kind: string }} unit
 * @param {number} capsCount
 * @param {number|null} population
 * @param {number} threshold
 * @returns {{ unit_id: string, unit_kind: string, caps_count: number, population: number|null, indicator: number|null, status: string, low_coverage: boolean }}
 */
export function computeUnit(unit, capsCount, population, threshold) {
  if (population != null && capsCount > 0) {
    const indicator = population / capsCount;
    return {
      unit_id: unit.unit_id,
      unit_kind: unit.unit_kind,
      caps_count: capsCount,
      population,
      indicator,
      status: "ok",
      low_coverage: indicator >= threshold,
    };
  }
  return {
    unit_id: unit.unit_id,
    unit_kind: unit.unit_kind,
    caps_count: capsCount,
    population,
    indicator: null,
    status: "unknown_population",
    low_coverage: false,
  };
}

/**
 * @param {Array} units - array de CoverageResult
 * @returns {{ caps_total: number, population_total: number, coverage_indicator_avg: number|null, low_coverage_zones: number }}
 */
export function aggregate(units) {
  let capsTotal = 0;
  let populationTotal = 0;
  let indicatorSum = 0;
  let indicatorCount = 0;
  let lowCoverageZones = 0;

  for (const u of units) {
    capsTotal += u.caps_count;
    if (u.population != null) {
      populationTotal += u.population;
    }
    if (u.indicator != null) {
      indicatorSum += u.indicator;
      indicatorCount++;
    }
    if (u.low_coverage) {
      lowCoverageZones++;
    }
  }

  return {
    caps_total: capsTotal,
    population_total: populationTotal,
    coverage_indicator_avg: indicatorCount > 0 ? indicatorSum / indicatorCount : null,
    low_coverage_zones: lowCoverageZones,
  };
}
