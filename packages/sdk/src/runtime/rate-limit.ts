/**
 * Politeness rate limiter. Enforces a minimum interval between actions
 * (globally and/or per host) so high-volume automation doesn't trip
 * volume-based bot heuristics or hammer a single site. Clock and sleep are
 * injectable for deterministic tests.
 */
export interface RateLimitConfig {
  /** Minimum ms between any two actions. Default: 0 (off). */
  perActionMs?: number;
  /** Minimum ms between two actions targeting the same host. Default: 0 (off). */
  perHostMs?: number;
}

export interface RateLimiterDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class RateLimiter {
  private readonly perActionMs: number;
  private readonly perHostMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastActionAt = -Infinity;
  private readonly lastHostAt = new Map<string, number>();

  constructor(config: RateLimitConfig = {}, deps: RateLimiterDeps = {}) {
    this.perActionMs = Math.max(0, config.perActionMs ?? 0);
    this.perHostMs = Math.max(0, config.perHostMs ?? 0);
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get enabled(): boolean {
    return this.perActionMs > 0 || this.perHostMs > 0;
  }

  /**
   * Block until enough time has elapsed since the last action (and the last
   * action to `host`, if per-host limiting is on). Returns the ms waited.
   */
  async acquire(host?: string): Promise<number> {
    if (!this.enabled) return 0;
    const current = this.now();
    let waitUntil = current;

    if (this.perActionMs > 0) {
      waitUntil = Math.max(waitUntil, this.lastActionAt + this.perActionMs);
    }
    if (this.perHostMs > 0 && host) {
      const last = this.lastHostAt.get(host);
      if (last !== undefined) waitUntil = Math.max(waitUntil, last + this.perHostMs);
    }

    const waitMs = Math.max(0, waitUntil - current);
    if (waitMs > 0) await this.sleep(waitMs);

    const settled = current + waitMs;
    this.lastActionAt = settled;
    if (host) this.lastHostAt.set(host, settled);
    return waitMs;
  }
}

export function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}
