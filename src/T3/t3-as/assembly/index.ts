// Card index: 'A'=0, 'B'=1, ..., 'G'=6
function cardIndex(ch: string): i32 {
  return ch.charCodeAt(0) - 65;
}

// Count occurrences of each card (A-G) in the hand string
function countCards(cards: string): Int8Array {
  const counts = new Int8Array(7);
  for (let i = 0; i < cards.length; i++) {
    const idx = cardIndex(cards.charAt(i));
    if (idx >= 0 && idx < 7) counts[idx]++;
  }
  return counts;
}

// Split history string into tokens
function splitHistoryTokens(history: string): string[] {
  if (history.length == 0) return [];
  return history.split(' ');
}

// True iff the program must RESPOND (select) this call.
function isResponseTurn(history: string): bool {
  if (history.length == 0) return false;
  const tokens = splitHistoryTokens(history);
  const last = tokens[tokens.length - 1];
  const ch = last.charAt(0);
  if (ch != '3' && ch != '4') return false;
  return last.indexOf('-') == -1;
}

// Bit mask of action types already used by the given player this round.
function usedActionMask(history: string, isP1: bool): i32 {
  if (history.length == 0) return 0;
  const tokens = splitHistoryTokens(history);
  let mask: i32 = 0;
  const start: i32 = isP1 ? 0 : 1;
  for (let i = start; i < tokens.length; i += 2) {
    const ch = tokens[i].charAt(0);
    if (ch == '1') mask |= 1;
    else if (ch == '2') mask |= 2;
    else if (ch == '3') mask |= 4;
    else if (ch == '4') mask |= 8;
  }
  return mask;
}

// Hanamikoji point value for a card at index i
// A,B,C=2; D,E=3; F=4; G=5
function cardScore(idx: i32): i32 {
  if (idx <= 2) return 2;
  if (idx <= 4) return 3;
  if (idx == 5) return 4;
  return 5;
}

// Total cards in the game for each geisha: A,B,C=2; D,E=3; F=4; G=5
function totalCardsForGeisha(idx: i32): i32 {
  return cardScore(idx); // conveniently same as point value
}

// Compute importance score for each geisha based on board state and current round.
// Uses marginal gain from placing one more card there, so it is naturally
// margin-aware and round-count-aware.
function computeGeishaImportance(board: Int8Array, hand: Int8Array, roundCounts: Int8Array): Float64Array {
  const importance = new Float64Array(7);
  const myPlaced = new Int8Array(7);
  const oppPlaced = new Int8Array(7);
  for (let i = 0; i < 7; i++) {
    myPlaced[i] = roundCounts[i];
    oppPlaced[i] = roundCounts[7 + i];
  }

  const baseScore = evaluatePosition(myPlaced, oppPlaced, board);

  for (let i = 0; i < 7; i++) {
    const pts: f64 = f64(cardScore(i));
    const boardVal: i32 = i32(board[i]);
    const myCards: i32 = i32(hand[i]);
    const myPlacedHere: i32 = i32(myPlaced[i]);
    const oppPlacedHere: i32 = i32(oppPlaced[i]);
    const total: i32 = totalCardsForGeisha(i);
    let rem: i32 = total - myPlacedHere - oppPlacedHere;
    if (rem < 0) rem = 0;

    const simMy = new Int8Array(7);
    for (let j = 0; j < 7; j++) simMy[j] = myPlaced[j];
    simMy[i]++;
    const delta = evaluatePosition(simMy, oppPlaced, board) - baseScore;

    let value = pts * 0.15 + delta * 1.4;
    if (boardVal < 0) value += pts * 0.2;
    else if (boardVal == 0) value += pts * 0.08;

    if (rem <= 1) value += pts * 0.25;
    else if (rem == 2) value += pts * 0.12;

    if (myCards > 0) value += f64(myCards) * 0.15;

    if (myPlacedHere - oppPlacedHere > rem && boardVal >= 0) {
      value *= 0.35; // already essentially secured
    } else if (oppPlacedHere - myPlacedHere > rem && boardVal <= 0) {
      value *= myCards > 0 ? 0.55 : 0.25; // very hard to flip
    }

    importance[i] = value;
  }

  return importance;
}

// Evaluate a single card's strategic value based on geisha importance
function cardStrategicValue(idx: i32, importance: Float64Array): f64 {
  return importance[idx];
}

// ─── Opponent Inference ─────────────────────────────────────────────────────

// Track which cards the opponent has publicly played (visible in history).
// Cards marked as 'X' are hidden (opponent's action 1 secret and action 2 discards).
function getOpponentPublicCards(history: string, isP1: bool): Int8Array {
  const oppCards = new Int8Array(7);
  if (history.length == 0) return oppCards;
  const tokens = splitHistoryTokens(history);
  const oppStart: i32 = isP1 ? 1 : 0;
  for (let i = oppStart; i < tokens.length; i += 2) {
    const token = tokens[i];
    // Parse the full token which may include a response suffix like "3ABC-A"
    const dashPos = token.indexOf('-');
    const mainPart = dashPos >= 0 ? token.substring(0, dashPos) : token;
    const actionType = mainPart.charAt(0);

    // For action 3 and 4, the cards are visible
    if (actionType == '3' || actionType == '4') {
      for (let j = 1; j < mainPart.length; j++) {
        const ch = mainPart.charAt(j);
        if (ch != 'X') {
          const ci = cardIndex(ch);
          if (ci >= 0 && ci < 7) oppCards[ci]++;
        }
      }
    }
    // Action 1 and 2 from opponent show as 'X', skip those
  }
  return oppCards;
}

