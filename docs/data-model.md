# データモデルとイベント設計

出典: `src/domain/types.ts`、`src/domain/events.ts`。この文書は型に従う。型を変えたらこの文書も直す。

## 1. 考え方
- **業務予定（TaskInstance）が主語**。利用者（対象）と職員（担当）はそこに関連付く。
- 個別（対象1名）・一括（対象複数）・共通（対象なし）・休憩を**同じ型**で表す。`targetMode` と `kind` で区別する。
- **一日の型（DayPattern）** は役割枠（RoleSlot）に業務を束ねる。朝は出勤者に役割を付けて型を当てると、全枠に担当が付く。
- **状態（State）はイベントの列から組み立てる**。UI は状態を直接書き換えない。Undo は打ち消しイベント。同期はイベントの送受信。

## 2. エンティティ

| 型 | 役割 | 主な項目 | 注意 |
|---|---|---|---|
| `Facility` | 施設 | `name`, `settings` | 設定: `checkMode`（warn/block）、`residentDisplayMode`、`firstTimerOnlyWarning`、`boardStartMin/EndMin`（今は使っていない。ボードは 6:00〜翌 6:00 固定で、翌 6:00 より後に終わる業務があればそこまで伸ばす）、`categories[]` |
| `Category` | 業務区分 | `name`, `kind: core/noncore/other` | 名称は施設が編集。`kind` は集計キー。区分はラベルで、可否を決めない |
| `Group` | 管理グループ | `name`, `kind: unit/floor/common/other`, `sortOrder` | 「共通」は `kind=common` |
| `Resident` | 利用者 | `displayName`, `surname`, `groupId`, `room` | 排泄状態・介助方法は持たない |
| `Staff` | 職員 | `displayName`, `surname`, `role`（自由ラベル）, `tags[]`（担当条件）, `homeGroupId?` | 役職から可否を決めない。`tags` が条件 |
| `RoleSlot` | 役割枠 | `name`, `defaultStartMin/EndMin`, `groupId?`, `sortOrder`, `leaderRank?` | 早番A・日勤B・介護助手・看護・スポット…。`leaderRank` はきょうのリーダーを持つ順（1が先、施設が決める）。「困ったら」の相談先に使う（決定記録 0006）。`reviewBand` は業務の見直しで勤務帯を図に重ねる番（介護助手等。施設が印を付ける。決定記録 0008） |
| `TaskTemplate` | 業務の型 | `name`, `kind: care/break`, `categoryId?`, `targetMode`, `defaultDurationMin`, `defaultHeadcount`, `requiredTags[]`, `place?`, `scopeNote?`, `outOfScopeNote?`, `procedure[]`, `supplies?`, `contact?` | 定義。当日の予定とは別 |
| `DayPattern` / `DayPatternItem` | 一日の型 | item: `templateId`, `startMin/endMin`, `groupId?`, `targetRule: allInGroup/residents/none`, `residentIds?`, `headcount`, `slotIds[]` | `slotIds` が役割枠への束ね |
| `RosterEntry` | 今日の出勤者 | `date`, `staffId`, `slotId?`, `startMin/endMin`, `firstTimer`, `absent` | 役割が時間を与え、個別に直せる。初回は当日の印 |
| `TaskInstance` | 業務予定 | `date`, `templateId?`, `name`, `kind`, `categoryId?`, `targetMode`, `groupId?`, `startMin/endMin`, `place?`, `headcount`, `requiredTags[]`, `slotIds[]`, 案内項目, `note?`, `status: planned/cancelled` | `headcount` は施設の予定値。対象者数から推定しない |
| `TaskTarget` | 対象者 | `taskId`, `residentId` | 一括の対象者を明示保存。人数だけ保存しない |
| `Assignment` | 担当 | `taskId`, `staffId` | 同じ (task, staff) は一意 |
| `DayMeta` | 日 | `date`, `appliedPatternId?`, `updatedAt` | 見出しの「更新 hh:mm」の元 |
| `State` | 全体 | 上記を `Record<ID, …>` で保持。`targets` は `taskId → residentIds[]` | |
| `SeedData` | サンプル施設の素材 | 上記の配列＋ `extraTasks`, `extraTargets`, `dayPatterns` | 当日の予定は型から作る |

## 3. 時間の表現
- `Minutes` は**業務日 0:00 起点の分**。翌日分は 1440 以上、最大 2879。例: 翌 2:00 = 1560。
- `DateKey` は `YYYY-MM-DD` の業務日。**夜勤帯の業務は、その夜勤が始まった業務日に属する**。
- 表示は `fmtMin`: 600 → `10:00`、1560 → `翌2:00`。
- ボードの既定範囲は 06:00–22:00（360–1320）。「全時間」で 0–1800（翌6:00）まで。
- MVP の制限: 業務日の起点時刻を施設設定にすること、日をまたぐ予定の移動は作らない。

## 4. イベント

