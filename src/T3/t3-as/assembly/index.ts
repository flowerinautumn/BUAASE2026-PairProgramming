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

// ─── Board Analysis ─────────────────────────────────────────────────────────

// Compute importance score for each geisha based on board state.
// Higher score = more strategically important to contest.
// board[i]: >0 = my control, <0 = opponent control, 0 = neutral
function computeGeishaImportance(board: Int8Array, hand: Int8Array): Float64Array {
  const importance = new Float64Array(7);
  for (let i = 0; i < 7; i++) {
    const pts: f64 = f64(cardScore(i));
    const boardVal: i32 = i32(board[i]);
    const myCards: i32 = i32(hand[i]);

    if (boardVal > 0) {
      // I control this geisha — defend if I have cards, low priority otherwise
      importance[i] = pts * 0.3 + (myCards > 0 ? pts * 0.2 : 0.0);
    } else if (boardVal < 0) {
      // Opponent controls — high priority to flip if I have cards to contest
      importance[i] = myCards > 0 ? pts * 1.5 : pts * 0.1;
    } else {
      // Neutral — valuable to claim, especially high-point geisha
      importance[i] = pts * 1.0 + (myCards > 0 ? pts * 0.5 : 0.0);
    }
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

// Response to 赠予 (action 3): opponent offers 3 cards, we pick 1
// Strategy: pick the card with highest strategic importance, not just highest raw value
function respondGift(offered: string, importance: Float64Array): string {
  let bestIdx: i32 = -1;
  let bestScore: f64 = -1.0;
  for (let i = 0; i < offered.length; i++) {
    const idx = cardIndex(offered.charAt(i));
    const score = importance[idx];
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  }
  return "-" + (bestIdx >= 0 ? String.fromCharCode(65 + bestIdx) : offered.charAt(0));
}

// Response to 竞争 (action 4): opponent offers 2 groups of 2, we pick one
// Strategy: pick the group with higher total strategic importance
function respondCompete(group1: string, group2: string, importance: Float64Array): string {
  let score1: f64 = 0.0;
  let score2: f64 = 0.0;
  for (let i = 0; i < group1.length; i++) score1 += importance[cardIndex(group1.charAt(i))];
  for (let i = 0; i < group2.length; i++) score2 += importance[cardIndex(group2.charAt(i))];
  return "-" + (score1 >= score2 ? group1 : group2);
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

  // Compute geisha importance based on board state and hand
  const importance = computeGeishaImportance(board, hand);

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
      // 赠予 response: pick the most strategically important card
      return respondGift(last.substring(1), importance);
    } else {
      // 竞争 response: pick the group with higher strategic value
      const group1 = last.substring(1, 3);
      const group2 = last.substring(3, 5);
      return respondCompete(group1, group2, importance);
    }
  }

  // --- Action turn ---
  const mask: i32 = usedActionMask(history, isP1);

  // Get action priority order based on current situation
  const actionOrder = chooseActionOrder(hand, importance, cards.length, mask);

  for (let idx = 0; idx < actionOrder.length; idx++) {
    const action = actionOrder[idx];
    const bit: i32 = 1 << (action - 1);
    if (mask & bit) continue;          // already used
    if (cards.length < action) continue; // not enough cards

    if (action == 1) {
      return strategySecret(hand, importance);
    } else if (action == 2) {
      return strategyDiscard(hand, importance);
    } else if (action == 3) {
      return strategyGift(hand, importance);
    } else {
      return strategyCompete(hand, importance);
    }
  }

  // Fallback: should not reach here in normal play
  return "1" + cards.charAt(0);
}