// Estimate opponent's remaining hand strength per geisha.
// Returns rough count of cards opponent might still hold for each geisha.
function estimateOpponentRemaining(hand: Int8Array, oppPublic: Int8Array): Int8Array {
  const remaining = new Int8Array(7);
  for (let i = 0; i < 7; i++) {
    // total cards - my cards - opponent's known public cards = unknown pool
    const total = totalCardsForGeisha(i);
    const unknown = total - i32(hand[i]) - i32(oppPublic[i]);
    // Opponent likely holds some fraction; 1 card is removed from game each round
    remaining[i] = i8(unknown > 0 ? unknown : 0);
  }
  return remaining;
}

// ─── Round Card Count Extraction ───────────────────────────────────────────

// Extract per-geisha card counts committed in the current round from history.
// Returns 14-element Int8Array: [0..6] = my placed cards, [7..13] = opp placed cards.
// Only counts completed actions (with responses for action 3/4). Uses only public info.
function extractRoundCardCounts(history: string, isP1: bool): Int8Array {
  const counts = new Int8Array(14);
  if (history.length == 0) return counts;
  const tokens = splitHistoryTokens(history);

  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t];
    const isMyToken: bool = isP1 ? (t % 2 == 0) : (t % 2 == 1);
    const dashPos = token.indexOf('-');
    const actionType = token.charAt(0);

    // Actions 3/4 need a response (dash) to be complete
    if ((actionType == '3' || actionType == '4') && dashPos == -1) continue;

    if (actionType == '1') {
      // Secret: card goes to actor (only known if not 'X')
      const card = token.charAt(1);
      if (card != 'X') {
        const ci = cardIndex(card);
        if (ci >= 0 && ci < 7) {
          if (isMyToken) counts[ci]++;
          else counts[7 + ci]++;
        }
      }
    } else if (actionType == '2') {
      // Discard: removed from game, count for nobody
    } else if (actionType == '3') {
      const mainPart = token.substring(0, dashPos);
      const picked = token.substring(dashPos + 1);
      const offered = mainPart.substring(1);

      // Mark which offered positions are picked by responder
      const used = new Int8Array(offered.length);
      for (let r = 0; r < picked.length; r++) {
        const pi = cardIndex(picked.charAt(r));
        for (let o = 0; o < offered.length; o++) {
          if (used[o] == 0 && offered.charAt(o) != 'X' && cardIndex(offered.charAt(o)) == pi) {
            used[o] = 1;
            if (isMyToken) counts[7 + pi]++;  // opponent is responder
            else counts[pi]++;                 // I am responder
            break;
          }
        }
      }
      // Actor keeps the non-picked cards
      for (let o = 0; o < offered.length; o++) {
        if (used[o] == 0 && offered.charAt(o) != 'X') {
          const ci = cardIndex(offered.charAt(o));
          if (ci >= 0 && ci < 7) {
            if (isMyToken) counts[ci]++;
            else counts[7 + ci]++;
          }
        }
      }
    } else if (actionType == '4') {
      const mainPart = token.substring(0, dashPos);
      const pickedGroup = token.substring(dashPos + 1);
      const allCards = mainPart.substring(1);
      const group1 = allCards.substring(0, 2);
      const group2 = allCards.substring(2, 4);

      // Determine which group was picked (use sorted comparison for robustness)
      const sortedPicked = sortString(pickedGroup);
      const actorGroup = sortString(group1) == sortedPicked ? group2 : group1;

      // Responder gets the picked cards
      for (let r = 0; r < pickedGroup.length; r++) {
        const ch = pickedGroup.charAt(r);
        if (ch != 'X') {
          const ci = cardIndex(ch);
          if (ci >= 0 && ci < 7) {
            if (isMyToken) counts[7 + ci]++;
            else counts[ci]++;
          }
        }
      }
      // Actor gets the other group
      for (let r = 0; r < actorGroup.length; r++) {
        const ch = actorGroup.charAt(r);
        if (ch != 'X') {
          const ci = cardIndex(ch);
          if (ci >= 0 && ci < 7) {
            if (isMyToken) counts[ci]++;
            else counts[7 + ci]++;
          }
        }
      }
    }
  }

  return counts;
}

// ─── Card Selection Helpers ─────────────────────────────────────────────────

// Sort card indices by a score array (ascending). Returns sorted indices of cards in hand.
function sortedCardIndicesByScore(hand: Int8Array, scores: Float64Array, ascending: bool): i32[] {
  // Build flat list of card indices (one entry per card copy)
  const indices: i32[] = [];
  for (let i = 0; i < 7; i++) {
    for (let j: i32 = 0; j < i32(hand[i]); j++) {
      indices.push(i);
    }
  }
  // Simple insertion sort by score
  for (let i = 1; i < indices.length; i++) {
    const key = indices[i];
    let j = i - 1;
    while (j >= 0) {
      const cmp = scores[indices[j]] - scores[key];
      const shouldSwap = ascending ? cmp > 0.0 : cmp < 0.0;
      if (!shouldSwap) break;
      indices[j + 1] = indices[j];
      j--;
    }
    indices[j + 1] = key;
  }
  return indices;
}