### 4.1 形
```
Event = EventMeta & EventBody
EventMeta = { id, ts, batchId, actorId? }
```
- `id`: UUID。重複配信の排除に使う。
- `batchId`: まとめて戻す単位。「型を当てる」「クイック操作」「欠勤」は複数イベントを1つの batchId に束ねる。
- `actorId`: 任意。見出しには出さず、履歴パネルでだけ見る。

### 4.2 種類
| 種類 | 内容 |
|---|---|
| `facility.set` | 施設と設定 |
| `group.upsert / remove`, `resident.upsert / remove`, `staff.upsert / remove`, `roleSlot.upsert / remove`, `template.upsert / remove`, `pattern.upsert / remove` | マスター |
| `roster.upsert / remove` | 出勤者。欠勤・早退は `absent: true` の upsert |
| `task.add { task, residentIds }` | 業務予定の追加（対象者つき） |
| `task.remove { id }` | 削除（Undo 用。通常の「中止」は `task.update {status:'cancelled'}`） |
| `task.update { id, patch }` | 名称・時刻・場所・必要人数・条件・メモ・状態・グループ・区分・案内項目 |
| `task.setTargets { id, residentIds }` | 対象者の差し替え |
| `task.done { id, done }` | 「終わった」の印の付け外し（決定記録 0010）。誰が付けたかは `actorId` に残し、画面には出さない |
| `assignment.add { assignment }` / `assignment.remove { id }` | 担当 |
| `day.setPattern { date, patternId? }` | その日に当てた型 |

### 4.3 リデューサの規則
- 決定的。ID・時刻はイベントに入れて渡し、リデューサ内で生成しない。
- 同じ `id` のイベントは一度だけ適用する（重複配信の排除）。
- `assignment.add` は同じ (taskId, staffId) が既にあれば無視（二重登録の最終防衛線）。
- `task.update` に `startMin/endMin` があれば `0 ≤ start < end ≤ 2880` を確認し、外れていれば無視して警告ログ。
- 各イベント適用後、その日の `DayMeta.updatedAt` を `ts` に更新する（マスターの変更は除く）。

### 4.4 Undo（打ち消し）
`invert(event, stateBefore)` で打ち消しイベントを作り、新しい batchId で追記する。履歴を消さない（同期と両立）。
| 元 | 打ち消し |
|---|---|
| `assignment.add` | `assignment.remove` |
| `assignment.remove` | `assignment.add`（元の assignment を復元） |
| `task.add` | `task.remove` |
| `task.remove` | `task.add`（元の task と対象者を復元） |
| `task.update` | `task.update`（変更前の値を patch に） |
| `task.setTargets` | `task.setTargets`（変更前の一覧） |
| `task.done` | `task.done`（変更前の値） |
| `roster.upsert` | `roster.upsert`（変更前）または `roster.remove`（新規だった場合） |
| `day.setPattern` | `day.setPattern`（変更前） |
UI の「元に戻す」は直近 10 の batchId を対象にする。一覧（batchId と label）は端末の localStorage に残し、読み込み直しても戻せる（打ち消しに要る「直前の状態」は起動時にイベント列から作り直す。他の端末で先に変わっていれば、打ち消しはその時点の状態に対して行う）。

## 5. 役割枠から担当を作る手順（「型を当てる」）
コマンド層（UI に近い純関数）が次を計算し、1つの batchId でイベント列を作る。
1. 対象日の既存の型由来タスク（`origin: "pattern"`）があれば `task.remove` で作り直す。手で足した予定（`origin: "manual"` または未設定）は残す。
2. `DayPattern.items` ごとに `TaskInstance` を作る。`name`・区分・案内項目は型からコピー。`residentIds` は `targetRule` から決める（`allInGroup` → そのグループの利用者全員、`residents` → 指定、`none` → 空）。
3. `slotIds` ごとに、その日の `RosterEntry` のうち `slotId` が一致し `absent=false` の職員を集め、重複なく `assignment.add`。人数が `headcount` を超えても全員付ける（充足バッジは「n人 多め」）。
4. `day.setPattern`。
結果の要約（枠数、担当が付いた数、担当未定・担当あと n 人の一覧）を UI が表示する。

## 6. クイック操作（コマンド）
いずれも「こう変わります」のプレビュー（イベント列の説明）を作ってから、承認で追記する。
- **付き添い・外出を追加**: `task.add`（個別、対象1名、必要1、`slotIds` 空）＋ `assignment.add`。選んだ職員の他の担当と重なるものは `assignment.remove` を提案（検証側が決定的に生成）。結果の未充足を一覧に出す。
- **欠勤・早退**: `roster.upsert {absent:true}`（早退は `endMin` の短縮）＋ その時間帯の `assignment.remove` 全件。結果の未充足を一覧に出す。
- **休憩をずらす**: 休憩カード間の `assignment.remove` ＋ `assignment.add`、または休憩カードの `task.update`（時刻）。重なりを確認。
- **長押しメニュー**: 中止＝`task.update {status:'cancelled'}`、ずらす＝`task.update {startMin,endMin}`、担当を外す＝`assignment.remove`。

