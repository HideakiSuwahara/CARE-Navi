---
name: wording-check
description: 表現の規則（docs/wording.md）を機械的に点検する手順。UI 文言・設計書・README を書いた後、コミット前、レビューループの冒頭で使う。「文言チェック」「言葉を確認して」と言われたら使う。
---

# 表現の規則チェック

## 実行

```
npm run check:wording                   # src/ と docs/ 全体
node scripts/check-wording.mjs --file src/components/Board.tsx
node scripts/check-wording.mjs README.md CLAUDE.md .claude
node scripts/check-wording.mjs --warn-as-error   # 注意も失敗扱い（提出前）
```

終了コード 1 がエラーあり。CI でも同じコマンドが走る。Write/Edit の直後にはフックが自動で走り、エラーがあれば結果が返ってくる。

## 出力の読み方

```
src/components/Board.tsx:42: [E] 未割り当ては人手不足ではない。「担当未定」「担当あと n 人」と書く — 「人手不足」 (staff-shortage)
```

- `[E]` は直す。`[W]` は読んで判断する（.md の説明文で「〜と言わない」と書いている行は自動で除外される）。
- `.ts/.tsx` の UI 文言は `[W]` でも実際の画面に出る言葉なら直す。

## 例外の置き方

- その行だけ: 行内に `wording-ok` と理由を書く。
  ```tsx
  {/* wording-ok: 施設設定の説明文で、禁止表現を引用している */}
  ```
- ファイル全体（規則そのものを説明する文書）: ファイル内に `wording-check: skip-file` を書く。`docs/wording.md` は最初から対象外。

## 機械で拾えないもの（目で見る）

- 色だけで状態を示していないか。
- 「未割り当て」を「不足」と言い換えていないか（人手・人員・スタッフ）。
- 一括業務の完了を対象者全員の実施と読める文になっていないか。
- 区分（コア／ノンコア）から可否を匂わせる文（「ノンコアなので誰でも」）。
- 見直しの数字に「予定時間ベース」「職員の評価には使わない」が付いているか。

## 個人名・出所の語

規則ファイルには書けない語（個人名など）は、リポジトリ直下の `.wordcheck.local.txt`（git 管理外、1 行 1 語）に置くと同じチェックで検出される。公開ファイルにその語を書かないこと。