// Pick n cards with lowest strategic value
function pickLeastImportantN(hand: Int8Array, importance: Float64Array, n: i32): string {
  const sorted = sortedCardIndicesByScore(hand, importance, true); // ascending = least important first
  let result = "";
  const count = n < sorted.length ? n : sorted.length;
  for (let i = 0; i < count; i++) {
    result += String.fromCharCode(65 + sorted[i]);
  }
  // Sort alphabetically for consistent output
  return sortString(result);
}

// Pick n cards with highest strategic value
function pickMostImportantN(hand: Int8Array, importance: Float64Array, n: i32): string {
  const sorted = sortedCardIndicesByScore(hand, importance, false); // descending = most important first
  let result = "";
  const count = n < sorted.length ? n : sorted.length;
  for (let i = 0; i < count; i++) {
    result += String.fromCharCode(65 + sorted[i]);
  }
  return sortString(result);
}

// Sort a string's characters alphabetically
function sortString(s: string): string {
  const arr: i32[] = [];
  for (let i = 0; i < s.length; i++) arr.push(s.charCodeAt(i));
  arr.sort();
  let result = "";
  for (let i = 0; i < arr.length; i++) result += String.fromCharCode(arr[i]);
  return result;
}

function buildCardPool(hand: Int8Array): i32[] {
  const pool: i32[] = [];
  for (let i = 0; i < 7; i++) {
    for (let j: i32 = 0; j < i32(hand[i]); j++) {
      pool.push(i);
    }
  }
  return pool;
}

function pushUniqueAction(actions: string[], action: string): void {
  for (let i = 0; i < actions.length; i++) {
    if (actions[i] == action) return;
  }
  actions.push(action);
}

function canonicalCompeteAction(g1a: i32, g1b: i32, g2a: i32, g2b: i32): string {
  let group1 = sortString(String.fromCharCode(65 + g1a) + String.fromCharCode(65 + g1b));
  let group2 = sortString(String.fromCharCode(65 + g2a) + String.fromCharCode(65 + g2b));
  if (group2 < group1) {
    const tmp = group1;
    group1 = group2;
    group2 = tmp;
  }
  return "4" + group1 + group2;
}

function enumerateLegalActions(hand: Int8Array, mask: i32): string[] {
  const actions: string[] = [];
  const pool = buildCardPool(hand);
  const pLen: i32 = pool.length;

  if ((mask & 1) == 0 && pLen >= 1) {
    for (let i = 0; i < 7; i++) {
      if (hand[i] > 0) pushUniqueAction(actions, "1" + String.fromCharCode(65 + i));
    }
  }

  if ((mask & 2) == 0 && pLen >= 2) {
    for (let a = 0; a < pLen - 1; a++) {
      for (let b = a + 1; b < pLen; b++) {
        const cards = sortString(String.fromCharCode(65 + pool[a]) + String.fromCharCode(65 + pool[b]));
        pushUniqueAction(actions, "2" + cards);
      }
    }
  }

  if ((mask & 4) == 0 && pLen >= 3) {
    for (let a = 0; a < pLen - 2; a++) {
      for (let b = a + 1; b < pLen - 1; b++) {
        for (let c = b + 1; c < pLen; c++) {
          const cards = sortString(
            String.fromCharCode(65 + pool[a]) + String.fromCharCode(65 + pool[b]) + String.fromCharCode(65 + pool[c])
          );
          pushUniqueAction(actions, "3" + cards);
        }
      }
    }
  }

  if ((mask & 8) == 0 && pLen >= 4) {
    for (let a = 0; a < pLen - 3; a++) {
      for (let b = a + 1; b < pLen - 2; b++) {
        for (let c = b + 1; c < pLen - 1; c++) {
          for (let d = c + 1; d < pLen; d++) {
            const c0 = pool[a]; const c1 = pool[b];
            const c2 = pool[c]; const c3 = pool[d];
            pushUniqueAction(actions, canonicalCompeteAction(c0, c1, c2, c3));
            pushUniqueAction(actions, canonicalCompeteAction(c0, c2, c1, c3));
            pushUniqueAction(actions, canonicalCompeteAction(c0, c3, c1, c2));
          }
        }
      }
    }
  }

  return actions;
}

function importanceTieBreak(action: string, importance: Float64Array): f64 {
  const type = action.charAt(0);
  if (type == '1') return importance[cardIndex(action.charAt(1))];
  if (type == '2') {
    return -(importance[cardIndex(action.charAt(1))] + importance[cardIndex(action.charAt(2))]);
  }
  if (type == '3') {
    const a = importance[cardIndex(action.charAt(1))];
    const b = importance[cardIndex(action.charAt(2))];
    const c = importance[cardIndex(action.charAt(3))];
    let worstCase = b + c;
    if (a + c < worstCase) worstCase = a + c;
    if (a + b < worstCase) worstCase = a + b;
    return worstCase;
  }

  const sum1 = importance[cardIndex(action.charAt(1))] + importance[cardIndex(action.charAt(2))];
  const sum2 = importance[cardIndex(action.charAt(3))] + importance[cardIndex(action.charAt(4))];
  return sum1 < sum2 ? sum1 : sum2;
}

