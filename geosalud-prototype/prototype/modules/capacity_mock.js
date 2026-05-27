/**
 * Mock Capacity Provider — lee datos simulados de un JSON estático.
 */

/**
 * @param {object} data - objeto con { items: [...] }
 * @returns {import('../config.js').CapacityProvider}
 */
export function createMockProvider(data) {
  const items = data?.items || [];
  const index = new Map(items.map((item) => [item.caps_id, item]));

  return {
    name: "mock",

    getCapacity(capsId) {
      const item = index.get(capsId);
      if (!item) {
        return {
          caps_id: capsId,
          availability: "unknown",
          waiting_time_minutes: null,
          supplies_status: "unknown",
          capacitySource: "mock",
          captured_at: null,
        };
      }
      return {
        caps_id: capsId,
        availability: item.availability,
        waiting_time_minutes: item.waiting_time_minutes,
        supplies_status: item.supplies_status,
        capacitySource: "mock",
        captured_at: item.captured_at,
      };
    },

    getSupplies(capsId) {
      const item = index.get(capsId);
      return {
        caps_id: capsId,
        supplies_status: item?.supplies_status || "unknown",
        capacitySource: "mock",
      };
    },

    getWaitingTime(capsId) {
      const item = index.get(capsId);
      return {
        caps_id: capsId,
        waiting_time_minutes: item?.waiting_time_minutes || null,
        capacitySource: "mock",
      };
    },
  };
}
