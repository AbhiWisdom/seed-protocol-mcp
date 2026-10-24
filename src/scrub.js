/**
 * Secret scrubber — runs on EVERY piece of text before it is uploaded to the
 * SEED API or written into the local brain. Matches are replaced with
 * `[REDACTED:<type>]` so neither place ever holds a usable credential.
 *
 * Order matters: specific token formats run first, the generic
 * `key = value` rule runs last and never re-redacts an existing marker.
 */

const B = "(?<![A-Za-z0-9_-])"; // left boundary that also treats - and _ as word chars

/** Mixed-case or digit-bearing → looks like a random token, not snake_case prose. */
const looksRandom = (s) => /[0-9]/.test(s) || (/[A-Z]/.test(s) && /[a-z]/.test(s));

const RULES = [
  {
    type: "private_key",
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g,
  },
  { type: "anthropic_key", re: new RegExp(`${B}sk-ant-[A-Za-z0-9_-]{20,}`, "g") },
  { type: "stripe_key", re: new RegExp(`${B}(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}`, "g") },
  { type: "openai_key", re: new RegExp(`${B}sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}`, "g") },
  { type: "seed_key", re: new RegExp(`${B}seed_[A-Za-z0-9_-]{20,}`, "g"), keep: (m) => looksRandom(m.slice(5)) },
  { type: "aws_access_key", re: /(?<![A-Z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Z0-9])/g },
  { type: "github_token", re: new RegExp(`${B}(?:(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})`, "g") },
  { type: "slack_token", re: new RegExp(`${B}xox[abprs]-[A-Za-z0-9-]{10,}`, "g") },
  { type: "google_api_key", re: new RegExp(`${B}AIza[0-9A-Za-z_-]{35}`, "g") },
  { type: "telegram_bot_token", re: /(?<![0-9])\d{8,10}:AA[0-9A-Za-z_-]{30,}/g },
  { type: "jwt", re: new RegExp(`${B}eyJ[A-Za-z0-9_-]{5,}\\.eyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]*`, "g") },
  { type: "bearer_token", re: /\b(Bearer\s+)([A-Za-z0-9._~+/-]{20,}=*)/g, keepPrefix: true },
  {
    // scheme://user:pass@host → scheme://[REDACTED:url_credentials]@host
    type: "url_credentials",
    re: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+:[^\s@/]+)(?=@)/gi,
    keepPrefix: true,
  },
  {
    // Generic service keys: short prefix + long random token, e.g. nb_7f09…, abhi_live_…, vg_…
    type: "api_key",
    re: new RegExp(`${B}[a-z]{2,8}_(?:live_|test_)?[A-Za-z0-9]{24,}(?![A-Za-z0-9])`, "g"),
    keep: (m) => /[0-9]/.test(m.slice(m.indexOf("_") + 1)),
  },
  {
    // api_key = "...", "password": "...", SECRET: ..., access_token=...
    type: "secret",
    re: /((?:api[_-]?key|secret|token|passw(?:or)?d)["']?\s*[:=]\s*["']?)(?!\[REDACTED)([^\s"'`,;]{8,})/gi,
    keepPrefix: true,
  },
];

/**
 * Scrub one string. Returns the redacted text plus per-type counts.
 * @param {string} text
 * @returns {{ text: string, redactions: Record<string, number> }}
 */
export function scrubWithReport(text) {
  const redactions = {};
  if (typeof text !== "string" || !text) return { text, redactions };
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.re, (...args) => {
      const match = args[0];
      if (rule.keep && !rule.keep(match)) return match;
      redactions[rule.type] = (redactions[rule.type] || 0) + 1;
      const marker = `[REDACTED:${rule.type}]`;
      // keepPrefix rules: group 1 is the non-secret prefix, group 2 the secret.
      return rule.keepPrefix ? args[1] + marker : marker;
    });
  }
  return { text: out, redactions };
}

/** Scrub one string (non-strings pass through untouched). */
export function scrub(text) {
  return scrubWithReport(text).text;
}

/** Scrub every string inside a JSON-like value (objects, arrays, nested). */
export function scrubDeep(value) {
  if (typeof value === "string") return scrub(value);
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubDeep(v);
    return out;
  }
  return value;
}

/** Secret types this scrubber knows about (for docs and tests). */
export const SECRET_TYPES = RULES.map((r) => r.type);
