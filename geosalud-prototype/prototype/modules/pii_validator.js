/**
 * Validador de PII — rechaza inputs con datos personales.
 */

export const FORBIDDEN_KEYS = Object.freeze([
  "name", "fullName", "firstName", "lastName",
  "dni", "documento", "document", "documentNumber",
  "phone", "telefono", "email", "mail",
  "address", "direccionExacta", "addressLine",
  "obraSocial", "historiaClinica", "medicalRecord",
]);

export const PII_PATTERNS = Object.freeze({
  dniArg: /\b\d{7,8}\b/,
  phone: /\+?\d[\d\s().-]{6,}\d/,
  email: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/,
});

/**
 * @param {Record<string, unknown>} formInput
 * @returns {{ ok: true } | { ok: false, code: string, reason: string }}
 */
export function validate(formInput) {
  for (const key of Object.keys(formInput)) {
    if (FORBIDDEN_KEYS.includes(key.toLowerCase()) || FORBIDDEN_KEYS.includes(key)) {
      return { ok: false, code: "pii_not_allowed", reason: "El formulario contiene campos no permitidos." };
    }
  }

  for (const value of Object.values(formInput)) {
    if (typeof value === "string") {
      for (const pattern of Object.values(PII_PATTERNS)) {
        if (pattern.test(value)) {
          return { ok: false, code: "pii_not_allowed", reason: "El formulario contiene datos personales no permitidos." };
        }
      }
    }
  }

  return { ok: true };
}
