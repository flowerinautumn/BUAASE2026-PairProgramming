// Card index: 'A'=0, 'B'=1, ..., 'G'=6
function cardIndex(ch: string): i32 {
  return ch.charCodeAt(0) - 65;
}

// Count occurrences of each card (A-G) in the hand string
// Returns Int8Array(7) where index i = count of card i
function countCards(cards: string): Int8Array {
  const counts = new Int8Array(7);
  for (let i = 0; i < cards.length; i++) {
    const idx = cardIndex(cards.charAt(i));
    if (idx >= 0 && idx < 7) counts[idx]++;
  }
  return counts;
}

// Split history string into tokens; returns empty array when history is ""
function splitHistoryTokens(history: string): string[] {
  if (history.length == 0) return [];
  return history.split(' ');
}

// True iff the program must RESPOND (select) this call.
// Condition: last token starts with '3' or '4' and contains no '-'.
function isResponseTurn(history: string): bool {
  if (history.length == 0) return false;
  const tokens = splitHistoryTokens(history);
  const last = tokens[tokens.length - 1];
  const ch = last.charAt(0);
  if (ch != '3' && ch != '4') return false;
  return last.indexOf('-') == -1;
}

// Bit mask of action types already used by the given player this round.
// Bit 1 = action 1 used, bit 2 = action 2 used, bit 3 = action 3 used, bit 4 = action 4 used.
// P1 occupies token positions 0,2,4,6; P2 occupies 1,3,5,7.
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

// Pick the first k cards available in cardCounts, returns them as a string.
// Iterates A→G, takes as many of each as needed until k cards collected.
function firstAvailableCards(cardCounts: Int8Array, k: i32): string {
  let result = "";
  let remaining = k;
  for (let i = 0; i < 7 && remaining > 0; i++) {
    let take = cardCounts[i] < remaining ? cardCounts[i] : remaining;
    for (let j = 0; j < take; j++) {
      result += String.fromCharCode(65 + i);
    }
    remaining -= take;
  }
  return result;
}

// Decide and return one legal action string for the current call.
// Responds with a selection when the opponent just offered (赠予/竞争),
// otherwise plays one of the four available action types in order 1→2→3→4.
export function hanamikoji_action(history: string, cards: string, board: Int8Array): string {
  // --- Response turn: opponent just played 3 or 4 without a selection yet ---
  if (isResponseTurn(history)) {
    const tokens = splitHistoryTokens(history);
    const last = tokens[tokens.length - 1];
    if (last.charAt(0) == '3') {
      // 赠予: pick the first offered card (chars 1..3)
      return "-" + last.charAt(1);
    } else {
      // 竞争: pick group1 = chars 1..2
      return "-" + last.substring(1, 3);
    }
  }

  // --- Action turn: determine my role (P1 or P2) ---
  // Token count n is the index of the new token I'm about to place.
  // Even n → P1 acts; odd n → P2 acts.
  const tokens = splitHistoryTokens(history);
  const n: i32 = tokens.length;
  const isP1: bool = (n % 2) == 0;

  const mask: i32 = usedActionMask(history, isP1);
  const hand: Int8Array = countCards(cards);

  // Try actions 1→2→3→4 in order; pick the first unused one the hand can afford.
  for (let action: i32 = 1; action <= 4; action++) {
    const bit: i32 = 1 << (action - 1); // action 1→bit1, 2→bit2, 3→bit4, 4→bit8
    if (mask & bit) continue;           // already used this round
    if (cards.length < action) continue; // not enough cards (shouldn't happen in valid game)

    const picked = firstAvailableCards(hand, action);

    if (action == 1) {
      return "1" + picked;          // 密约: 1 card
    } else if (action == 2) {
      return "2" + picked;          // 取舍: 2 cards discarded
    } else if (action == 3) {
      return "3" + picked;          // 赠予: offer 3 cards
    } else {
      // 竞争: 4 cards, first 2 = group1, next 2 = group2
      return "4" + picked;
    }
  }

  // Fallback (should never be reached in a valid game state)
  return "1" + cards.charAt(0);
}
