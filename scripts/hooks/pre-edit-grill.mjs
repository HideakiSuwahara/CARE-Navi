#!/usr/bin/env node
/**
 * PreToolUse（Write／Edit）: 改善案はグリルしてから改修する（docs/grills/、grill-gate スキル）。
 *
 * docs/grills/*.md のどれかに「状態: グリル待ち」があるあいだは、src/ の .ts/.tsx を書き換えさせない（exit 2）。
 * グリル（1問ずつ・推奨案つきで決定ツリーを潰す）を記録し、「状態: 改修可」にすると通る。
 * src/ 以外（docs・scripts・テストの記録など）は止めない。グリルの記録そのものを書くため。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const GRILLS = join(ROOT, "docs", "grills");

function readStdinJson() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** まだグリルしていない改善案の記録（ファイル名） */
export function pendingGrills(dir = GRILLS) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .filter((f) => /^状態:\s*グリル待ち\s*$/m.test(readFileSync(join(dir, f), "utf8")));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const payload = readStdinJson();
  const filePath = payload?.tool_input?.file_path || payload?.tool_input?.path;
  if (!filePath) process.exit(0);
  const rel = relative(ROOT, resolve(filePath));
  if (rel.startsWith("..") || rel.split(sep)[0] !== "src" || !/\.(ts|tsx)$/.test(rel) || /__tests__/.test(rel)) process.exit(0);

  const pending = pendingGrills();
  if (pending.length === 0) process.exit(0);
  console.error(
    [
      `改善案がグリル待ちです: ${pending.map((f) => `docs/grills/${f}`).join("、")}`,
      "先に grill-gate スキルの手順でグリルし（1問ずつ・推奨案つき・決まったこと／決まっていないこと）、",
      "記録の「状態:」を「改修可」にしてから src/ を直してください。見送る案は「状態: 見送り」。",
    ].join("\n"),
  );
  process.exit(2);
}
