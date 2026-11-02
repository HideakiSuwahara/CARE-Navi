#!/usr/bin/env node
/**
 * PostToolUse フック（Write | Edit）
 * 変更されたファイルが .ts / .tsx / .md なら表現の規則チェックを走らせる。
 * 違反があれば stderr に出して exit 2（Claude に結果が戻り、修正を促す）。
 * 対象外の拡張子・scripts/ 配下・node_modules は即終了（exit 0）。
 */

import { readFileSync } from "node:fs";
import { extname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPaths } from "../check-wording.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function readStdinJson() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const payload = readStdinJson();
const filePath = payload?.tool_input?.file_path || payload?.tool_input?.path;
if (!filePath) process.exit(0);

const abs = resolve(filePath);
const ext = extname(abs);
if (![".ts", ".tsx", ".md"].includes(ext)) process.exit(0);

const rel = relative(ROOT, abs);
if (rel.startsWith("..")) process.exit(0);
const top = rel.split(sep)[0];
if (["node_modules", ".next", "scripts", ".git"].includes(top)) process.exit(0);

const { findings } = checkPaths([abs]);
const errors = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");

if (errors.length === 0 && warns.length === 0) process.exit(0);

const lines = [];
lines.push(`表現の規則チェック: ${rel}`);
for (const f of findings) {
  lines.push(`  L${f.line} [${f.level === "error" ? "E" : "W"}] ${f.msg} — 「${f.text}」`);
}
if (errors.length > 0) {
  lines.push("  直してから進めてください。意図した例外なら、その行に wording-ok と理由を書く。");
  console.error(lines.join("\n"));
  process.exit(2);
}
// 注意のみ: 止めないが、ユーザーに見える形で出す
console.log(JSON.stringify({ systemMessage: lines.join("\n") }));
process.exit(0);
