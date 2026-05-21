/**
 * Restrict navigation/new-tab actions to a domain allowlist. Patterns:
 *   - `example.com` exact host match (case-insensitive)
 *   - `*.example.com` matches any subdomain AND the bare apex (`example.com`)
 *   - non-http(s) URLs (e.g. `about:blank`, `file:`) are always allowed
 *
 * Empty/undefined patterns mean "no restriction".
 */
export function matchesAllowedDomains(
  url: string,
  patterns: readonly string[] | undefined,
): boolean {
  if (!patterns || patterns.length === 0) return true;

  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
    host = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }

  for (const raw of patterns) {
    const pat = raw.trim().toLowerCase();
    if (pat.length === 0) continue;
    if (pat.startsWith("*.")) {
      const apex = pat.slice(2);
      if (host === apex || host.endsWith(`.${apex}`)) return true;
    } else if (host === pat) {
      return true;
    }
  }
  return false;
}

/**
 * Normalize user-supplied allowedDomains input from a config file or CLI
 * flag. Accepts a comma-separated string, an array of strings, or
 * undefined; returns a cleaned array, or undefined when empty.
 */
export function parseAllowedDomainsInput(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const cleaned = list
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}