// ─── Action Strategies ──────────────────────────────────────────────────────

// Action 1 (密约/Secret): Hide 1 card — pick the most strategically valuable card
// Rationale: this card is guaranteed to count for us, so save the most important one
function strategySecret(hand: Int8Array, importance: Float64Array): string {
  return "1" + pickMostImportantN(hand, importance, 1);
}

// Action 2 (取舍/Discard): Remove 2 cards — discard the least important cards
// Rationale: minimize loss by removing cards that don't help the current board situation
function strategyDiscard(hand: Int8Array, importance: Float64Array): string {
  return "2" + pickLeastImportantN(hand, importance, 2);
}

// Action 3 (赠予/Gift): Offer 3 cards to opponent (they pick 1, we keep 2)
// Minimax strategy: enumerate all 3-card subsets from hand (at most C(7,3)=35).
// For each candidate offer, assume opponent picks the card with highest importance
// (worst case for us). Evaluate by the importance sum of the 2 cards we keep.
// Choose the offer that maximizes our worst-case retained value.
function strategyGift(hand: Int8Array, importance: Float64Array): string {
  // Build flat list of card indices from hand (one entry per copy)
  const pool: i32[] = [];
  for (let i = 0; i < 7; i++) {
    for (let j: i32 = 0; j < i32(hand[i]); j++) {
      pool.push(i);
    }
  }

  // Fallback: not enough cards for meaningful enumeration
  if (pool.length <= 3) {
    let result = "";
    for (let i = 0; i < pool.length; i++) result += String.fromCharCode(65 + pool[i]);
    return "3" + sortString(result);
  }

  let bestScore: f64 = -999999.0;
  let bestA: i32 = 0;
  let bestB: i32 = 1;
  let bestC: i32 = 2;

  // Enumerate all C(pool.length, 3) combinations via triple loop
  const pLen: i32 = pool.length;
  for (let a = 0; a < pLen - 2; a++) {
    for (let b = a + 1; b < pLen - 1; b++) {
      for (let c = b + 1; c < pLen; c++) {
        const c0 = pool[a];
        const c1 = pool[b];
        const c2 = pool[c];

        // Opponent picks the card with highest importance (worst case for us)
        const imp0 = importance[c0];
        const imp1 = importance[c1];
        const imp2 = importance[c2];

        // We keep the other 2; compute retained importance for each opponent choice
        const retain0 = imp1 + imp2; // opponent takes c0, we keep c1+c2
        const retain1 = imp0 + imp2; // opponent takes c1, we keep c0+c2
        const retain2 = imp0 + imp1; // opponent takes c2, we keep c0+c1

        // Worst case: opponent picks the one that minimizes our retained value
        let worstCase = retain0;
        if (retain1 < worstCase) worstCase = retain1;
        if (retain2 < worstCase) worstCase = retain2;

        if (worstCase > bestScore) {
          bestScore = worstCase;
          bestA = a;
          bestB = b;
          bestC = c;
        }
      }
    }
  }

  const result = String.fromCharCode(65 + pool[bestA])
    + String.fromCharCode(65 + pool[bestB])
    + String.fromCharCode(65 + pool[bestC]);
  return "3" + sortString(result);
}

