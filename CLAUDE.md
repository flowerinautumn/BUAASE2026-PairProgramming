# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BUAA 2026 Agile Software Engineering pair programming assignment implementing the board game **Hanamikoji (花見小路)** as WebAssembly modules. Three progressive tasks (T1/T2/T3) plus a C/Rust WASM bridge demo (G). All implementations use **AssemblyScript** compiled to WASM, running on **Node.js v22.14.0**.

## Build & Test Commands

Each task lives under `src/T{N}/t{N}-as/`. Build and test from the task directory:

```bash
# Build WASM (from t{N}-as directory)
cd src/T1/t1-as && npm run asbuild

# Run submit-test (from T{N} directory)
cd src/T1 && node test.js
# or: cd src/T1 && npm run submit-test

# Same pattern for T2 and T3
cd src/T2/t2-as && npm run asbuild
cd src/T2 && node test.js

cd src/T3/t3-as && npm run asbuild
cd src/T3 && node test.js
```

T3's test runs two AI players against each other in a full match. Player module paths are configured via `.env` files (e.g., `HM_P1_MODULE=./t3-as/build/release.js`).

## Architecture

### Task Structure

- **T1** (`src/T1/t1-as/assembly/index.ts`): `hanamikoji_judge(board: Int8Array, round: i32) → i32` — determines win/loss/draw from board state and round number
- **T2** (`src/T2/t2-as/assembly/index.ts`): `calc_current_state(history: string, board: Int8Array) → Int8Array` — reconstructs full board state (3×7 matrix as flat 21-element array) from action history
- **T3** (`src/T3/t3-as/assembly/index.ts`): `hanamikoji_action(history: string, hand: string, board: Int8Array) → string` — AI strategy that returns action commands (e.g., "1A", "3BCC", "-D")

### Game Engine (T3)

`src/T3/hanamikoji-engine.js` is the match simulator — **do not modify**. It handles round management, action parsing, time tracking (2000ms limit per decision), and victory judgment. `src/T3/game-config.js` loads player specs from `.env`.

### History Format

Space-separated action tokens: `"1A 2BC 3DEF-D 4ABCD-AB"`. Actions alternate P1/P2. The `-` suffix is the opponent's response (gift pick or compete group choice).

### Card/Geisha System

7 geishas A–G with point values [2,2,2,3,3,4,5] and card counts [2,2,2,3,3,4,5]. Board values: +1 = your marker, -1 = opponent's, 0 = neutral. Win: ≥11 points or ≥4 markers; round 3 tiebreak by highest-value marker.

### WASM Bridge Demo (G)

`src/G/g_c/` — C/C++ compiled via Emscripten; `src/G/g_rust/` — Rust via wasm-pack. These are reference examples, not part of the main tasks.

## Key Conventions

- Export names follow candidates: `hanamikoji_judge`/`HanamikojiJudge`/`hanamikojiJudge` (test auto-discovers)
- AssemblyScript uses `asconfig.json` for build config; release builds use `-O3`
- Each task's `.env` file points to the compiled WASM module path
