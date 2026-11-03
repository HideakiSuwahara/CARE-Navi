#!/usr/bin/env node
/**
 * Stop フック
 * - 全体工程の進み具合（docs/progress.md から計算）を毎回 1 行出す。
 * - 未コミットの変更が残っていれば、短い注意を出す（止めない）。
 * stdout の JSON の systemMessage は利用者に表示される。
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readProgress } from "../progress.mjs";

function readStdinJson() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const payload = readStdinJson();
// 既にこのフックが原因で続行した場合は再度出さない
if (payload?.stop_hook_active) process.exit(0);

let status = "";
try {
  status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch {
  process.exit(0);
}

let progressLine = "";
try {
  const p = readProgress();
  progressLine = `全体工程 約${p.total}%（受け入れ条件のチェック ${p.checked}/${p.all}。詳しくは npm run progress）`;
} catch {
  // 進み具合の表がなければ出さない
}

const changed = status.split(/\r?\n/).filter(Boolean);
if (changed.length === 0) {
  if (progressLine) console.log(JSON.stringify({ systemMessage: progressLine }));
  process.exit(0);
}

const shown = changed.slice(0, 8).map((l) => "  " + l).join("\n");
const more = changed.length > 8 ? `\n  …ほか ${changed.length - 8} 件` : "";
const message =
  `未コミットの変更が ${changed.length} 件あります。` +
  `区切りなら lint / typecheck / test / check:wording を通してからコミットしてください。\n${shown}${more}` +
  (progressLine ? `\n${progressLine}` : "");

console.log(JSON.stringify({ systemMessage: message }));
process.exit(0);
