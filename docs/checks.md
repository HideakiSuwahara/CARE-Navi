# 配置チェック仕様

純関数として実装し、単体テストで守る（`src/domain/checks.ts`）。UI は結果（`Issue[]`）をそのまま文言に使う。

## 1. 対象
`checkAssignment(state, taskId, staffId): Issue[]` — その職員をその業務に付けたときの問題。
`headcountStatus(state, taskId): HeadcountStatus` — 充足バッジ。
`rankCandidates(state, taskId): Candidate[]` — 候補一覧の並び。

## 2. チェック一覧

| # | code | 判定 | 既定の扱い | 理由文のテンプレート |
|---|---|---|---|---|
| 1 | `duplicate` | 同じ (taskId, staffId) の担当が既にある | **常に禁止**（設定に関わらず） | 「すでにこの業務の担当です」 |
| 2 | `overlap` | 同じ日の他の担当業務（`status=planned`、`kind=care`）と `[start, end)` が交差 | 警告して許可 | 「{開始}〜{終了} の『{業務名}{対象}』と重なります」 |
| 3 | `noRoster` | その日の `RosterEntry` がない | 警告して許可（応援・急な出勤がある） | 「本日の勤務予定がありません」 |
| 4 | `offShift` | 勤務予定はあるが、業務時間が `[startMin, endMin)` に収まらない | 警告して許可 | 「勤務は {開始} からです」／「勤務は {終了} までです」／「{開始}〜{終了} は勤務時間外です」 |
| 5 | `absent` | `RosterEntry.absent = true` | 警告して許可（画面上は「勤務外・休み」の段に置き、休みの人には追加ボタンを出さない） | 「本日休みです」／「早退しています」 |
| 6 | `onBreak` | その職員が担当する休憩カード（`kind=break`）と交差 | 警告して許可 | 「{開始}〜{終了} の『{休憩名}』と重なります」 |
| 7 | `missingTags` | `task.requiredTags − staff.tags` が空でない | 警告して許可 | 「条件「{タグ}」を満たしていません（施設の設定）」 |
| 8 | `firstTimerOnly` | 追加後、その業務の担当が全員 `firstTimer=true` になる | 警告して許可。`settings.firstTimerOnlyWarning=false` なら出さない | 「初回の方だけの配置です」 |

- `settings.checkMode = "block"` のとき、2〜8 も禁止にする（施設の判断）。
- 休憩カード自体への割当では `overlap` を「休憩と業務の重なり」として返す（同じ関数で扱う）。
- 中止（`cancelled`）の業務は重なりの対象にしない。
- 部分参加（時間の一部だけ空いている）は `overlap` として返しつつ、理由文に「{時刻} までなら入れます」を添える（候補一覧の「問題なし」に部分参加として並べる判断は UI 側）。

## 3. 充足バッジ
```
required = task.headcount
assigned = その業務の担当数
gap = required − assigned
level: assigned = 0 → unassigned / 0 < assigned < required → short / assigned = required → ok / assigned > required → over
label: 「担当未定」／「担当あと {gap} 人」／「」（無印）／「{−gap} 人 多め」
```
`required = 0` の業務（担当を要しないメモ的な枠）は常に `ok`。

## 4. 候補の並び順
1. 問題なし（Issue が空）— 役割が業務の `slotIds` に含まれる人を先頭、次に同じグループの人、その後は名字順。
2. 部分参加できる人（`overlap` のみで、空いている時間が業務の半分以上）。
3. 注意（`overlap`, `onBreak`, `missingTags`, `firstTimerOnly`）— 件数の少ない順。
4. 勤務外・休み（`offShift`, `noRoster`, `absent`）。
5. `duplicate` の人は一覧に出さない。

## 5. 文言の規則
- 事実だけを書く。評価語（「無理」「不適切」）は使わない。
- 時刻は `10:30–12:00` の形、翌日は `翌2:00`。
- 対象は「田中様」「20人」。
- 「人手不足」「不足」「未実施」「できない」は使わない。条件不一致は「満たしていません」。

## 6. テスト観点（node:test）
- 重複なし・端が接する（10:00–10:30 と 10:30–11:00）は重ならない。
- 翌日分（1440 超）との重なり。
- 勤務前・勤務後・勤務外の3通りの文言。
- 休憩カードとの重なり。
- タグ不足の列挙（複数タグ）。
- 初回のみ: 既存担当が初回1人＋追加が初回 → 警告。既存に常勤がいれば警告なし。
- 充足バッジの4水準と `required=0`。
- 候補の並び順（同じ役割が先頭、休みは最後、重複は除外）。
