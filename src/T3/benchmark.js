/**
 * Batch benchmark for Hanamikoji T3 strategies.
 *
 * Usage:
 *   node benchmark.js [options]
 *
 * Options:
 *   -n <number>       Number of games to play (default: 50)
 *   --seed <number>   Random seed for reproducibility (default: 42)
 *   --p1 <path>       Module path for P1 (default: from .env / auto-discover)
 *   --p2 <path>       Module path for P2 (default: from .env / auto-discover)
 *   --verbose         Print per-game results
 *   --swap            Also play with swapped seats (doubles total games)
 */

import { existsSync, readFileSync } from "node:fs";
import { runSingleGame, formatWinnerLabel } from "./hanamikoji-engine.js";

// ── Seeded PRNG (xorshift128) ───────────────────────────────────────────────

function makeRng(seed) {
  let s0 = seed >>> 0 || 1;
  let s1 = (seed * 1812433253 + 1) >>> 0 || 1;
  let s2 = (s1 * 1812433253 + 1) >>> 0 || 1;
  let s3 = (s2 * 1812433253 + 1) >>> 0 || 1;
  return function next() {
    const t = s0 ^ (s0 << 11);
    s0 = s1; s1 = s2; s2 = s3;
    s3 = (s3 ^ (s3 >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
    return s3 / 4294967296;
  };
}

function makeShuffler(rng) {
  return function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
    }
  };
}

// ── CLI arg parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { n: 50, seed: 42, p1: null, p2: null, verbose: false, swap: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-n" && argv[i + 1]) { opts.n = parseInt(argv[++i], 10); }
    else if (a === "--seed" && argv[i + 1]) { opts.seed = parseInt(argv[++i], 10); }
    else if (a === "--p1" && argv[i + 1]) { opts.p1 = argv[++i]; }
    else if (a === "--p2" && argv[i + 1]) { opts.p2 = argv[++i]; }
    else if (a === "--verbose") { opts.verbose = true; }
    else if (a === "--swap") { opts.swap = true; }
  }
  return opts;
}

// ── Player loading (reuse logic from test.js) ───────────────────────────────

function loadLocalEnv() {
  const envPath = new URL("./.env", import.meta.url);
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const pos = line.indexOf("=");
    if (pos <= 0) continue;
    const key = line.slice(0, pos).trim();
    const value = line.slice(pos + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

const FALLBACK_EXPORTS = ["hanamikoji_action", "HanamikojiAction", "hanamikojiAction"];
const DEFAULT_CANDIDATES = [
  "./t3-as/build/release.js",
  "./t3-rust/pkg/t3_rust.js",
  "./t3-cpp/pkg/t3_cpp.js"
];

async function loadPlayer(label, explicitPath, envKey) {
  const candidates = [];
  if (explicitPath) candidates.push(explicitPath);
  const envVal = process.env[envKey];
  if (envVal && !candidates.includes(envVal)) candidates.push(envVal);
  for (const c of DEFAULT_CANDIDATES) {
    if (!candidates.includes(c)) candidates.push(c);
  }

  for (const modulePath of candidates) {
    try {
      const mod = await import(modulePath);
      for (const name of FALLBACK_EXPORTS) {
        if (typeof mod[name] === "function") {
          return { name: label, action: mod[name], exportName: name, modulePath };
        }
      }
    } catch { /* try next */ }
  }
  throw new Error(`Failed to load ${label}. Tried: ${candidates.join(", ")}`);
}

// ── Run benchmark ───────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);
  loadLocalEnv();

  const p1 = await loadPlayer("P1", opts.p1, "HM_P1_MODULE");
  const p2 = await loadPlayer("P2", opts.p2, "HM_P2_MODULE");
  const maxMs = Number(process.env.HM_MAX_DECISION_MS || 2000);

  console.log("=== Hanamikoji Benchmark ===");
  console.log(`P1: ${p1.modulePath} :: ${p1.exportName}`);
  console.log(`P2: ${p2.modulePath} :: ${p2.exportName}`);
  console.log(`Games: ${opts.n}${opts.swap ? ` x2 (swap seats)` : ""}  Seed: ${opts.seed}  Time limit: ${maxMs}ms`);
  console.log("");

  const configs = [{ label: "P1-first", players: [p1, p2] }];
  if (opts.swap) {
    configs.push({ label: "P2-first", players: [p2, p1] });
  }

  const totals = { p1Win: 0, p2Win: 0, draw: 0, errors: 0, games: 0, p1Time: 0, p2Time: 0 };

  for (const config of configs) {
    const rng = makeRng(opts.seed);
    const stats = { p1Win: 0, p2Win: 0, draw: 0, errors: 0 };
    const isSwapped = config.label === "P2-first";

    for (let g = 0; g < opts.n; g++) {
      const shuffle = makeShuffler(rng);

      // Suppress engine console.log during batch runs
      const origLog = console.log;
      console.log = () => {};
      let result;
      try {
        result = runSingleGame(config.players, maxMs, g % 2, { shuffleDeck: shuffle });
      } finally {
        console.log = origLog;
      }

      // Map result back to original P1/P2 perspective
      let winner; // 1 = original P1, -1 = original P2, 0 = draw
      if (result.winnerCode === 1) winner = isSwapped ? -1 : 1;
      else if (result.winnerCode === -1) winner = isSwapped ? 1 : -1;
      else winner = 0;

      const isError = result.reason?.endBy === "invalid";
      if (isError) stats.errors++;

      if (winner === 1) stats.p1Win++;
      else if (winner === -1) stats.p2Win++;
      else stats.draw++;

      // Accumulate time from original perspective
      const t0 = isSwapped ? result.timeSpent[1] : result.timeSpent[0];
      const t1 = isSwapped ? result.timeSpent[0] : result.timeSpent[1];
      totals.p1Time += t0;
      totals.p2Time += t1;

      if (opts.verbose) {
        const w = winner === 1 ? "P1" : winner === -1 ? "P2" : "Draw";
        const err = isError ? " [ERROR]" : "";
        origLog(`  Game ${g + 1}: ${w}  (${result.timeSpent[0].toFixed(1)}ms / ${result.timeSpent[1].toFixed(1)}ms)${err}`);
      }
    }

    totals.p1Win += stats.p1Win;
    totals.p2Win += stats.p2Win;
    totals.draw += stats.draw;
    totals.errors += stats.errors;
    totals.games += opts.n;

    const total = opts.n;
    console.log(`[${config.label}] ${total} games: P1 ${stats.p1Win}W / P2 ${stats.p2Win}W / ${stats.draw}D` +
      (stats.errors ? ` (${stats.errors} errors)` : ""));
  }

  // Summary
  console.log("");
  console.log("=== Summary ===");
  console.log(`Total games:  ${totals.games}`);
  console.log(`P1 wins:      ${totals.p1Win}  (${(totals.p1Win / totals.games * 100).toFixed(1)}%)`);
  console.log(`P2 wins:      ${totals.p2Win}  (${(totals.p2Win / totals.games * 100).toFixed(1)}%)`);
  console.log(`Draws:        ${totals.draw}  (${(totals.draw / totals.games * 100).toFixed(1)}%)`);
  console.log(`Errors:       ${totals.errors}`);
  console.log(`Avg time P1:  ${(totals.p1Time / totals.games).toFixed(2)}ms / game`);
  console.log(`Avg time P2:  ${(totals.p2Time / totals.games).toFixed(2)}ms / game`);
}

main().catch(err => { console.error(err); process.exit(1); });
