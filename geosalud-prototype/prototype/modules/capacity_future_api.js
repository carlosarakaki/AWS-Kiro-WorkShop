/**
 * Future API Capacity Provider — stub para integración futura.
 */

export function createFutureApiProvider() {
  const stub = {
    caps_id: null,
    availability: "not_implemented",
    waiting_time_minutes: null,
    supplies_status: "unknown",
    capacitySource: "future_api",
    captured_at: null,
  };

  return {
    name: "future_api",

    getCapacity(capsId) {
      return { ...stub, caps_id: capsId };
    },

    getSupplies(capsId) {
      return { caps_id: capsId, supplies_status: "unknown", capacitySource: "future_api" };
    },

    getWaitingTime(capsId) {
      return { caps_id: capsId, waiting_time_minutes: null, capacitySource: "future_api" };
    },
  };
}
