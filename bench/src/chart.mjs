#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

// Apple-HIG dark palette.
const C = {
  bg: "#000000",
  title: "#f5f5f7",
  subtitle: "#a1a1a6",
  muted: "#8e8e93",
  axis: "#3a3a3c",
  grid: "#1c1c1e",
  track: "#1c1c1e",
  blueOurs: "#0a84ff",
  greyOthers: "#636366",
};

const load = (p) => {
  const raw = JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
  return raw.bundle ?? raw;
};

function svgHeader(w, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <style>
    .root { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif; }
    .title { font-size: 22px; font-weight: 700; fill: ${C.title}; letter-spacing: -0.012em; }
    .subtitle { font-size: 13px; font-weight: 400; fill: ${C.subtitle}; }
    .axis-label { font-size: 12px; font-weight: 500; fill: ${C.muted}; font-variant-numeric: tabular-nums; }
    .bar-label { font-size: 13px; font-weight: 600; fill: ${C.title}; }
    .bar-sub { font-size: 11px; font-weight: 400; fill: ${C.muted}; }
    .bar-value { font-size: 16px; font-weight: 600; fill: ${C.title}; font-variant-numeric: tabular-nums; }
    .footnote { font-size: 11px; font-weight: 400; fill: ${C.muted}; }
    text { dominant-baseline: middle; }
  </style>
  <rect width="${w}" height="${h}" fill="${C.bg}"/>`;
}

/**
 * Vertical bar chart with x+y axes and subtle gridlines.
 * @param opts.bars { label, sub?, value, color }
 * @param opts.yMax max y-axis value (rounded)
 * @param opts.yUnit suffix string for y-axis labels ('' or '%')
 * @param opts.yStep tick step
 */
function verticalBarChart(opts) {
  const W = 880;
  const H = 460;
  const padL = 80;
  const padR = 40;
  const padT = 100;
  const padB = 90;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const { bars, yMax, yStep, yUnit = "", title, subtitle, footer } = opts;

  let body = "";

  // Title + subtitle
  body += `\n  <text x="${padL}" y="44" class="title">${title}</text>`;
  if (subtitle) body += `\n  <text x="${padL}" y="68" class="subtitle">${subtitle}</text>`;

  // Y-axis line
  body += `\n  <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="${C.axis}" stroke-width="1"/>`;
  // X-axis line
  body += `\n  <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="${C.axis}" stroke-width="1"/>`;

  // Y ticks + gridlines
  for (let v = 0; v <= yMax; v += yStep) {
    const y = padT + plotH - (v / yMax) * plotH;
    body += `\n  <line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="${C.grid}" stroke-width="1"/>`;
    body += `\n  <text x="${padL - 12}" y="${y}" text-anchor="end" class="axis-label">${v}${yUnit}</text>`;
  }

  // Bars
  const slotW = plotW / bars.length;
  const barW = Math.min(80, slotW * 0.55);
  bars.forEach((b, i) => {
    const cx = padL + slotW * (i + 0.5);
    const h = (b.value / yMax) * plotH;
    const x = cx - barW / 2;
    const y = padT + plotH - h;
    body += `\n  <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="6" fill="${b.color}"/>`;
    // value above bar
    body += `\n  <text x="${cx}" y="${y - 14}" text-anchor="middle" class="bar-value">${b.display ?? b.value}${yUnit}</text>`;
    // x-axis label
    body += `\n  <text x="${cx}" y="${padT + plotH + 22}" text-anchor="middle" class="bar-label">${b.label}</text>`;
    if (b.sub)
      body += `\n  <text x="${cx}" y="${padT + plotH + 40}" text-anchor="middle" class="bar-sub">${b.sub}</text>`;
  });

  if (footer) body += `\n  <text x="${padL}" y="${H - 18}" class="footnote">${footer}</text>`;

  return `${svgHeader(W, H)}\n  <g class="root">${body}\n  </g>\n</svg>\n`;
}

// Grouped vertical bar chart (passed vs attempted per category)
function groupedBarChart(opts) {
  const W = 880;
  const H = 460;
  const padL = 70;
  const padR = 40;
  const padT = 100;
  const padB = 100;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const { groups, seriesNames, seriesColors, yMax, yStep, title, subtitle, footer } = opts;

  let body = "";
  body += `\n  <text x="${padL}" y="44" class="title">${title}</text>`;
  if (subtitle) body += `\n  <text x="${padL}" y="68" class="subtitle">${subtitle}</text>`;

  body += `\n  <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="${C.axis}" stroke-width="1"/>`;
  body += `\n  <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="${C.axis}" stroke-width="1"/>`;

  for (let v = 0; v <= yMax; v += yStep) {
    const y = padT + plotH - (v / yMax) * plotH;
    body += `\n  <line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="${C.grid}" stroke-width="1"/>`;
    body += `\n  <text x="${padL - 12}" y="${y}" text-anchor="end" class="axis-label">${v}</text>`;
  }

  const slotW = plotW / groups.length;
  const groupGap = 6;
  const barW = (slotW * 0.5) / seriesNames.length;
  groups.forEach((g, gi) => {
    const center = padL + slotW * (gi + 0.5);
    seriesNames.forEach((sn, si) => {
      const v = g.values[si];
      const totalW = barW * seriesNames.length + groupGap * (seriesNames.length - 1);
      const offset = -totalW / 2 + si * (barW + groupGap);
      const x = center + offset;
      const h = (v / yMax) * plotH;
      const y = padT + plotH - h;
      body += `\n  <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="4" fill="${seriesColors[si]}"/>`;
    });
    body += `\n  <text x="${center}" y="${padT + plotH + 22}" text-anchor="middle" class="bar-label">${g.label}</text>`;
    if (g.sub)
      body += `\n  <text x="${center}" y="${padT + plotH + 40}" text-anchor="middle" class="bar-sub">${g.sub}</text>`;
  });

  // Legend
  const legendY = padT - 30;
  let legendX = padL + plotW;
  for (let i = seriesNames.length - 1; i >= 0; i -= 1) {
    const w = 14;
    legendX -= 8 + seriesNames[i].length * 7 + w + 8;
    body += `\n  <rect x="${legendX}" y="${legendY - 6}" width="${w}" height="12" rx="3" fill="${seriesColors[i]}"/>`;
    body += `\n  <text x="${legendX + w + 6}" y="${legendY}" class="bar-label">${seriesNames[i]}</text>`;
  }

  if (footer) body += `\n  <text x="${padL}" y="${H - 18}" class="footnote">${footer}</text>`;
  return `${svgHeader(W, H)}\n  <g class="root">${body}\n  </g>\n</svg>\n`;
}

// Load bundles
const peteqian = load("bench/results/v1.published.json");
let bu = null;
try {
  bu = load("bench/results/browser-use-ollama.published.json");
} catch {}

const passed = (b) => b.records.filter((r) => r.judgement.verdict).length;
const passPct = (b) => Math.round((passed(b) / b.records.length) * 1000) / 10;
const avgSteps = (b) =>
  Math.round((b.records.reduce((s, r) => s + (r.steps ?? 0), 0) / b.records.length) * 10) / 10;

// --- Leaderboard (pass-rate %) ---
{
  const bars = [
    {
      label: "browser-agent",
      sub: "codex SDK",
      value: passPct(peteqian),
      color: C.blueOurs,
      display: `${passed(peteqian)}/${peteqian.records.length}`,
    },
  ];
  if (bu)
    bars.push({
      label: "browser-use",
      sub: "0.11.7 · gemma4:31b-cloud",
      value: passPct(bu),
      color: C.greyOthers,
      display: `${passed(bu)}/${bu.records.length}`,
    });

  const svg = verticalBarChart({
    title: "Pass-rate, 10-task browser benchmark",
    subtitle: `Same tasks. Same judge (${peteqian.judge_model}). Cold browser per task.`,
    bars,
    yMax: 100,
    yStep: 25,
    yUnit: "%",
    footer: "Higher is better. Bar value shows tasks passed of attempted.",
  });
  writeFileSync(resolve(ROOT, "bench/results/leaderboard.svg"), svg);
  console.error("wrote bench/results/leaderboard.svg");
}

// --- Steps (avg per task, lower better) ---
{
  const bars = [
    {
      label: "browser-agent",
      sub: "codex SDK",
      value: avgSteps(peteqian),
      color: C.blueOurs,
    },
  ];
  if (bu)
    bars.push({
      label: "browser-use",
      sub: "0.11.7",
      value: avgSteps(bu),
      color: C.greyOthers,
    });

  const svg = verticalBarChart({
    title: "Average steps per task",
    subtitle: "Lower is more efficient. Same task list, same judge.",
    bars,
    yMax: 12,
    yStep: 2,
    yUnit: "",
    footer: "Stable-handle locators (testid → role+name → label) keep each task tight.",
  });
  writeFileSync(resolve(ROOT, "bench/results/steps.svg"), svg);
  console.error("wrote bench/results/steps.svg");
}

// --- Category breakdown (passed vs attempted per category) ---
{
  const cats = {};
  for (const r of peteqian.records) {
    const c = (cats[r.category] ??= { passed: 0, attempted: 0 });
    c.attempted += 1;
    if (r.judgement.verdict) c.passed += 1;
  }
  const groups = Object.entries(cats)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([label, c]) => ({ label, sub: "", values: [c.passed, c.attempted] }));

  const svg = groupedBarChart({
    title: "Pass-rate by category",
    subtitle: "@peteqian/browser-agent",
    groups,
    seriesNames: ["passed", "attempted"],
    seriesColors: [C.blueOurs, C.greyOthers],
    yMax: 2,
    yStep: 1,
    footer: "Five categories × two tasks. Full per-task verdicts in bench/results/.",
  });
  writeFileSync(resolve(ROOT, "bench/results/category.svg"), svg);
  console.error("wrote bench/results/category.svg");
}
