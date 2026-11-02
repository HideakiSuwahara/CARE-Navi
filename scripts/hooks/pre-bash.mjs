#!/usr/bin/env node
/**
 * PreToolUse フック（Bash）
 * 取り返しのつかない操作と、秘密情報を画面に出す操作を止める。
 * 該当したら理由を stderr に出して exit 2（コマンドは実行されない）。
 */

import { readFileSync } from "node:fs";

function readStdinJson() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const payload = readStdinJson();
const command = String(payload?.tool_input?.command ?? "");
if (!command) process.exit(0);

const DENY = [
  {
    re: /\bgit\s+push\b[^\n|;&]*(\s--force\b|\s-f\b|\s--force-with-lease\b|\+[\w/]+:)/,
    why: "force push は禁止。履歴を壊す操作は人が判断する",
  },
  {
    re: /\b(cat|less|more|head|tail|bat|type|strings|xxd|base64)\b[^\n|;&]*\.env(\.[\w.-]+)?\b/,
    why: ".env の中身を表示しない。キーは画面・ログ・会話に出さない",
  },
  {
    re: /\becho\b[^\n|;&]*\$\{?\w*(KEY|SECRET|TOKEN|PASSWORD)\w*\}?/i,
    why: "環境変数の秘密値を echo しない",
  },
  {
    re: /\b(printenv|env)\b\s*(\||$|;|&&)/,
    why: "環境変数の一覧を出さない（秘密値が混ざる）。必要なら変数名を限定して確認する",
  },
  {
    re: /\bgit\s+add\b[^\n|;&]*\.env(\.[\w.-]+)?\b(?![\w.-]*example)/,
    why: ".env をコミット対象に入れない",
  },
  {
    re: /\brm\s+-rf?\s+(\/|~|\$HOME)(\s|$)/,
    why: "ルートやホームの再帰削除は禁止",
  },
  {
    re: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/,
    why: "作業ツリーを捨てる操作は人が判断する。必要なら理由を添えて相談する",
  },
];

for (const rule of DENY) {
  if (rule.re.test(command)) {
    console.error(`pre-bash フックが止めました: ${rule.why}\n  command: ${command.slice(0, 200)}`);
    process.exit(2);
  }
}
process.exit(0);
