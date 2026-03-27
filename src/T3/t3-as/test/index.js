import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hanamikoji_action } from "../build/debug.js";

const CARD_SET = new Set(["A", "B", "C", "D", "E", "F", "G"]);

// Parse action string into { type, cards } where type is 1/2/3/4 or 'R' for response
function parseAction(action) {
  if (action.startsWith("-")) {
    return { type: "R", cards: action.slice(1).split("") };
  }
  const type = parseInt(action.charAt(0), 10);
  const cards = action.slice(1).split("");
  return { type, cards };
}

// True iff every card in `usedCards` exists in `handStr` (multiset check)
function cardsInHand(usedCards, handStr) {
  const hand = handStr.split("");
  for (const c of usedCards) {
    const idx = hand.indexOf(c);
    if (idx === -1) return false;
    hand.splice(idx, 1);
  }
  return true;
}

const board = Int8Array.from([0, 0, 0, 0, 0, 0, 0]);

// ── Goal 1: empty history → valid action 1/2/3/4 ────────────────────────────
describe("empty history", () => {
  it("returns an action starting with 1, 2, 3, or 4", () => {
    const action = hanamikoji_action("", "ABCDEFG", board);
    const { type } = parseAction(action);
    assert.ok([1, 2, 3, 4].includes(type), `unexpected action: ${action}`);
  });

  it("uses the correct number of cards for the chosen type", () => {
    const action = hanamikoji_action("", "ABCDEFG", board);
    const { type, cards } = parseAction(action);
    assert.equal(cards.length, type, `card count mismatch: ${action}`);
  });

  it("all cards in action come from the hand", () => {
    const hand = "ABCDEFG";
    const action = hanamikoji_action("", hand, board);
    const { cards } = parseAction(action);
    assert.ok(cardsInHand(cards, hand), `cards not in hand: ${action}`);
  });
});

// ── Goal 2: response to 赠予 (action 3) ─────────────────────────────────────
describe("respond to action 3 (赠予)", () => {
  it("returns -X format", () => {
    const history = "3BCC";
    const action = hanamikoji_action(history, "ADEG", board);
    assert.match(action, /^-[A-G]$/, `expected -X, got: ${action}`);
  });

  it("selected card is one of the offered cards", () => {
    const history = "3BCC";
    const action = hanamikoji_action(history, "ADEG", board);
    const selected = action.slice(1);
    const offered = ["B", "C", "C"];
    assert.ok(offered.includes(selected), `selected ${selected} not in offered BCC`);
  });

  it("handles duplicate offered cards correctly", () => {
    const history = "3GGG";
    const action = hanamikoji_action(history, "ABCDE", board);
    assert.match(action, /^-[A-G]$/, `expected -X, got: ${action}`);
    assert.equal(action.slice(1), "G", `expected G from GGG, got: ${action}`);
  });
});

// ── Goal 3: response to 竞争 (action 4) ──────────────────────────────────────
describe("respond to action 4 (竞争)", () => {
  it("returns -XY format (two chars after dash)", () => {
    const history = "4ABCD";
    const action = hanamikoji_action(history, "EFG", board);
    assert.match(action, /^-[A-G]{2}$/, `expected -XY, got: ${action}`);
  });

  it("selected group is group1 or group2 (multiset match)", () => {
    const history = "4ABCD";
    const action = hanamikoji_action(history, "EFG", board);
    const selected = action.slice(1).split("").sort().join("");
    const group1 = "AB".split("").sort().join("");
    const group2 = "CD".split("").sort().join("");
    assert.ok(
      selected === group1 || selected === group2,
      `selected ${selected} matches neither AB nor CD`
    );
  });

  it("handles symmetric groups (4FGFG)", () => {
    const history = "4FGFG";
    const action = hanamikoji_action(history, "ABCDE", board);
    assert.match(action, /^-[A-G]{2}$/, `expected -XY, got: ${action}`);
    const selected = action.slice(1).split("").sort().join("");
    assert.equal(selected, "FG", `expected FG group, got: ${selected}`);
  });
});

// ── Goal 4: no repeated action types for the same player ─────────────────────
describe("no duplicate action type per player", () => {
  it("P1 does not reuse action 1 when already in history at position 0", () => {
    // P1 used action 1 at position 0; P2 used action 2 at position 1
    // Now P1 acts at position 2
    const history = "1A 2BC";
    const action = hanamikoji_action(history, "DEFG", board);
    const { type } = parseAction(action);
    assert.notEqual(type, 1, `P1 must not reuse action 1: ${action}`);
  });

  it("P1 does not reuse action 2 when already in history at position 0", () => {
    const history = "2AB 1C";
    const action = hanamikoji_action(history, "DEFG", board);
    const { type } = parseAction(action);
    assert.notEqual(type, 2, `P1 must not reuse action 2: ${action}`);
  });

  it("P2 does not reuse action 1 when already used at position 1", () => {
    // P1 acted at pos 0, P2 used action 1 at pos 1; now P1 at pos 2, P2 at pos 3
    const history = "2AB 1C 3DEF-D";
    const action = hanamikoji_action(history, "EFG", board);
    const { type } = parseAction(action);
    assert.notEqual(type, 1, `P2 must not reuse action 1: ${action}`);
  });

  it("P1 with three actions used still picks an unused one", () => {
    // P1 used 1,2,3 at positions 0,2,4; P2 used actions at 1,3,5
    // history[0]=P1 act1, [1]=P2 act, [2]=P1 act2, [3]=P2 act, [4]=P1 act3, [5]=P2 act
    const history = "1A 2BC 2DE 1F 3GGG-G 3ABD-A";
    const action = hanamikoji_action(history, "BCDE", board);
    const { type } = parseAction(action);
    assert.equal(type, 4, `P1 should use action 4, got: ${action}`);
  });
});

// ── Goal 5: all action cards come from the provided hand ─────────────────────
describe("cards in action must come from hand", () => {
  it("action 1 uses a card from hand", () => {
    const hand = "CDEFG";
    const action = hanamikoji_action("", hand, board);
    const { type, cards } = parseAction(action);
    if (type === 1) {
      assert.ok(cardsInHand(cards, hand), `card ${cards} not in hand ${hand}`);
    }
  });

  it("action 2 uses cards from hand", () => {
    const hand = "ABCDE";
    // Force action 2 by providing history where P1 already used action 1
    const history = "1A 1B";
    const action = hanamikoji_action(history, hand, board);
    const { cards } = parseAction(action);
    assert.ok(cardsInHand(cards, hand), `cards ${cards} not in hand ${hand}`);
  });

  it("action 3 uses cards from hand", () => {
    const hand = "ABCDE";
    const history = "1A 1B 2CD 2EF";
    const action = hanamikoji_action(history, hand, board);
    const { cards } = parseAction(action);
    assert.ok(cardsInHand(cards, hand), `cards ${cards} not in hand ${hand}`);
  });

  it("action 4 uses cards from hand", () => {
    const hand = "ABCDE";
    const history = "1A 1B 2CD 2EF 3GGG-G 3ABB-A";
    const action = hanamikoji_action(history, hand, board);
    const { type, cards } = parseAction(action);
    assert.equal(type, 4, `expected action 4, got: ${action}`);
    assert.ok(cardsInHand(cards, hand), `cards ${cards} not in hand ${hand}`);
  });
});
