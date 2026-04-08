/**
 * Greedy baseline player for Hanamikoji.
 *
 * Uses simple board-aware card values to make one-step greedy decisions.
 * Stronger than random, but much simpler than the main AI strategy.
 * Intended as a mid-tier benchmark opponent.
 */

// ── Constants ──────────────────────────────────────────────────────────────

const CARD_SCORE = [2, 2, 2, 3, 3, 4, 5]; // A-G

function cardIndex(ch) {
  return ch.charCodeAt(0) - 65;
}

// Effective value of a card, adjusted by board state.
// board[i]: +1 = we hold geisha, -1 = opponent holds, 0 = neutral.
function effectiveValue(idx, board) {
  const base = CARD_SCORE[idx];
  const bv = board[idx];
  if (bv < 0) return base * 1.4;  // opponent holds — more urgent to contest
  if (bv > 0) return base * 0.6;  // we hold — less urgent
  return base;
}

// ── History parsing (same as random-player) ────────────────────────────────

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

// ── Combinatorics ──────────────────────────────────────────────────────────

function combinations(pool, k) {
  const results = new Set();
  const n = pool.length;
  if (k === 1) {
    for (const c of pool) results.add(c);
    return [...results];
  }
  if (k === 2) {
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        results.add([pool[i], pool[j]].sort().join(""));
    return [...results];
  }
  if (k === 3) {
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        for (let l = j + 1; l < n; l++)
          results.add([pool[i], pool[j], pool[l]].sort().join(""));
    return [...results];
  }
  if (k === 4) {
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        for (let l = j + 1; l < n; l++)
          for (let m = l + 1; m < n; m++)
            results.add([pool[i], pool[j], pool[l], pool[m]].sort().join(""));
    return [...results];
  }
  return [];
}

// ── Action scoring ─────────────────────────────────────────────────────────

function scoreSecret(cards, board) {
  // Keep the card — value = effective value of the card kept
  return effectiveValue(cardIndex(cards), board);
}

function scoreDiscard(cards, board) {
  // Discard these cards — lower value discarded is better.
  // Score = negative of total effective value lost.
  let lost = 0;
  for (const ch of cards) lost += effectiveValue(cardIndex(ch), board);
  return -lost;
}

function scoreGift(cards, board) {
  // Offer 3 cards; opponent picks the best one (greedy opponent model).
  // We keep the other 2. Score = sum of our 2 kept cards in worst case.
  const vals = [];
  for (const ch of cards) vals.push(effectiveValue(cardIndex(ch), board));
  vals.sort((a, b) => a - b);
  // Worst case: opponent takes the most valuable (vals[2]), we keep vals[0]+vals[1]
  return vals[0] + vals[1];
}

function scoreCompete(cards, board) {
  // 4 cards split into 2 groups of 2. Opponent picks the better group.
  // Enumerate all 3 ways to split, pick the split that maximises our worst-case group.
  const c = cards.split("");
  const splits = [
    [[0, 1], [2, 3]],
    [[0, 2], [1, 3]],
    [[0, 3], [1, 2]]
  ];
  let bestWorst = -Infinity;
  for (const [g1i, g2i] of splits) {
    const v1 = effectiveValue(cardIndex(c[g1i[0]]), board) + effectiveValue(cardIndex(c[g1i[1]]), board);
    const v2 = effectiveValue(cardIndex(c[g2i[0]]), board) + effectiveValue(cardIndex(c[g2i[1]]), board);
    const worst = Math.min(v1, v2); // opponent takes the better group
    if (worst > bestWorst) bestWorst = worst;
  }
  return bestWorst;
}

// ── Action enumeration & selection ─────────────────────────────────────────

function enumerateAndScore(cards, mask, board) {
  const pool = cards.split("");
  const scored = []; // { action, score }

  // Action 1
  if (!(mask & 1) && pool.length >= 1) {
    for (const combo of combinations(pool, 1)) {
      scored.push({ action: "1" + combo, score: scoreSecret(combo, board) });
    }
  }

  // Action 2
  if (!(mask & 2) && pool.length >= 2) {
    for (const combo of combinations(pool, 2)) {
      scored.push({ action: "2" + combo, score: scoreDiscard(combo, board) });
    }
  }

  // Action 3
  if (!(mask & 4) && pool.length >= 3) {
    for (const combo of combinations(pool, 3)) {
      scored.push({ action: "3" + combo, score: scoreGift(combo, board) });
    }
  }

  // Action 4
  if (!(mask & 8) && pool.length >= 4) {
    const quads = combinations(pool, 4);
    const seen = new Set();
    for (const quad of quads) {
      const chars = quad.split("");
      const splits = [
        [[0, 1], [2, 3]],
        [[0, 2], [1, 3]],
        [[0, 3], [1, 2]]
      ];
      for (const [g1i, g2i] of splits) {
        let g1 = [chars[g1i[0]], chars[g1i[1]]].sort().join("");
        let g2 = [chars[g2i[0]], chars[g2i[1]]].sort().join("");
        if (g2 < g1) { const tmp = g1; g1 = g2; g2 = tmp; }
        const key = "4" + g1 + g2;
        if (!seen.has(key)) {
          seen.add(key);
          scored.push({ action: key, score: scoreCompete(g1 + g2, board) });
        }
      }
    }
  }

  return scored;
}

// ── Main export ────────────────────────────────────────────────────────────

export function hanamikoji_action(history, cards, board) {
  // Response turn
  if (isResponseTurn(history)) {
    const tokens = splitTokens(history);
    const last = tokens[tokens.length - 1];

    if (last[0] === "3") {
      // Gift response: pick the highest effective-value card
      const offered = last.substring(1);
      let bestPick = offered[0];
      let bestVal = -Infinity;
      for (let i = 0; i < offered.length; i++) {
        const v = effectiveValue(cardIndex(offered[i]), board);
        if (v > bestVal) { bestVal = v; bestPick = offered[i]; }
      }
      return "-" + bestPick;
    } else {
      // Compete response: pick the group with higher total effective value
      const allCards = last.substring(1);
      const group1 = allCards.substring(0, 2);
      const group2 = allCards.substring(2, 4);
      const v1 = effectiveValue(cardIndex(group1[0]), board) + effectiveValue(cardIndex(group1[1]), board);
      const v2 = effectiveValue(cardIndex(group2[0]), board) + effectiveValue(cardIndex(group2[1]), board);
      return "-" + (v1 >= v2 ? group1 : group2);
    }
  }

  // Active turn
  const mask = usedActionMask(history);
  const scored = enumerateAndScore(cards, mask, board);

  if (scored.length === 0) {
    return "1" + cards[0];
  }

  // Pick the action with the highest score
  let best = scored[0];
  for (let i = 1; i < scored.length; i++) {
    if (scored[i].score > best.score) best = scored[i];
  }
  return best.action;
}