// Action 4 (竞争/Compete): Split 4 cards into 2 groups of 2, opponent picks a group.
// Minimax strategy: enumerate all C(hand,4) four-card candidates (≤35) and for each
// try all 3 possible 2-2 splits. Assume opponent takes the higher-value group (worst
// case for us). Score = value of the group we keep, penalizing splits that hand the
// opponent a single high-importance card.
function strategyCompete(hand: Int8Array, importance: Float64Array): string {
  // Build flat list of card indices from hand (one entry per copy)
  const pool: i32[] = [];
  for (let i = 0; i < 7; i++) {
    for (let j: i32 = 0; j < i32(hand[i]); j++) {
      pool.push(i);
    }
  }

  // Fallback: not enough cards
  if (pool.length < 4) {
    let result = "";
    for (let i = 0; i < pool.length; i++) result += String.fromCharCode(65 + pool[i]);
    return "4" + sortString(result);
  }

  let bestScore: f64 = -999999.0;
  let bestG1a: i32 = pool[0];
  let bestG1b: i32 = pool[1];
  let bestG2a: i32 = pool[2];
  let bestG2b: i32 = pool[3];

  const pLen: i32 = pool.length;

  // Enumerate all C(pLen, 4) four-card candidates
  for (let a = 0; a < pLen - 3; a++) {
    for (let b = a + 1; b < pLen - 2; b++) {
      for (let c = b + 1; c < pLen - 1; c++) {
        for (let d = c + 1; d < pLen; d++) {
          const c0 = pool[a]; const c1 = pool[b];
          const c2 = pool[c]; const c3 = pool[d];
          const i0 = importance[c0]; const i1 = importance[c1];
          const i2 = importance[c2]; const i3 = importance[c3];

          // Try all 3 splits. For each:
          //   mySum  = importance of group we keep (opponent takes higher-sum group)
          //   oppMax = max single-card importance in opponent's group
          //   score  = mySum - 0.25 * oppMax (penalize handing opponent a key card)

          let sum1: f64; let sum2: f64;
          let mySum: f64; let oppMax: f64;
          let g1a: i32; let g1b: i32; let g2a: i32; let g2b: i32;
          let score: f64;

          // Split 0: {c0,c1} vs {c2,c3}
          sum1 = i0 + i1; sum2 = i2 + i3;
          if (sum1 <= sum2) {
            mySum = sum1; oppMax = i2 > i3 ? i2 : i3;
            g1a = c0; g1b = c1; g2a = c2; g2b = c3;
          } else {
            mySum = sum2; oppMax = i0 > i1 ? i0 : i1;
            g1a = c2; g1b = c3; g2a = c0; g2b = c1;
          }
          score = mySum - 0.25 * oppMax;
          if (score > bestScore) {
            bestScore = score;
            bestG1a = g1a; bestG1b = g1b; bestG2a = g2a; bestG2b = g2b;
          }

          // Split 1: {c0,c2} vs {c1,c3}
          sum1 = i0 + i2; sum2 = i1 + i3;
          if (sum1 <= sum2) {
            mySum = sum1; oppMax = i1 > i3 ? i1 : i3;
            g1a = c0; g1b = c2; g2a = c1; g2b = c3;
          } else {
            mySum = sum2; oppMax = i0 > i2 ? i0 : i2;
            g1a = c1; g1b = c3; g2a = c0; g2b = c2;
          }
          score = mySum - 0.25 * oppMax;
          if (score > bestScore) {
            bestScore = score;
            bestG1a = g1a; bestG1b = g1b; bestG2a = g2a; bestG2b = g2b;
          }

          // Split 2: {c0,c3} vs {c1,c2}
          sum1 = i0 + i3; sum2 = i1 + i2;
          if (sum1 <= sum2) {
            mySum = sum1; oppMax = i1 > i2 ? i1 : i2;
            g1a = c0; g1b = c3; g2a = c1; g2b = c2;
          } else {
            mySum = sum2; oppMax = i0 > i3 ? i0 : i3;
            g1a = c1; g1b = c2; g2a = c0; g2b = c3;
          }
          score = mySum - 0.25 * oppMax;
          if (score > bestScore) {
            bestScore = score;
            bestG1a = g1a; bestG1b = g1b; bestG2a = g2a; bestG2b = g2b;
          }
        }
      }
    }
  }

  // Output: "4" + group1(2 sorted chars) + group2(2 sorted chars)
  const group1 = sortString(String.fromCharCode(65 + bestG1a) + String.fromCharCode(65 + bestG1b));
  const group2 = sortString(String.fromCharCode(65 + bestG2a) + String.fromCharCode(65 + bestG2b));
  return "4" + group1 + group2;
}

// ─── Response Strategies ────────────────────────────────────────────────────

// Response to 赠予 (action 3): opponent offers 3 cards, we pick 1.
// Choose by simulated resulting position.
function respondGift(offered: string, roundCounts: Int8Array, board: Int8Array, importance: Float64Array): string {
  const baseMy = new Int8Array(7);
  const baseOpp = new Int8Array(7);
  for (let i = 0; i < 7; i++) {
    baseMy[i] = roundCounts[i];
    baseOpp[i] = roundCounts[7 + i];
  }

  let bestIdx: i32 = -1;
  let bestScore: f64 = -999999.0;
  let bestTie: f64 = -999999.0;
  for (let i = 0; i < offered.length; i++) {
    const idx = cardIndex(offered.charAt(i));
    const simMy = new Int8Array(7);
    const simOpp = new Int8Array(7);
    for (let j = 0; j < 7; j++) {
      simMy[j] = baseMy[j];
      simOpp[j] = baseOpp[j];
    }

    simMy[idx]++;
    for (let k = 0; k < offered.length; k++) {
      if (k != i) simOpp[cardIndex(offered.charAt(k))]++;
    }

    const score = evaluatePosition(simMy, simOpp, board);
    const tie = importance[idx];
    if (score > bestScore || (score == bestScore && tie > bestTie)) {
      bestScore = score;
      bestTie = tie;
      bestIdx = idx;
    }
  }
  return "-" + (bestIdx >= 0 ? String.fromCharCode(65 + bestIdx) : offered.charAt(0));
}

// Response to 竞争 (action 4): opponent offers 2 groups of 2, we pick one.
// Choose by simulated resulting position.
function respondCompete(group1: string, group2: string, roundCounts: Int8Array, board: Int8Array, importance: Float64Array): string {
  const baseMy = new Int8Array(7);
  const baseOpp = new Int8Array(7);
  for (let i = 0; i < 7; i++) {
    baseMy[i] = roundCounts[i];
    baseOpp[i] = roundCounts[7 + i];
  }

  const simMy1 = new Int8Array(7);
  const simOpp1 = new Int8Array(7);
  const simMy2 = new Int8Array(7);
  const simOpp2 = new Int8Array(7);
  for (let i = 0; i < 7; i++) {
    simMy1[i] = baseMy[i]; simOpp1[i] = baseOpp[i];
    simMy2[i] = baseMy[i]; simOpp2[i] = baseOpp[i];
  }

  for (let i = 0; i < group1.length; i++) simMy1[cardIndex(group1.charAt(i))]++;
  for (let i = 0; i < group2.length; i++) simOpp1[cardIndex(group2.charAt(i))]++;

  for (let i = 0; i < group2.length; i++) simMy2[cardIndex(group2.charAt(i))]++;
  for (let i = 0; i < group1.length; i++) simOpp2[cardIndex(group1.charAt(i))]++;

  const score1 = evaluatePosition(simMy1, simOpp1, board);
  const score2 = evaluatePosition(simMy2, simOpp2, board);

  let tie1: f64 = 0.0;
  let tie2: f64 = 0.0;
  for (let i = 0; i < group1.length; i++) tie1 += importance[cardIndex(group1.charAt(i))];
  for (let i = 0; i < group2.length; i++) tie2 += importance[cardIndex(group2.charAt(i))];

  return "-" + (score1 > score2 || (score1 == score2 && tie1 >= tie2) ? group1 : group2);
}

