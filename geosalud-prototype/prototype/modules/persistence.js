/**
 * Persistence — wrappers de localStorage para favoritos e historial.
 */

import { FORBIDDEN_KEYS } from "./pii_validator.js";

const KEYS = Object.freeze({
  favorites: "geosalud:favorites",
  referralHistory: "geosalud:referralHistory",
});

const SCHEMA_VERSION = 1;
const MAX_HISTORY_ENTRIES = 50;
const MAX_BYTES_PER_KEY = 64 * 1024;

function readStore(key, defaultPayload) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaultPayload;
    const parsed = JSON.parse(raw);
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      writeStore(key, defaultPayload);
      return defaultPayload;
    }
    return parsed.payload;
  } catch {
    return defaultPayload;
  }
}

function writeStore(key, payload) {
  const data = { schemaVersion: SCHEMA_VERSION, payload, updatedAt: new Date().toISOString() };
  const serialized = JSON.stringify(data);
  if (serialized.length > MAX_BYTES_PER_KEY) {
    throw new Error("QuotaError: excede el límite de almacenamiento por clave.");
  }
  localStorage.setItem(key, serialized);
}

export function readFavorites() {
  return readStore(KEYS.favorites, []);
}

export function writeFavorites(ids) {
  writeStore(KEYS.favorites, ids);
}

export function toggleFavorite(capsId) {
  const favs = readFavorites();
  const idx = favs.indexOf(capsId);
  if (idx >= 0) {
    favs.splice(idx, 1);
  } else {
    favs.push(capsId);
  }
  writeFavorites(favs);
  return favs;
}

export function readHistory() {
  return readStore(KEYS.referralHistory, []);
}

export function appendHistory(entry) {
  // Defensa en profundidad: rechazar entradas con claves PII
  for (const key of Object.keys(entry)) {
    if (FORBIDDEN_KEYS.includes(key)) {
      throw new Error("pii_not_allowed: la entrada contiene claves PII.");
    }
  }

  const history = readHistory();
  history.push(entry);

  // FIFO: rotar si excede el máximo
  while (history.length > MAX_HISTORY_ENTRIES) {
    history.shift();
  }

  writeStore(KEYS.referralHistory, history);
}

export function clearAll() {
  localStorage.removeItem(KEYS.favorites);
  localStorage.removeItem(KEYS.referralHistory);
}
