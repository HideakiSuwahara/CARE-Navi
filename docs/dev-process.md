# 開発の進め方（Built with Claude Code）

ケアナビは Claude Code で開発する。製品内に AI は入れない（決定記録 0002）。ここに書くのは、開発チーム（人と Claude Code のエージェント群）の回し方。

## 1. エージェントの役割（`.claude/agents/`）

| エージェント | 役割 | 見るもの |
|---|---|---|
| `product-guardian` | 構想書・決定記録との整合。作らないもの（concept.md §1.2）と表現の規則（wording.md）の番人 | 全PR・全画面文言 |
| `care-domain-reviewer` | 介護現場の妥当性。用語（様／さん、介助の表現）、未割り当て≠人手不足、区分と担当条件の分離、休憩・夜勤・応援の扱い | データモデル・画面・サンプルデータ |
| `ux-first-timer` | 3ペルソナ（新人／応援スポット／管理者）で初見シナリオを操作し、迷った箇所・押し間違えた箇所を報告 | Playwright で実際に操作 |
| `a11y-reviewer` | 色だけに頼らない、押せる領域 44px、文字サイズ、コントラスト、キーボードでの D&D | UI |
| `frontend-builder` | 実装。画面仕様（screens.md）とデータモデル（data-model.md）に従う | |
| `qa-tester` | 単体テスト・E2E、受け入れ条件（acceptance.md）の自動化 | |
| `demo-director` | 動画の台本、サンプルデータの見栄え、「見せ場」の設計 | シード・画面 |
| `sample-data-author` | 架空施設「ひまわり苑」のデータ（利用者・職員・役割枠・業務の型・一日の型・手順・物品・相談先） | `src/domain/seed/` |

## 2. レビューループ
1. `frontend-builder` が1機能を実装し、`npm run lint && npm run typecheck && npm test` を通す。
2. `care-domain-reviewer` / `ux-first-timer` / `a11y-reviewer` を**並列**に走らせ、指摘を受ける。
3. 指摘を `docs/reviews/YYYY-MM-DD-loopN.md` に記録（指摘・判断・対応・見送り理由）。
4. 修正 → テスト → 次のループ。
5. `product-guardian` は各ループの最後に、スコープ外の追加と禁止語の混入を確認する。

1日に2〜3ループ。機能凍結はしない（決定記録 0012）。提出まで、画面を足したらその日にループを回す。

## 3. フック（`.claude/settings.json`、実体は `scripts/hooks/`）
- `PreToolUse`（Bash）: `pre-bash.mjs`。force push、`.env` の表示、秘密値の echo、`reset --hard` などを止める。
- `PostToolUse`（Write / Edit）: `post-edit.mjs`。変更した `.ts/.tsx/.md` に表現の規則チェック（`scripts/check-wording.mjs`）。違反があれば結果を返して止める。例外は行内に `wording-ok` と理由。
- `Stop`: `on-stop.mjs`。未コミットの変更があれば注意を出す（止めない）。
- CI（`.github/workflows/ci.yml`）: lint／typecheck／test／wording。
- コミット前の手順: `npm run lint && npm run typecheck && npm test && npm run check:wording`。

## 4. スキル（`.claude/skills/`）
- `review-loop`: 上記2の手順と記録テンプレート。
- `wording-check`: 禁止語と言い換えの表、チェックの実行方法。
- `acceptance-check`: acceptance.md のチェックリストを辿り、結果を記録する手順。
- `decision-record`: 決定記録の書き方（背景・決定・理由・失うもの・影響範囲）。
- `demo-data`: サンプルデータの作り方と規則（架空名のみ、現場の実感に合う穴の置き方）。

## 5. 決定記録（`docs/decisions/`）
- 番号付き。`NNNN-slug.md`。
- 見出し: 日付／決定／置き換える決定／理由（お客さん優先の順）／失うものと置き換え／影響範囲。
- 決めたことを覆すときは新しい番号で書き、古い記録の冒頭に「改訂」を足す。消さない。

## 6. 日程

| 日 | 内容 |
|---|---|
| 11/2 月 | 設計書、エージェント・フック、型・イベントログ・チェック関数・テスト、サンプルデータ |
| 11/3 火 | ボード、割当、Undo、警告、職員ビュー、長押しメニュー。空アプリを Vercel へ |
| 11/4 水 | マイナビ、共有端末、表示名、朝の流れ、同期 |
| 11/5 木 | クイック操作、見直しタブ、印刷。正午: 同期の打ち切り判断 |
| 11/6 金 | 改修を続ける（凍結しない。0012）。レビューループ×3、a11y、E2E、本番デプロイ、試用 |
| 11/7 土 | 動画専用日。README、LICENSE、提出文 |
| 11/8 日 | 修正、動画仕上げ、18:00 提出（期限 20:00） |

## 7. 公開リポジトリで守ること
- 実在の人物名・施設名を入れない。サンプルはすべて架空。
- 秘密情報（Supabase の鍵など）はコミットしない。`.env.local` のみ。公開する anon key も README には書かない。
- 設計の経緯で人物や他プロジェクトに言及しない。主語は「開発チーム」「施設」「リーダー」。