// ─── Position Evaluation & Action Scoring ───────────────────────────────────

// Evaluate a board position from placed card counts.
// Returns a score from our perspective (positive = good for us).
// Uses confidence-weighted margins: large leads on geishas with few remaining
// cards score higher than narrow leads with many cards unplayed.
function evaluatePosition(myPlaced: Int8Array, oppPlaced: Int8Array, board: Int8Array): f64 {
  let score: f64 = 0;
  for (let i = 0; i < 7; i++) {
    const pts: f64 = f64(cardScore(i));
    const my: i32 = i32(myPlaced[i]);
    const opp: i32 = i32(oppPlaced[i]);
    const total: i32 = totalCardsForGeisha(i);
    const bv: i32 = i32(board[i]);
    let rem: i32 = total - my - opp;
    if (rem < 0) rem = 0;
    const margin: i32 = my - opp;

    if (margin > 0) {
      if (margin > rem) {
        // Guaranteed win: full credit, extra for flipping/claiming
        score += bv <= 0 ? pts * 1.5 : pts * 1.0;
      } else {
        // Winning but not locked: confidence = margin / (margin + remaining)
        const conf: f64 = f64(margin) / f64(margin + rem);
        score += pts * conf * (bv <= 0 ? 1.3 : 1.0);
      }
    } else if (margin < 0) {
      const absMargin: i32 = -margin;
      if (absMargin > rem) {
        // Guaranteed loss
        score -= bv >= 0 ? pts * 1.5 : pts * 1.0;
      } else {
        const conf: f64 = f64(absMargin) / f64(absMargin + rem);
        score -= pts * conf * (bv >= 0 ? 1.3 : 1.0);
      }
    } else if (my > 0) {
      // Tied with cards placed: marker stays with previous holder
      if (bv > 0) score += pts * 0.15;
      else if (bv < 0) score -= pts * 0.15;
    }
  }

  // ─── Global threshold adjustment (lightweight, continuous) ────────────────
  // Win condition: ≥4 geisha markers OR ≥11 points.
  // Accumulate soft win probability per geisha, then apply small continuous bonus.
  let myProb: f64 = 0.0;   // soft count of geishas I'm likely to hold
  let oppProb: f64 = 0.0;
  let myPtsProb: f64 = 0.0;  // soft expected points
  let oppPtsProb: f64 = 0.0;
  for (let i = 0; i < 7; i++) {
    const pts2: f64 = f64(cardScore(i));
    const my2: i32 = i32(myPlaced[i]);
    const opp2: i32 = i32(oppPlaced[i]);
    const total2: i32 = totalCardsForGeisha(i);
    const bv2: i32 = i32(board[i]);
    let rem2: i32 = total2 - my2 - opp2;
    if (rem2 < 0) rem2 = 0;
    const margin2: i32 = my2 - opp2;

    // Only locked (margin > remaining) counts as 1.0
    if (margin2 > rem2) {
      myProb += 1.0;
      myPtsProb += pts2;
    } else if (-margin2 > rem2) {
      oppProb += 1.0;
      oppPtsProb += pts2;
    } else if (rem2 == 0 && margin2 == 0 && my2 > 0) {
      // Tied and locked — marker holder keeps
      if (bv2 > 0) { myProb += 1.0; myPtsProb += pts2; }
      else if (bv2 < 0) { oppProb += 1.0; oppPtsProb += pts2; }
    }
    // Non-locked positions: no contribution to global counts
    // (their value is already captured in the per-geisha score above)
  }

  // Small continuous bonus based on proximity to win thresholds
  // Geisha count: gentle ramp as we approach 4
  if (myProb >= 4.0) {
    score += 1.5;
  } else if (myProb >= 3.0) {
    score += (myProb - 2.0) * 0.4; // 3.0→0.4
  }
  if (oppProb >= 4.0) {
    score -= 1.5;
  } else if (oppProb >= 3.0) {
    score -= (oppProb - 2.0) * 0.4;
  }

  // Point total: gentle ramp as we approach 11
  if (myPtsProb >= 11.0) {
    score += 1.2;
  } else if (myPtsProb >= 8.0) {
    score += (myPtsProb - 8.0) * 0.15; // 8→0, 9→0.15, 10→0.3
  }
  if (oppPtsProb >= 11.0) {
    score -= 1.2;
  } else if (oppPtsProb >= 8.0) {
    score -= (oppPtsProb - 8.0) * 0.15;
  }

  return score;
}

