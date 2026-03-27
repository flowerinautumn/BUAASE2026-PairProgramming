// hanamikoji_judge: determine the win/loss state after a round's settlement.
//
// board: Int8Array(7), indices 0..6 correspond to markers A B C D E F G
//   1  = marker belongs to you
//  -1  = marker belongs to opponent
//   0  = neutral
//
// round: i8, value 1, 2, or 3 — which round just settled
//
// Returns i8:
//   1  = you win
//  -1  = opponent wins
//   0  = no winner yet, continue to next round
//   2  = tie (only after round 3)

// Score value for each marker index (A-G → indices 0-6)
// A, B, C → 2 pts; D, E → 3 pts; F → 4 pts; G → 5 pts
function markerScore(idx: i32): i32 {
  if (idx <= 2) return 2;
  if (idx <= 4) return 3;
  if (idx == 5) return 4;
  return 5;
}

// Total score accumulated by the given side (1 = you, -1 = opponent)
function calcScore(board: Int8Array, side: i8): i32 {
  let total: i32 = 0;
  for (let i: i32 = 0; i < 7; i++) {
    if (board[i] == side) {
      total += markerScore(i);
    }
  }
  return total;
}

// Number of markers currently held by the given side
function countMarkers(board: Int8Array, side: i8): i32 {
  let count: i32 = 0;
  for (let i: i32 = 0; i < 7; i++) {
    if (board[i] == side) {
      count++;
    }
  }
  return count;
}

// Tiebreak used when round == 3 and both scores are equal.
// Scans tiers from highest (G) to lowest (A/B/C).
// At the highest non-empty tier:
//   - only you have a marker → 1 (you win)
//   - only opponent has a marker → -1 (opponent wins)
//   - both have markers → 2 (tie, cannot distinguish)
// If no markers exist at all → 2 (tie)
function tiebreak(board: Int8Array): i8 {
  // Tier G (index 6, 5 pts) — single marker
  if (board[6] == 1)  return 1;
  if (board[6] == -1) return -1;

  // Tier F (index 5, 4 pts) — single marker
  if (board[5] == 1)  return 1;
  if (board[5] == -1) return -1;

  // Tier D/E (indices 3 and 4, 3 pts each)
  const myDE:  bool = board[3] == 1  || board[4] == 1;
  const oppDE: bool = board[3] == -1 || board[4] == -1;
  if (myDE || oppDE) {
    if (myDE && !oppDE) return 1;
    if (oppDE && !myDE) return -1;
    return 2; // both have D/E markers — highest non-empty tier, cannot distinguish
  }

  // Tier A/B/C (indices 0, 1, 2, 2 pts each)
  const myABC:  bool = board[0] == 1  || board[1] == 1  || board[2] == 1;
  const oppABC: bool = board[0] == -1 || board[1] == -1 || board[2] == -1;
  if (myABC || oppABC) {
    if (myABC && !oppABC) return 1;
    if (oppABC && !myABC) return -1;
    return 2;
  }

  // No markers on either side — tie
  return 2;
}

export function hanamikoji_judge(board: Int8Array, round: i8): i8 {
  const myScore:  i32 = calcScore(board, 1);
  const oppScore: i32 = calcScore(board, -1);
  const myCount:  i32 = countMarkers(board, 1);
  const oppCount: i32 = countMarkers(board, -1);

  // --- Immediate win condition 1: total score ≥ 11 ---
  // (Both sides cannot simultaneously reach 11 since total available is 21)
  if (myScore  >= 11) return 1;
  if (oppScore >= 11) return -1;

  // --- Immediate win condition 2: ≥4 markers (other side confirmed < 11) ---
  // (Both sides cannot simultaneously hold ≥4 markers since total markers is 7)
  if (myCount  >= 4) return 1;
  if (oppCount >= 4) return -1;

  // --- No immediate winner ---
  if (round < 3) return 0;

  // --- Round 3 final judgment ---
  if (myScore  > oppScore) return 1;
  if (oppScore > myScore)  return -1;

  // Scores equal: tiebreak by highest-tier marker
  return tiebreak(board);
}
