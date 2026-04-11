import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import loader from "@assemblyscript/loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const wasmPath = path.join(__dirname, "release.wasm");
const wasmModule = loader.instantiateSync(fs.readFileSync(wasmPath), {});
const { exports } = wasmModule;

if (typeof exports.hanamikoji_action_raw !== "function") {
  throw new Error("release.wasm 未导出 hanamikoji_action_raw");
}
if (typeof exports.__newString !== "function" || typeof exports.__getString !== "function") {
  throw new Error("当前 wasm 缺少运行时导出，请确认编译时使用了 --exportRuntime");
}

export function hanamikoji_action(history, cards, board) {
  const b = board instanceof Int8Array ? board : Int8Array.from(board);
  if (b.length !== 7) throw new Error("board 长度必须为 7");

  const historyPtr = exports.__newString(String(history));
  const cardsPtr = exports.__newString(String(cards));
  const resultPtr = exports.hanamikoji_action_raw(
    historyPtr,
    cardsPtr,
    Number(b[0]) | 0,
    Number(b[1]) | 0,
    Number(b[2]) | 0,
    Number(b[3]) | 0,
    Number(b[4]) | 0,
    Number(b[5]) | 0,
    Number(b[6]) | 0
  );

  return exports.__getString(resultPtr);
}
