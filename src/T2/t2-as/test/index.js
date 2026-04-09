import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calc_current_state } from "../build/debug.js";

function run(history, board) {
  const raw = calc_current_state(history, Int8Array.from(board));
  const flat = Array.from(raw).map(Number);
  return [flat.slice(0, 7), flat.slice(7, 14), flat.slice(14, 21)];
}

describe("calc_current_state basic sample", () => {
  it("matches the provided submit-test sample", () => {
    const history = "1A 1A 2BC 2BC 3EEE-E 3DDD-D 4FGFG-FG 4FGFG-FG";
    const board = [0, 0, 0, 0, 0, 0, 0];
    const expected = [
      [1, 0, 0, 1, 2, 2, 2],
      [1, 0, 0, 2, 1, 2, 2],
      [0, 0, 0, -1, 1, 0, 0]
    ];
    assert.deepEqual(run(history, board), expected);
  });
});

describe("calc_current_state README example", () => {
  it("reconstructs both areas and settled markers correctly", () => {
    const history = "2GG 2FF 1D 3EEG-E 3AFF-F 1C 4ABEG-AB 4BCDD-DD";
    const board = [0, 0, 0, 0, 0, 0, 0];
    const expected = [
      [1, 0, 0, 3, 2, 1, 1],
      [1, 2, 2, 0, 1, 1, 1],
      [0, -1, -1, 1, 1, 0, 0]
    ];
    assert.deepEqual(run(history, board), expected);
  });
});

describe("calc_current_state tie and board carry-over", () => {
  it("keeps original marker on tied geisha counts", () => {
    const history = "1A 1A 2BC 2BC 3DEF-D 3DEF-D 4GABC-GA 4GABC-GA";
    const board = [1, -1, 0, 1, -1, 0, 1];
    const expected = [
      [2, 1, 1, 1, 1, 1, 1],
      [2, 1, 1, 1, 1, 1, 1],
      [1, -1, 0, 1, -1, 0, 1]
    ];
    assert.deepEqual(run(history, board), expected);
  });
});
