/**
 * Random legal-action baseline player for Hanamikoji.
 * Always picks a uniformly random legal action (active) or response.
 * No strategy — purely for benchmarking against.
 */

// ── History parsing ─────────────────────────────────────────────────────────

function splitTokens(history) {
  if (!history || history.length === 0) return [];
  return history.split(" ");
}

function isResponseTurn(history) {
  const tokens = splitTokens(history);
  if (tokens.length === 0) return false;
  const last = tokens[tokens.length - 1];
  const ch = last[0];
  return (ch === "3" || ch === "4") && !last.includes("-");
}

function usedActionMask(history) {
  const tokens = splitTokens(history);
  // When called on our active turn, token count parity tells us our position:
  // even count → we're the first actor (our tokens at 0,2,4,...)
  // odd count  → we're the second actor (our tokens at 1,3,5,...)
  const start = tokens.length % 2 === 0 ? 0 : 1;
  let mask = 0;
  for (let i = start; i < tokens.length; i += 2) {
    const ch = tokens[i][0];
    if (ch === "1") mask |= 1;
    else if (ch === "2") mask |= 2;
    else if (ch === "3") mask |= 4;
    else if (ch === "4") mask |= 8;
  }
  return mask;
}

// ── Random helpers ──────────────────────────────────────────────────────────

function randInt(n) {
  return Math.floor(Math.random() * n);
}

function pickRandom(arr) {
  return arr[randInt(arr.length)];
}

// ── Card pool utilities ─────────────────────────────────────────────────────

function buildPool(cards) {
  // cards is a sorted string like "AABBCDE"
  return cards.split("");
}

function combinations(pool, k) {
  // Generate all unique k-combinations from pool (which may have duplicates).
  // Returns array of sorted strings.
  const results = new Set();
  const n = pool.length;
  if (k === 1) {
    for (const c of pool) results.add(c);
    return [...results];
  }
  if (k === 2) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const combo = [pool[i], pool[j]].sort().join("");
        results.add(combo);
      }
    }
    return [...results];
  }
  if (k === 3) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        for (let l = j + 1; l < n; l++) {
          const combo = [pool[i], pool[j], pool[l]].sort().join("");
          results.add(combo);
        }
      }
    }
    return [...results];
  }
  if (k === 4) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        for (let l = j + 1; l < n; l++) {
          for (let m = l + 1; m < n; m++) {
            const combo = [pool[i], pool[j], pool[l], pool[m]].sort().join("");
            results.add(combo);
          }
        }
      }
    }
    return [...results];
  }
  return [];
}

// ── Action enumeration ──────────────────────────────────────────────────────

function enumerateActions(cards, mask) {
  const pool = buildPool(cards);
  const actions = [];

  // Action 1: secret — pick 1 card
  if (!(mask & 1) && pool.length >= 1) {
    for (const combo of combinations(pool, 1)) {
      actions.push("1" + combo);
    }
  }

  // Action 2: discard — pick 2 cards
  if (!(mask & 2) && pool.length >= 2) {
    for (const combo of combinations(pool, 2)) {
      actions.push("2" + combo);
    }
  }

  // Action 3: gift — pick 3 cards
  if (!(mask & 4) && pool.length >= 3) {
    for (const combo of combinations(pool, 3)) {
      actions.push("3" + combo);
    }
  }

  // Action 4: compete — pick 4 cards, split into 2 groups of 2
  if (!(mask & 8) && pool.length >= 4) {
    const quads = combinations(pool, 4);
    const seen = new Set();
    for (const quad of quads) {
      const chars = quad.split("");
      // All ways to split 4 into 2+2 (there are 3 pairings)
      const splits = [
        [[0, 1], [2, 3]],
        [[0, 2], [1, 3]],
        [[0, 3], [1, 2]]
      ];
      for (const [g1idx, g2idx] of splits) {
        let g1 = [chars[g1idx[0]], chars[g1idx[1]]].sort().join("");
        let g2 = [chars[g2idx[0]], chars[g2idx[1]]].sort().join("");
        // Canonical: smaller group first
        if (g2 < g1) { const tmp = g1; g1 = g2; g2 = tmp; }
        const key = "4" + g1 + g2;
        if (!seen.has(key)) {
          seen.add(key);
          actions.push(key);
        }
      }
    }
  }

  return actions;
}

// ── Main export ─────────────────────────────────────────────────────────────

export function hanamikoji_action(history, cards, board) {
  // Response turn
  if (isResponseTurn(history)) {
    const tokens = splitTokens(history);
    const last = tokens[tokens.length - 1];

    if (last[0] === "3") {
      // Gift response: pick 1 from offered 3
      const offered = last.substring(1);
      const pick = offered[randInt(offered.length)];
      return "-" + pick;
    } else {
      // Compete response: pick one of two groups
      const allCards = last.substring(1);
      const group1 = allCards.substring(0, 2);
      const group2 = allCards.substring(2, 4);
      return "-" + (Math.random() < 0.5 ? group1 : group2);
    }
  }

  // Active turn: enumerate all legal actions and pick one at random
  const mask = usedActionMask(history);
  const actions = enumerateActions(cards, mask);

  if (actions.length === 0) {
    // Fallback (should not happen in normal play)
    return "1" + cards[0];
  }

  return pickRandom(actions);
}
