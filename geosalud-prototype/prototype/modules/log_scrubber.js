/**
 * Log scrubber — elimina PII de mensajes de log.
 */

import { FORBIDDEN_KEYS, PII_PATTERNS } from "./pii_validator.js";

/**
 * @param {string} message
 * @param {Record<string, unknown>} [extra]
 * @returns {{ message: string, extra: Record<string, unknown> }}
 */
export function scrub(message, extra = {}) {
  let cleaned = message;
  cleaned = cleaned.replace(PII_PATTERNS.dniArg, "<dni>");
  cleaned = cleaned.replace(PII_PATTERNS.phone, "<phone>");
  cleaned = cleaned.replace(PII_PATTERNS.email, "<email>");

  const cleanedExtra = { ...extra };
  for (const key of Object.keys(cleanedExtra)) {
    if (FORBIDDEN_KEYS.includes(key) || FORBIDDEN_KEYS.includes(key.toLowerCase())) {
      cleanedExtra[key] = "<redacted>";
    } else if (typeof cleanedExtra[key] === "string") {
      let val = cleanedExtra[key];
      val = val.replace(PII_PATTERNS.dniArg, "<dni>");
      val = val.replace(PII_PATTERNS.phone, "<phone>");
      val = val.replace(PII_PATTERNS.email, "<email>");
      cleanedExtra[key] = val;
    }
  }

  return { message: cleaned, extra: cleanedExtra };
}

export const log = {
  info: (msg, extra) => {
    const s = scrub(msg, extra);
    console.info(s.message, s.extra);
  },
  warn: (msg, extra) => {
    const s = scrub(msg, extra);
    console.warn(s.message, s.extra);
  },
  error: (msg, extra) => {
    const s = scrub(msg, extra);
    console.error(s.message, s.extra);
  },
};
