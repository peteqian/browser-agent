/**
 * Human-like input synthesis: curved mouse paths, variable typing cadence.
 * Bot detectors score teleporting cursors and 0ms inter-key intervals; this
 * module generates the noisy trajectories real input hardware produces.
 *
 * Opt-in via `humanize` on the browser profile. The challenge watchdog always
 * uses humanized clicks regardless, since challenge widgets are exactly where
 * input timing is scored.
 */

export interface HumanizeConfig {
  /** Curved mouse movement before clicks. Default: true. */
  mouse?: boolean;
  /** Variable inter-key delays while typing. Default: true. */
  typing?: boolean;
  /**
   * Delay scale. 1 = realistic human speed, 0 = no delays (paths and key
   * events still dispatched — useful for tests). Default: 1.
   */
  speed?: number;
  /** RNG seed for reproducible trajectories. Default: nondeterministic. */
  seed?: number;
}

export type HumanizeInit = boolean | HumanizeConfig;

export interface ResolvedHumanize {
  mouse: boolean;
  typing: boolean;
  speed: number;
  rng: () => number;
}

/** mulberry32 — small deterministic PRNG so tests can pin trajectories. */
export function createRng(seed?: number): () => number {
  let state = (seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function resolveHumanize(init?: HumanizeInit): ResolvedHumanize | null {
  if (init === undefined || init === false) return null;
  const config = init === true ? {} : init;
  return {
    mouse: config.mouse ?? true,
    typing: config.typing ?? true,
    speed: config.speed ?? 1,
    rng: createRng(config.seed),
  };
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Cubic-bezier path from `from` to `to` with randomized control points and
 * per-step jitter. Step count scales with distance so short hops stay cheap.
 */
export function mousePathPoints(from: Point, to: Point, rng: () => number): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 2) return [to];

  // Control points offset perpendicular to the line, like a wrist arc.
  const arc = Math.min(distance * 0.25, 80);
  const perpX = (-dy / distance) * arc;
  const perpY = (dx / distance) * arc;
  const bend1 = (rng() - 0.5) * 2;
  const bend2 = (rng() - 0.5) * 2;
  const c1 = { x: from.x + dx * 0.3 + perpX * bend1, y: from.y + dy * 0.3 + perpY * bend1 };
  const c2 = { x: from.x + dx * 0.7 + perpX * bend2, y: from.y + dy * 0.7 + perpY * bend2 };

  const steps = Math.max(6, Math.min(28, Math.round(distance / 25)));
  const points: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x;
    const y = u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y;
    // Sub-pixel hand tremor everywhere except the landing point.
    const jitter = i === steps ? 0 : (rng() - 0.5) * 2;
    points.push({ x: Math.round(x + jitter), y: Math.round(y + jitter) });
  }
  const last = points[points.length - 1]!;
  last.x = Math.round(to.x);
  last.y = Math.round(to.y);
  return points;
}

/** Per-step pause while tracing a mouse path. Eases out near the target. */
export function mouseStepDelayMs(
  stepIndex: number,
  totalSteps: number,
  speed: number,
  rng: () => number,
): number {
  if (speed <= 0) return 0;
  const progress = stepIndex / totalSteps;
  const ease = 0.6 + 0.8 * progress * progress; // decelerate into the target
  return Math.round((4 + rng() * 8) * ease * speed);
}

/** Pause between mouse-down and mouse-up — humans hold ~50-150ms. */
export function clickHoldDelayMs(speed: number, rng: () => number): number {
  if (speed <= 0) return 0;
  return Math.round((50 + rng() * 90) * speed);
}

/**
 * Inter-key delays for `text`. Mostly 40-120ms with occasional longer
 * "thinking" pauses after spaces/punctuation, the cadence keystroke-dynamics
 * checks expect.
 */
export function typingDelaysMs(text: string, speed: number, rng: () => number): number[] {
  const chars = Array.from(text);
  return chars.map((char, i) => {
    if (speed <= 0) return 0;
    let base = 40 + rng() * 80;
    const prev = i > 0 ? chars[i - 1] : "";
    if (prev === " " || prev === "." || prev === ",") base += rng() * 120;
    if (rng() < 0.04) base += 150 + rng() * 250; // occasional hesitation
    return Math.round(base * speed);
  });
}
