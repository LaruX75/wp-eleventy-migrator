const REDACTED = "[REDACTED]";

const KNOWN_SECRET_KEYS = new Set([
  "wpAppPassword",
  "wpBearerToken"
]);

const SECRET_KEY_PATTERN = /password|token|secret|credential/i;

function shouldRedactKey(key) {
  if (KNOWN_SECRET_KEYS.has(key)) return true;
  return SECRET_KEY_PATTERN.test(key);
}

function redactValue(key, value) {
  if (!shouldRedactKey(key)) return value;
  if (value === undefined || value === null) return value;
  if (typeof value === "string" && value.length === 0) return value;
  return REDACTED;
}

export function redactConfig(config) {
  if (config === null || typeof config !== "object") return config;
  if (Array.isArray(config)) return config.map((item) => redactConfig(item));
  const out = {};
  for (const [key, value] of Object.entries(config)) {
    if (shouldRedactKey(key)) {
      out[key] = redactValue(key, value);
    } else if (value && typeof value === "object") {
      out[key] = redactConfig(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
