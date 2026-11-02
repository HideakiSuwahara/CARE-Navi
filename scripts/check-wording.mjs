#!/usr/bin/env node
/**
 * 表現の規則チェック（依存なし・Node 22）
 *
 * 使い方:
 *   node scripts/check-wording.mjs                 # src/ と docs/ を検査
 *   node scripts/check-wording.mjs src docs README.md
 *   node scripts/check-wording.mjs --file path/to/file.tsx [--file ...]
 *   node scripts/check-wording.mjs --warn-as-error
 *
 * 規則:
 *   - 行内に `wording-ok` と書いた行は検査しない（例外を意図的に置くとき）。
 *   - ファイル内に `wording-check: skip-file` と書いたファイルは検査しない（規則そのものを説明する文書向け）。
 *   - .md では「〜と言わない」「禁止」など規則を説明している行は検査対象外にする（否定文脈の判定）。
 *     .ts / .tsx のコード・UI 文言には否定文脈の緩和を適用しない。
 *   - リポジトリ直下に `.wordcheck.local.txt`（git 管理外）があれば、その各行を「含んではいけない語」として追加する。
 *
 * 終了コード: 0 = 問題なし、1 = エラーあり、2 = 使い方の誤り
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, resolve, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const EXTENSIONS = new Set([".ts", ".tsx", ".md"]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "coverage", "playwright-report", "test-results", "dist", "build"]);
const SKIP_FILES = new Set([join("docs", "wording.md")]);
const LOCAL_LIST = join(ROOT, ".wordcheck.local.txt");

/**
 * 「規則を説明している行」とみなす手がかり。これらを含む行は検査しない。
 * 適用先: .md の本文、.ts/.tsx のコメント行、テストファイルの行。UI 文言には適用しない。
 */
const NEGATION_HINTS = [
  "言わない", "書かない", "使わない", "出さない", "表示しない", "断定しない", "扱いにしない",
  "しないこと", "禁止", "ではありません", "ではない", "ではなく", "≠", "混同", "解釈しない", "推定しない",
  "みなさない", "見なさない", "作らない", "対象外", "やめる", "避ける", "NG", "置き換え", "→",
  "埋め込まない", "表現しない", "含まない", "含めない", "入れない", "無い", "ていない", "にしない",
  "ないか", "ません", "違反",
];
const NEGATION_RE = /ない(か|。|こと|よう|$|」|）|\)|、)/;

/** 見出し（.md）がこれらを含む節は、全体が「作らないもの・禁止事項」の説明とみなす */
const NEGATED_SECTION_HINTS = ["作らない", "禁止", "対象外", "言わない", "やめる", "作らないもの", "失うもの", "表現の規則", "NG"];

function isRuleTalk(line) {
  return NEGATION_HINTS.some((h) => line.includes(h)) || NEGATION_RE.test(line);
}

function isCommentLine(line) {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*");
}

function isTestFile(abs) {
  return /(^|[\\/])__tests__[\\/]|\.(test|spec)\.tsx?$/.test(abs);
}

/**
 * 規則。level: "error" | "warn"。uiOnly: true は .ts/.tsx では error、.md では warn。
 */
const RULES = [
  { id: "staff-shortage", re: /人手不足|人員不足|人手が足りない/g, level: "error",
    msg: "未割り当ては人手不足ではない。「担当未定」「担当あと n 人」と書く" },
  { id: "hiring-count", re: /採用必要人数|必要採用数|採用が必要な人数/g, level: "error",
    msg: "採用の必要人数をシステムが示す表現は使わない" },
  { id: "completion-rate", re: /完了率|実施率/g, level: "error",
    msg: "「記録あり n／対象 m（記録なし k）」と書く。率にしない" },
  { id: "in-progress", re: /実施中|対応中|作業中/g, level: "warn", uiOnly: true,
    msg: "いまの時刻に予定があることと実施していることは別。「いまの時間の予定」と書く" },
  { id: "auto-complete", re: /自動(的)?(に|で)?完了|完了扱い|完了とみなす|完了と見なす/g, level: "error", uiOnly: true,
    msg: "時間が過ぎても完了にしない。記録がない状態は「記録なし」" },
  { id: "not-done-inference", re: /未実施(扱い|とみなす|と見なす|と判断|と断定)/g, level: "error",
    msg: "記録なしを未実施と判断しない。「記録なし」と「未実施（入力）」を分ける" },
  { id: "ai-decides", re: /AIが(判断|決定|配置|提案|割り当て)|AIによる(自動)?(配置|割当|シフト)|自動配置|自動シフト|最適配置|配置の最適化/g, level: "error", uiOnly: true,
    msg: "製品内で AI は使わない。配置・判断は人が行う（決定記録 0002）" },
  { id: "role-blanket-no", re: /(介護助手|介護補助者|補助者|スポット|応援)(だから|なら|には|は)(一律に)?(できない|不可|無理|任せられない)/g, level: "error",
    msg: "役職から可否を決めつけない。可否は施設が設定する担当条件で決まる" },
  { id: "role-blanket-yes", re: /介護職員なら(すべて|全て|何でも|全部|どの業務も)/g, level: "error",
    msg: "役職から可否を決めつけない。可否は施設が設定する担当条件で決まる" },
  { id: "headcount-inference", re: /対象者数から(自動で|自動的に)?(適正|必要)人数/g, level: "warn",
    msg: "必要人数は施設が決めた予定値。対象者数から推定しない" },
  { id: "evaluation", re: /職員(の|を)評価に使/g, level: "warn",
    msg: "見直しの数字は配置のため。職員評価に使わないと明記する" },
  { id: "en-shortage", re: /staff\s*shortage|understaffed/gi, level: "error",
    msg: "shortage の語は使わない。unassigned / short by n と書く" },
  { id: "en-completion-rate", re: /completion\s*rate|completionRate/g, level: "error",
    msg: "率にしない。recorded n of m と書く" },
];

