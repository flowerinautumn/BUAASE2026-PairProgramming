import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hanamikoji_judge } from "../build/debug.js";

function judge(board, round) {
  return Number(hanamikoji_judge(Int8Array.from(board), round));
}

describe("hanamikoji_judge immediate win conditions", () => {
  it("returns 1 when my score reaches 11 or more", () => {
    // A+B+C+D+E = 2+2+2+3+3 = 12
    assert.equal(judge([1, 1, 1, 1, 1, 0, 0], 1), 1);
  });

  it("returns -1 when opponent score reaches 11 or more", () => {
    // Opponent owns D+E+F+G = 3+3+4+5 = 15
    assert.equal(judge([0, 0, 0, -1, -1, -1, -1], 2), -1);
  });

  it("returns 1 when I own at least 4 markers without reaching 11 by score", () => {
    // A+B+C+D = 4 markers, score = 9
    assert.equal(judge([1, 1, 1, 1, 0, 0, 0], 2), 1);
  });

  it("returns -1 when opponent owns at least 4 markers without reaching 11 by score", () => {
    // Opponent owns A+B+C+E = 4 markers, score = 9
    assert.equal(judge([-1, -1, -1, 0, -1, 0, 0], 1), -1);
  });
});

describe("hanamikoji_judge continue-game cases", () => {
  it("returns 0 in round 1 when no immediate win condition is met", () => {
    assert.equal(judge([1, -1, 0, 0, 0, 0, 0], 1), 0);
  });

  it("returns 0 in round 2 when no immediate win condition is met", () => {
    assert.equal(judge([1, -1, 0, 1, -1, 0, 0], 2), 0);
  });
});

describe("hanamikoji_judge round-3 final judgement by score", () => {
  it("returns 1 in round 3 when my score is higher", () => {
    // My score = A + D + E = 8, opponent score = B + C + F = 8? let's use smaller opponent
    // My score = A + D + E = 8, opponent score = B + C = 4
    assert.equal(judge([1, -1, -1, 1, 1, 0, 0], 3), 1);
  });

  it("returns -1 in round 3 when opponent score is higher", () => {
    // My score = A+B = 4, opponent score = D+E = 6
    assert.equal(judge([1, 1, 0, -1, -1, 0, 0], 3), -1);
  });
});

describe("hanamikoji_judge round-3 tiebreak by highest tier marker", () => {
  it("returns 1 when scores are equal and I own G", () => {
    // My score = G = 5, opponent score = A + D = 5
    assert.equal(judge([-1, 0, 0, -1, 0, 0, 1], 3), 1);
  });

  it("returns -1 when scores are equal and opponent owns F while I only own lower tier markers", () => {
    // My score = D + A = 5, opponent score = F = 4 ? adjust to tie => My B+A=4, opponent F=4
    assert.equal(judge([1, 1, 0, 0, 0, -1, 0], 3), -1);
  });

  it("returns 1 when scores are equal and highest non-empty tier is D/E owned only by me", () => {
    // My score = D = 3, opponent score = A + B = 4? adjust to tie => D + A = 5, opponent B + C + A impossible.
    // Use D+B = 5, opponent A+C = 4 impossible. Better: my D =3 and A =2 =>5, opponent E? can't because same tier.
    // My D+A = 5, opponent B+C+A not possible. Use tier-only comparison with equal score:
    // My D+A = 5, opponent F? 4 impossible. So compare D/E tier using score 6 each: my D+E, opp A+B+C
    assert.equal(judge([-1, -1, -1, 1, 1, 0, 0], 3), 1);
  });
});

describe("hanamikoji_judge round-3 draw cases", () => {
  it("returns 2 when round 3 ends in a complete tie after highest-tier comparison", () => {
    // My D, opponent E -> both 3 points, same highest tier group D/E occupied by both sides
    assert.equal(judge([0, 0, 0, 1, -1, 0, 0], 3), 2);
  });

  it("returns 2 when all markers are neutral in round 3", () => {
    assert.equal(judge([0, 0, 0, 0, 0, 0, 0], 3), 2);
  });
});
