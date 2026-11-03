#!/usr/bin/env node
/**
 * 進み具合を出す。docs/progress.md の表（工程・重み・進み）から全体の % を計算し、
 * 参考として docs/acceptance.md のチェック数も出す。
 *   node scripts/progress.mjs          → 表と合計
 *   node scripts/progress.mjs --line   → 1行（Stop フック用）
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function readProgress() {
  const text = readFileSync(join(root, "docs/progress.md"), "utf8");
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/);
    if (m) rows.push({ name: m[1], weight: Number(m[2]), done: Number(m[3]) });
  }
  const weight = rows.reduce((n, r) => n + r.weight, 0);
  const total = weight ? rows.reduce((n, r) => n + (r.weight * r.done) / 100, 0) / (weight / 100) : 0;
  let checked = 0;
  let all = 0;
  try {
    const acc = readFileSync(join(root, "docs/acceptance.md"), "utf8");
    checked = (acc.match(/^- \[x\]/gm) ?? []).length;
    all = (acc.match(/^- \[[ x]\]/gm) ?? []).length;
  } catch {
    // 受け入れ条件がなければ出さない
  }
  return { rows, total: Math.round(total), checked, all };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const p = readProgress();
  if (process.argv.includes("--line")) {
    console.log(`全体工程 約${p.total}%（受け入れ条件のチェック ${p.checked}/${p.all}）`);
  } else {
    for (const r of p.rows) console.log(`${String(r.done).padStart(3)}%  ${r.name}（重み ${r.weight}）`);
    console.log(`\n全体工程 約${p.total}%`);
    console.log(`受け入れ条件のチェック ${p.checked}/${p.all}（参考）`);
  }
}