function loadLocalWords() {
  if (!existsSync(LOCAL_LIST)) return [];
  return readFileSync(LOCAL_LIST, "utf8")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function walk(target, out) {
  const abs = resolve(ROOT, target);
  if (!existsSync(abs)) return;
  const st = statSync(abs);
  if (st.isFile()) {
    if (EXTENSIONS.has(extname(abs))) out.push(abs);
    return;
  }
  for (const name of readdirSync(abs)) {
    if (SKIP_DIRS.has(name)) continue;
    const child = join(abs, name);
    const cst = statSync(child);
    if (cst.isDirectory()) walk(child, out);
    else if (EXTENSIONS.has(extname(child))) out.push(child);
  }
}

function isSkippedFile(abs) {
  const rel = relative(ROOT, abs);
  if (SKIP_FILES.has(rel)) return true;
  if (rel.split(sep)[0] === "scripts") return true;
  return false;
}

/**
 * @returns {{ file: string, line: number, level: "error"|"warn", id: string, msg: string, text: string }[]}
 */
export function checkFile(abs) {
  const findings = [];
  if (isSkippedFile(abs)) return findings;
  const src = readFileSync(abs, "utf8");
  if (src.includes("wording-check: skip-file")) return findings;
  const isMarkdown = extname(abs) === ".md";
  const testFile = isTestFile(abs);
  const localWords = loadLocalWords();
  const lines = src.split(/\r?\n/);
  let sectionNegated = false;

  lines.forEach((line, i) => {
    if (line.includes("wording-ok")) return;
    if (isMarkdown && /^#{1,6}\s/.test(line)) {
      sectionNegated = NEGATED_SECTION_HINTS.some((h) => line.includes(h));
    }
    const ruleTalkContext = isMarkdown || testFile || isCommentLine(line);
    const negated = ruleTalkContext && ((isMarkdown && sectionNegated) || isRuleTalk(line));

    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      const m = rule.re.exec(line);
      if (!m) continue;
      if (negated) continue;
      let level = rule.level;
      if (rule.uiOnly) level = isMarkdown ? "warn" : "error";
      findings.push({ file: abs, line: i + 1, level, id: rule.id, msg: rule.msg, text: m[0] });
    }
    for (const word of localWords) {
      if (new RegExp(escapeRe(word), "i").test(line)) {
        findings.push({ file: abs, line: i + 1, level: "error", id: "local-list", msg: "ローカル禁止語リストに含まれる語です", text: word });
      }
    }
  });
  return findings;
}

export function checkPaths(targets) {
  const files = [];
  for (const t of targets) walk(t, files);
  const unique = [...new Set(files)];
  const findings = [];
  for (const f of unique) findings.push(...checkFile(f));
  return { files: unique, findings };
}

function parseArgs(argv) {
  const opts = { files: [], targets: [], warnAsError: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") {
      const v = argv[++i];
      if (!v) { console.error("--file にはパスが必要です"); process.exit(2); }
      opts.files.push(v);
    } else if (a === "--warn-as-error") opts.warnAsError = true;
    else if (a === "--quiet") opts.quiet = true;
    else if (a === "--help" || a === "-h") {
      console.log("usage: node scripts/check-wording.mjs [--file <path>]... [--warn-as-error] [dir|file ...]");
      process.exit(0);
    } else opts.targets.push(a);
  }
  return opts;
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const targets = opts.files.length ? opts.files : (opts.targets.length ? opts.targets : ["src", "docs"]);
  const { files, findings } = checkPaths(targets);

  if (files.length === 0) {
    if (!opts.quiet) console.log("check-wording: 対象ファイルなし（問題なし）");
    return 0;
  }

  let errors = 0;
  let warns = 0;
  for (const f of findings) {
    const rel = relative(ROOT, f.file);
    const tag = f.level === "error" ? "E" : "W";
    if (f.level === "error") errors++; else warns++;
    console.log(`${rel}:${f.line}: [${tag}] ${f.msg} — 「${f.text}」 (${f.id})`);
  }
  const failed = errors > 0 || (opts.warnAsError && warns > 0);
  if (!opts.quiet || failed) {
    console.log(`check-wording: ${files.length} ファイル, エラー ${errors}, 注意 ${warns}${failed ? " → 失敗" : " → 問題なし"}`);
  }
  if (failed) {
    console.log("  例外を意図的に置く場合は、その行に wording-ok と書く（理由をコメントで添える）。");
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main());
}