// Evaluate position with hand-reachability adjustment.
// Accounts for whether we still hold cards to reinforce contested geishas.
function evaluatePositionWithReachability(myPlaced: Int8Array, oppPlaced: Int8Array, board: Int8Array, myHand: Int8Array): f64 {
  let score = evaluatePosition(myPlaced, oppPlaced, board);
  for (let i = 0; i < 7; i++) {
    const pts: f64 = f64(cardScore(i));
    const my: i32 = i32(myPlaced[i]);
    const opp: i32 = i32(oppPlaced[i]);
    const total: i32 = totalCardsForGeisha(i);
    let rem: i32 = total - my - opp;
    if (rem < 0) rem = 0;
    if (rem == 0) continue; // outcome locked, no adjustment
    const margin: i32 = my - opp;
    const myCards: i32 = i32(myHand[i]);
    const bv: i32 = i32(board[i]);

    if (myCards == 0) {
      // Can't contribute more — penalize if outcome is still contested
      if (margin <= 0 && bv <= 0) {
        score -= pts * 0.12; // behind/tied with no cards to catch up
      } else if (margin > 0 && margin <= rem) {
        score -= pts * 0.06; // ahead but can't defend the lead
      }
    } else if (margin <= 0 && bv <= 0) {
      // Behind but we have cards to catch up — slight boost
      score += f64(myCards) * pts * 0.04;
    }
  }
  return score;
}

// Score a candidate action by simulating its effect on the board position.
// For actions 3/4, evaluates the worst-case opponent choice.
function scoreAction(action: string, roundCounts: Int8Array, board: Int8Array, hand: Int8Array): f64 {
  // Baseline: current placed counts
  const baseMy = new Int8Array(7);
  const baseOpp = new Int8Array(7);
  for (let i = 0; i < 7; i++) {
    baseMy[i] = roundCounts[i];
    baseOpp[i] = roundCounts[7 + i];
  }

  // Compute remaining hand after this action (cards not consumed by this action)
  const remainingHand = new Int8Array(7);
  for (let i = 0; i < 7; i++) remainingHand[i] = hand[i];
  for (let k = 1; k < action.length; k++) {
    const ci = cardIndex(action.charAt(k));
    if (ci >= 0 && ci < 7 && remainingHand[ci] > 0) remainingHand[ci]--;
  }

  const type = action.charAt(0);

  if (type == '1') {
    // Secret: I gain this card, opponent gets nothing
    const simMy = new Int8Array(7);
    for (let i = 0; i < 7; i++) simMy[i] = baseMy[i];
    simMy[cardIndex(action.charAt(1))]++;
    return evaluatePositionWithReachability(simMy, baseOpp, board, remainingHand);
  }

  if (type == '2') {
    // Discard: position unchanged, but we lose future potential from these cards
    let penalty: f64 = 0.0;
    for (let k = 1; k < action.length; k++) {
      const idx = cardIndex(action.charAt(k));
      const pts: f64 = f64(cardScore(idx));
      const my: i32 = i32(baseMy[idx]);
      const opp: i32 = i32(baseOpp[idx]);
      const total: i32 = totalCardsForGeisha(idx);
      let rem: i32 = total - my - opp;
      if (rem < 0) rem = 0;
      const margin: i32 = my - opp;
      const bv: i32 = i32(board[idx]);

      if (margin > rem) {
        // Already locked win — discarding is free, no penalty
      } else if (margin <= 0 && bv <= 0) {
        // Behind or tied on opponent's geisha — hurts catch-up potential
        penalty += pts * 0.25;
      } else if (margin <= 0 && bv > 0) {
        // Behind but we hold the marker — moderate penalty
        penalty += pts * 0.15;
      } else if (margin > 0 && margin <= rem) {
        // Ahead but not locked — weakens defense
        penalty += pts * 0.12;
      }
    }
    return evaluatePositionWithReachability(baseMy, baseOpp, board, remainingHand) - penalty;
  }

  if (type == '3') {
    // Gift: simulate all 3 opponent picks, return worst case
    const offered = action.substring(1);
    let worstScore: f64 = 999999.0;
    for (let pick = 0; pick < offered.length; pick++) {
      const simMy = new Int8Array(7);
      const simOpp = new Int8Array(7);
      for (let i = 0; i < 7; i++) { simMy[i] = baseMy[i]; simOpp[i] = baseOpp[i]; }
      simOpp[cardIndex(offered.charAt(pick))]++;
      for (let k = 0; k < offered.length; k++) {
        if (k != pick) simMy[cardIndex(offered.charAt(k))]++;
      }
      const s = evaluatePositionWithReachability(simMy, simOpp, board, remainingHand);
      if (s < worstScore) worstScore = s;
    }
    return worstScore;
  }

  // Compete: simulate both opponent group choices, return worst case
  const g1a = cardIndex(action.charAt(1));
  const g1b = cardIndex(action.charAt(2));
  const g2a = cardIndex(action.charAt(3));
  const g2b = cardIndex(action.charAt(4));

  const simMy1 = new Int8Array(7); const simOpp1 = new Int8Array(7);
  for (let i = 0; i < 7; i++) { simMy1[i] = baseMy[i]; simOpp1[i] = baseOpp[i]; }
  simOpp1[g1a]++; simOpp1[g1b]++;
  simMy1[g2a]++; simMy1[g2b]++;
  const s1 = evaluatePositionWithReachability(simMy1, simOpp1, board, remainingHand);

  const simMy2 = new Int8Array(7); const simOpp2 = new Int8Array(7);
  for (let i = 0; i < 7; i++) { simMy2[i] = baseMy[i]; simOpp2[i] = baseOpp[i]; }
  simOpp2[g2a]++; simOpp2[g2b]++;
  simMy2[g1a]++; simMy2[g1b]++;
  const s2 = evaluatePositionWithReachability(simMy2, simOpp2, board, remainingHand);

  return s1 < s2 ? s1 : s2;
}

