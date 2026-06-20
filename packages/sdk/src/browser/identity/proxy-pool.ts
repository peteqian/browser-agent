/**
 * Proxy rotation for high-volume scraping / job-board automation without
 * tripping IP-based rate limits or bans. A pool holds N proxy servers and
 * hands one out per launch by a configurable strategy.
 *
 * NOTE — this rotates the *network egress IP* (Chrome `--proxy-server`). It
 * does NOT change Chrome's TLS/JA3 fingerprint, which CDN-level bot detectors
 * (Cloudflare, DataDome) also inspect. Defeating TLS fingerprinting needs a
 * uTLS-style man-in-the-middle proxy in front of Chrome — out of scope here.
 * Point the pool entries at such a proxy if you need that layer.
 */

export interface ProxyEntry {
  /** `scheme://host:port`, e.g. `http://1.2.3.4:8080` or `socks5://...`. */
  server: string;
  /** Optional `--proxy-bypass-list` for this entry. */
  bypass?: string;
  /** Free-form label for logging/reporting (e.g. region). */
  label?: string;
}

export type ProxyRotationStrategy = "round-robin" | "random" | "sticky-per-host";

export interface ProxyPoolOptions {
  proxies: Array<ProxyEntry | string>;
  /** Default: "round-robin". */
  strategy?: ProxyRotationStrategy;
  /** Seeded RNG for deterministic "random" selection in tests. */
  rng?: () => number;
}

function normalize(entry: ProxyEntry | string): ProxyEntry {
  return typeof entry === "string" ? { server: entry } : entry;
}

export class ProxyPool {
  private readonly proxies: ProxyEntry[];
  private readonly strategy: ProxyRotationStrategy;
  private readonly rng: () => number;
  private cursor = 0;
  /** host → chosen proxy, for sticky-per-host. */
  private readonly stickyByHost = new Map<string, ProxyEntry>();

  constructor(options: ProxyPoolOptions) {
    this.proxies = options.proxies.map(normalize).filter((p) => p.server.trim().length > 0);
    if (this.proxies.length === 0) throw new Error("ProxyPool requires at least one proxy");
    this.strategy = options.strategy ?? "round-robin";
    this.rng = options.rng ?? Math.random;
  }

  get size(): number {
    return this.proxies.length;
  }

  /**
   * Pick the next proxy. `host` is only used by the "sticky-per-host"
   * strategy — pass the target hostname so the same site keeps the same exit
   * IP across a session (avoids mid-session IP changes that look suspicious).
   */
  next(host?: string): ProxyEntry {
    if (this.strategy === "random") {
      const idx = Math.min(this.proxies.length - 1, Math.floor(this.rng() * this.proxies.length));
      return this.proxies[idx]!;
    }
    if (this.strategy === "sticky-per-host" && host) {
      const existing = this.stickyByHost.get(host);
      if (existing) return existing;
      const chosen = this.proxies[this.cursor % this.proxies.length]!;
      this.cursor += 1;
      this.stickyByHost.set(host, chosen);
      return chosen;
    }
    const chosen = this.proxies[this.cursor % this.proxies.length]!;
    this.cursor += 1;
    return chosen;
  }

  /** Map a chosen entry to launch options merged into a profile/launch config. */
  static toLaunchOptions(entry: ProxyEntry): { proxyServer: string; proxyBypass?: string } {
    return {
      proxyServer: entry.server,
      ...(entry.bypass ? { proxyBypass: entry.bypass } : {}),
    };
  }
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/**
 * Convenience: resolve launch proxy options from a pool for a target URL.
 * Returns `{}` when no pool is given so callers can spread unconditionally.
 */
export function resolveProxyLaunch(
  pool: ProxyPool | undefined,
  targetUrl?: string,
): { proxyServer?: string; proxyBypass?: string } {
  if (!pool) return {};
  return ProxyPool.toLaunchOptions(pool.next(hostOf(targetUrl)));
}
