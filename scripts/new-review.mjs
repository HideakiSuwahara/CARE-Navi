#!/usr/bin/env node
/**
 * レビューループの記録ファイルを雛形から作る。
 *
 * 使い方:
 *   node scripts/new-review.mjs [--scope "ボードと割当"] [--loop 2] [--date 2026-11-03]
 *
 * 出力: docs/reviews/YYYY-MM-DD-loopN.md（N は同日の既存ファイル数 + 1。--loop で指定可）
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REVIEWS_DIR = join(ROOT, "docs", "reviews");
const TEMPLATE = join(ROOT, "scripts", "templates", "review.md");

function parseArgs(argv) {
  const o = { scope: "", loop: null, date: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scope") o.scope = argv[++i] ?? "";
    else if (a === "--loop") o.loop = Number(argv[++i]);
    else if (a === "--date") o.date = argv[++i] ?? null;
    else if (a === "--help" || a === "-h") {
      console.log('usage: node scripts/new-review.mjs [--scope "..."] [--loop N] [--date YYYY-MM-DD]');
      process.exit(0);
    }
  }
  return o;
}

function todayJst() {
  // 日本時間の日付（環境のタイムゾーンに依存しない）
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

const opts = parseArgs(process.argv.slice(2));
const date = opts.date ?? todayJst();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("--date は YYYY-MM-DD 形式");
  process.exit(2);
}

mkdirSync(REVIEWS_DIR, { recursive: true });
const existing = readdirSync(REVIEWS_DIR).filter((f) => f.startsWith(`${date}-loop`) && f.endsWith(".md"));
const loop = Number.isInteger(opts.loop) && opts.loop > 0 ? opts.loop : existing.length + 1;
const out = join(REVIEWS_DIR, `${date}-loop${loop}.md`);
if (existsSync(out)) {
  console.error(`既にあります: ${out}（--loop で別番号を指定）`);
  process.exit(1);
}

const tpl = readFileSync(TEMPLATE, "utf8")
  .replaceAll("{{date}}", date)
  .replaceAll("{{loop}}", String(loop))
  .replaceAll("{{scope}}", opts.scope || "（このループで見る範囲を書く）");

writeFileSync(out, tpl, "utf8");
console.log(out);
