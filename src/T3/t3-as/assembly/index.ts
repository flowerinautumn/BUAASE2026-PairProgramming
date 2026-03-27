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

// Hanamikoji point value for a card at index i
function cardScore(idx: i32): i32 {
  if (idx <= 2) return 2;  // A, B, C
  if (idx <= 4) return 3;  // D, E
  if (idx == 5) return 4;  // F
  return 5;                // G
}

// Pick 1 highest-value card; scan G→A
function pickHighest1(cardCounts: Int8Array): string {
  for (let i = 6; i >= 0; i--) {
    if (cardCounts[i] > 0) return String.fromCharCode(65 + i);
  }
  return "";
}

// Pick n lowest-value cards; scan A→G (result ascending by construction)
function pickLowestN(cardCounts: Int8Array, n: i32): string {
  let result = "";
  let remaining = n;
  for (let i = 0; i < 7 && remaining > 0; i++) {
    const take = cardCounts[i] < remaining ? cardCounts[i] : remaining;
    for (let j = 0; j < take; j++) result += String.fromCharCode(65 + i);
    remaining -= take;
  }
  return result;
}

// Pick 4 cards for 竞争 and arrange as group1(min+max) ++ group2(mid1+mid2).
// Picks the 4 lowest-value cards from hand; s is sorted ascending.
function pickCompete4(cardCounts: Int8Array): string {
  const s = pickLowestN(cardCounts, 4);
  if (s.length < 4) return s;
  // s: [min, mid1, mid2, max] → group1 = min+max, group2 = mid1+mid2
  return s.charAt(0) + s.charAt(3) + s.charAt(1) + s.charAt(2);
}

// Pick the lowest-value card from an offered string (response to 赠予)
function pickLowestFromOffered(offered: string): string {
  let bestIdx = 7;
  for (let i = 0; i < offered.length; i++) {
    const idx = cardIndex(offered.charAt(i));
    if (idx < bestIdx) bestIdx = idx;
  }
  return bestIdx < 7 ? String.fromCharCode(65 + bestIdx) : offered.charAt(0);
}

// Total point value of a card-group string
function groupScore(group: string): i32 {
  let s = 0;
  for (let i = 0; i < group.length; i++) s += cardScore(cardIndex(group.charAt(i)));
  return s;
}

// Decide and return one legal action string for the current call.
export function hanamikoji_action(history: string, cards: string, board: Int8Array): string {
  // --- Response turn: opponent just played 3 or 4 without a selection yet ---
  if (isResponseTurn(history)) {
    const tokens = splitHistoryTokens(history);
    const last = tokens[tokens.length - 1];
    if (last.charAt(0) == '3') {
      // 赠予: pick the lowest-value card from the 3 offered
      return "-" + pickLowestFromOffered(last.substring(1));
    } else {
      // 竞争: pick the group with the lower total value
      const group1 = last.substring(1, 3);
      const group2 = last.substring(3, 5);
      return "-" + (groupScore(group1) <= groupScore(group2) ? group1 : group2);
    }
  }

  // --- Action turn ---
  const tokens = splitHistoryTokens(history);
  const n: i32 = tokens.length;
  const isP1: bool = (n % 2) == 0;

  const mask: i32 = usedActionMask(history, isP1);
  const hand: Int8Array = countCards(cards);

  for (let action: i32 = 1; action <= 4; action++) {
    const bit: i32 = 1 << (action - 1);
    if (mask & bit) continue;
    if (cards.length < action) continue;

    if (action == 1) {
      // 密约: keep the highest-value card for ourselves
      return "1" + pickHighest1(hand);
    } else if (action == 2) {
      // 取舍: discard the two lowest-value cards
      return "2" + pickLowestN(hand, 2);
    } else if (action == 3) {
      // 赠予: offer the three lowest-value cards (sorted ascending)
      return "3" + pickLowestN(hand, 3);
    } else {
      // 竞争: group1 = min+max, group2 = mid1+mid2
      return "4" + pickCompete4(hand);
    }
  }

  return "1" + cards.charAt(0);
}