## 6A. 施設の日課と24時間シート（決定記録 0004）

- **施設の日課**: 業務表（DayPattern）の項目のうち `routineId` を持つもの。同じ日課は業務表が違っても同じ `routineId`。一覧は `routinesOf(state, groupId)`（src/domain/routine.ts）。
- **24時間シート**: `ResidentSheet { residentId, rows: SheetRow[], updatedAt? }`。状態は `state.sheets[residentId]`。変更は `sheet.upsert`（シートを丸ごと置き換える。元に戻せる）。
- **SheetRow**: `routineId` ありは日課への調整（`startMin`/`endMin` で時刻の変更、`skip` でなし、どちらもなければ標準どおりで4項目だけ）。`routineId` なしはその方だけの行（`templateId` があれば個別の枠を作る。`weekdays` で曜日を限れる）。4項目は `rhythm`・`preference`・`canDo`・`support`。
- **時間割の作り方**（`applyPatternEvents` → `splitRoutineTargets`）: 対象の方を、標準どおり → 一括の枠、開始が枠の中 → 一括の枠のまま（`TaskInstance.targetTimes[residentId]` に時刻）、枠の外 → 別の枠（開始時刻ごとにまとめる。同じ `routineId`・同じ番・必要人数は業務の種類の標準）、`skip` → 入れない、に振り分ける。その方だけの行は `extraRowsForDate` から個別の枠（番はその方のグループの番で時刻に合うもの）。
- **今日を業務表として保存**（`patternFromDay`）は、日課から分かれた枠を残さない（日課ごとに対象の多い枠だけ）。
- シートの変更は、次に時間割を作るときから入る。当日反映は作り直し（確認つき）。

## 6C. 自分の予定の計算（`src/domain/myday.ts`）

- `viewerMinutes`: 見ている人の業務日の時刻。夜勤の人は勤務前の朝の時刻を「翌」として読む（夜勤明けの予定が出る）。
- `myDay`: いまの時間の予定（なければ最初の予定・つぎ）、きょうの流れ。過ぎた予定は `past` だけ（完了ではない）。
- `leaderContact` / `leaderSchedule`: 「困ったら」の相談先と、その一日の移り変わり（決定記録 0006）。
- `targetLines`: 業務詳細の対象の方。時刻が違う方 → サポートのある方 → 部屋番号の順。サポートは担当の人に勤務時間中だけ（0004 §4）。

## 6B. 職員表示（分担表）の計算（`src/domain/layout.ts`）

- `staffViewRows`: 出勤者ごとの担当の帯（重なりの印つき）。件数・予定時間は持たない。
- `watchLines`: グループごとの見守りのつながり。見守りは業務の名前「見守り」で始まる一括・共通の業務で見る（`isWatchTask`）。別の名前を付けた施設では最下段が出ない。業務の種類に「つながりで見る」印を持たせるのは本番の課題。
- `unfilledTasks`: 分担表の下に並べる「担当未定」「担当あと n 人」の枠（休憩を除く）。

## 7. 二重計上の防止
- 同じ利用者・同じ業務の型・重なる時刻に、個別予定と一括枠の両方がある場合は注意表示（禁止はしない）。
- 一括枠からの個別切り出しは作らない。必要なら「対象者から外す」＋「個別予定を作る」の2操作。

## 8. 保存と同期
- **ローカル**: ブラウザ内保存（localStorage）にイベント列を追記し、BroadcastChannel で同じブラウザの別タブへ即時に配る。起動時はイベント列を順に適用。「サンプルに戻す」でクリアして再シード。データが大きくなればスナップショット＋IndexedDB へ移す。
- **同期**（決定記録 0009、`supabase/schema.sql`）: Supabase の `events` テーブル（`id bigint identity pk`, `facility_code text`, `event_id text unique`, `batch_id text`, `ts timestamptz`, `payload jsonb`, `created_at`）。施設コードで絞った Realtime（insert）を購読し、`id` 順に適用。端末ではキャッシュに先に追記し、`event_id` で重複を捨てる。送れなかった分は未送信として端末に残し、次に送れたときに送る（`src/store/syncstore.ts`）。
- 競合は「後勝ち」で十分（同じ枠を同時に触る頻度は低い。結果は両端末で同じ順に適用される）。
- 施設コードは認証ではない。本番は認証と権限、端末に残さない設計が必要。

## 9. 作らなかった型
- `CareRecord`（簡易実施記録）: 決定記録 0001 で見送り、0010 で「終わった」の印だけを `TaskInstance.done`（`task.done` イベント）として持った。内容の記録・対象の方ごとの印（0010 決定 4）は作っていない。対象の方ごとの印を入れる場合は `doneResidentIds: ID[]` を同じ要領で足す（「記録なし」と「終わっていない」を区別する）。
