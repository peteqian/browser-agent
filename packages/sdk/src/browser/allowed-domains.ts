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
