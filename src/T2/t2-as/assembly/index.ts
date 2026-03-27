// Card index: 'A'=0, 'B'=1, ..., 'G'=6
function cardIndex(ch: string): i32 {
  return ch.charCodeAt(0) - 65;
}

// Add each card in `cards` string to the area counter
function addCardsToArea(area: Int8Array, cards: string): void {
  for (let i = 0; i < cards.length; i++) {
    area[cardIndex(cards.charAt(i))]++;
  }
}

// Remove the FIRST occurrence of single-char `ch` from string `s`
function removeOne(s: string, ch: string): string {
  const pos = s.indexOf(ch);
  if (pos == -1) return s;
  return s.substring(0, pos) + s.substring(pos + 1);
}

// True iff two 2-char strings represent the same multiset (order-insensitive)
function sameMultiset2(a: string, b: string): bool {
  const a0 = a.charAt(0), a1 = a.charAt(1);
  const b0 = b.charAt(0), b1 = b.charAt(1);
  return (a0 == b0 && a1 == b1) || (a0 == b1 && a1 == b0);
}

// Compute post-settlement markers into result[offset..offset+7).
// My count > opp → 1; opp > my → -1; tie → keep board[i] unchanged.
function settleMarkers(
  myArea: Int8Array,
  oppArea: Int8Array,
  board: Int8Array,
  result: Int8Array,
  offset: i32
): void {
  for (let i = 0; i < 7; i++) {
    if (myArea[i] > oppArea[i]) {
      result[offset + i] = 1;
    } else if (oppArea[i] > myArea[i]) {
      result[offset + i] = -1;
    } else {
      result[offset + i] = board[i];
    }
  }
}

// Parse one full round and return the resulting board state.
// result[0..7)  = P1 (you) card counts on table
// result[7..14) = P2 (opponent) card counts on table
// result[14..21)= post-settlement markers
export function calc_current_state(history: string, board: Int8Array): Int8Array {
  const p1Area = new Int8Array(7);
  const p2Area = new Int8Array(7);

  const tokens = history.split(' ');

  for (let turn = 0; turn < 8; turn++) {
    const token = tokens[turn];
    // Even turns (0,2,4,6) = P1 acts; odd = P2 acts
    const actingArea  = turn % 2 == 0 ? p1Area : p2Area;
    const receivingArea = turn % 2 == 0 ? p2Area : p1Area;

    const actionType = token.charAt(0);

    if (actionType == '1') {
      // 密约: acting player places 1 card in own area
      actingArea[cardIndex(token.charAt(1))]++;

    } else if (actionType == '2') {
      // 取舍: 2 cards discarded, neither area receives them

    } else if (actionType == '3') {
      // 赠予: acting player offers 3 cards, opponent picks 1
      const dash     = token.indexOf('-');
      const offered  = token.substring(1, dash);   // 3 chars
      const selected = token.substring(dash + 1);  // 1 char
      // Opponent gets the selected card
      receivingArea[cardIndex(selected)]++;
      // Acting player keeps the remaining 2 (remove exactly one selected)
      addCardsToArea(actingArea, removeOne(offered, selected));

    } else if (actionType == '4') {
      // 竞争: acting player offers group1(first 2) and group2(last 2), opponent picks one
      const dash          = token.indexOf('-');
      const allCards      = token.substring(1, dash);       // 4 chars
      const selectedGroup = token.substring(dash + 1);      // 2 chars
      const group1        = allCards.substring(0, 2);
      const group2        = allCards.substring(2, 4);
      // Opponent gets the selected group
      addCardsToArea(receivingArea, selectedGroup);
      // Acting player keeps whichever group was NOT selected
      if (sameMultiset2(selectedGroup, group1)) {
        addCardsToArea(actingArea, group2);
      } else {
        addCardsToArea(actingArea, group1);
      }
    }
  }

  const result = new Int8Array(21);
  for (let i = 0; i < 7; i++) {
    result[i]     = p1Area[i];
    result[7 + i] = p2Area[i];
  }
  settleMarkers(p1Area, p2Area, board, result, 14);

  return result;
}