// ─── Action Priority ────────────────────────────────────────────────────────

// Decide which action to use based on current game state.
// Priority logic:
//   - Early in round (more cards): prefer gift/compete (interactive, less loss)
//   - Late in round (fewer cards): prefer secret/discard (targeted, decisive)
//   - With strong hand (many high-importance cards): prefer secret (lock in value)
//   - With weak hand: prefer discard (minimize damage)
function chooseActionOrder(hand: Int8Array, importance: Float64Array, cardsLen: i32, mask: i32): i32[] {
  // Count how many high-importance cards we have
  let highImportanceCount: i32 = 0;
  let totalImportance: f64 = 0.0;
  for (let i = 0; i < 7; i++) {
    if (hand[i] > 0) {
      totalImportance += importance[i] * f64(hand[i]);
      if (importance[i] > 3.0) highImportanceCount += i32(hand[i]);
    }
  }

  const avgImportance: f64 = cardsLen > 0 ? totalImportance / f64(cardsLen) : 0.0;

  // Build priority order based on situation
  const order: i32[] = [];

  if (cardsLen >= 6) {
    // Early game: lots of cards — use interactive actions first
    // Gift and Compete when we have many cards gives us more flexibility
    if (highImportanceCount >= 2) {
      // Strong hand: secret the best card first, then gift/compete with expendables
      order.push(1); // secret — lock in our best card
      order.push(3); // gift — offer least important 3
      order.push(4); // compete — split least important 4
      order.push(2); // discard — drop remaining low-value
    } else {
      // Weaker hand: discard weak cards early, save secret for later
      order.push(2); // discard the weakest early
      order.push(3); // gift — force opponent into bad choice
      order.push(4); // compete
      order.push(1); // secret last surviving card
    }
  } else if (cardsLen >= 4) {
    // Mid game
    if (avgImportance > 2.5) {
      order.push(1); order.push(4); order.push(3); order.push(2);
    } else {
      order.push(2); order.push(4); order.push(3); order.push(1);
    }
  } else {
    // Late game: few cards left, must use whatever action remains
    order.push(1); order.push(2); order.push(3); order.push(4);
  }

  return order;
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

export function hanamikoji_action(history: string, cards: string, board: Int8Array): string {
  const hand: Int8Array = countCards(cards);
  const tokens = splitHistoryTokens(history);
  const n: i32 = tokens.length;
  const isP1: bool = (n % 2) == 0;
  const roundCounts = extractRoundCardCounts(history, isP1);

  // Compute geisha importance based on board state, current margins, and round counts
  const importance = computeGeishaImportance(board, hand, roundCounts);

  // Factor in opponent info: boost importance for contested geisha
  const oppPublic = getOpponentPublicCards(history, isP1);
  const oppRemaining = estimateOpponentRemaining(hand, oppPublic);
  for (let i = 0; i < 7; i++) {
    // If opponent might still contest a neutral geisha, it's more important
    if (board[i] == 0 && oppRemaining[i] > 0 && hand[i] > 0) {
      importance[i] += f64(cardScore(i)) * 0.3;
    }
    // If we can decisively win a geisha (we have more remaining), boost it
    if (board[i] == 0 && hand[i] > i8(oppRemaining[i])) {
      importance[i] += f64(cardScore(i)) * 0.2;
    }
  }

  // --- Response turn ---
  if (isResponseTurn(history)) {
    const last = tokens[tokens.length - 1];
    if (last.charAt(0) == '3') {
      return respondGift(last.substring(1), roundCounts, board, importance);
    } else {
      const group1 = last.substring(1, 3);
      const group2 = last.substring(3, 5);
      return respondCompete(group1, group2, roundCounts, board, importance);
    }
  }

  // --- Action turn ---
  const mask: i32 = usedActionMask(history, isP1);

  const legalActions = enumerateLegalActions(hand, mask);
  let bestAction = "";
  let bestScore: f64 = -999999.0;
  let bestTie: f64 = -999999.0;
  for (let i = 0; i < legalActions.length; i++) {
    const action = legalActions[i];
    const score = scoreAction(action, roundCounts, board, hand);
    const tie = importanceTieBreak(action, importance);
    if (score > bestScore || (score == bestScore && tie > bestTie)) {
      bestScore = score;
      bestTie = tie;
      bestAction = action;
    }
  }

  if (bestAction.length > 0) {
    return bestAction;
  }

  // Fallback: should not reach here in normal play
  return "1" + cards.charAt(0);
}
