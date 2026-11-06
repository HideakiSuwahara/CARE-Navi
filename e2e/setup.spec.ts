import { expect, test } from "@playwright/test";

/**
 * 設定（PC）。docs/acceptance.md「使い始め（設定）」
 */
test.describe("設定", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/setup");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/setup");
  });

  test("はじめて開くとボタン2つだけ（同期が使える環境では3つ）。「サンプル施設で試す」でボードへ", async ({ page }) => {
    const main = page.locator("main");
    // 同期が使える環境では「施設コードで参加」が加わって 3 つ
    await expect(main.getByRole("button")).toHaveCount(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 3 : 2);
    await main.getByRole("button", { name: "サンプル施設で試す" }).click();
    await expect(page).toHaveURL(/\/board/);
  });

  test("自分の施設で始める: 貼り付けの失敗行は理由つきで、他は取り込んでボードへ", async ({ page }) => {
    await page.getByRole("button", { name: "自分の施設で始める" }).click();
    await page.getByLabel("施設の名前").fill("みどり荘");
    await page.getByLabel(/^グループ（必須/).fill("2階\nあおばユニット");
    await page.getByRole("textbox", { name: "2. 利用者を貼り付け" }).fill("菅野 ハル, 2階, 201\n熊谷 トメ, 3階, 301");
    await page.getByRole("textbox", { name: "3. 職員を貼り付け" }).fill("野村 ミホ, 介護福祉士, 入浴担当可, 811\n川口 ジュン, 介護職員");
    await expect(page.getByText("2行目: グループ「3階」が見つかりません")).toBeVisible();
    await page.getByRole("button", { name: "登録する" }).click();
    await expect(page).toHaveURL(/\/board/);
    await expect(page.getByText("みどり荘")).toBeVisible();
    await expect(page.getByText(/登録しました（グループ 2・利用者 1人・職員 2人）。取り込めなかった行: 利用者 1・職員 0/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "今日の時間割を作る" })).toBeVisible();
    // はじめての日: 職員を全員「休み」で並べ、来る人を1タップで出勤にする。番の名前に雛形のグループ名が残らない
    const list = page.getByRole("list", { name: "今日の出勤者" });
    await expect(list.getByRole("button", { name: "出勤にする" })).toHaveCount(2);
    await list.getByRole("button", { name: "出勤にする" }).first().click();
    const select = list.getByRole("combobox").first();
    const options = await select.locator("option").allTextContents();
    expect(options.join(" ")).not.toMatch(/東|さくら/);
    // 介護職員は番が空（番を選ぶ）。選ぶまで「この内容で作る」は押せない
    await expect(page.getByRole("button", { name: "この内容で作る" })).toBeDisabled();
    await select.selectOption({ label: "早番A" });
    await page.getByRole("button", { name: "この内容で作る" }).click();
    await expect(page.getByRole("heading", { name: "今日の時間割を作る" })).toHaveCount(0);
  });

  test("ふだんの設定: 施設コード・利用者名・初回の職員の警告。変えると元に戻せる", async ({ page }) => {
    await page.getByRole("button", { name: "サンプル施設で試す" }).click();
    await page.goto("/setup");
    await expect(page.getByRole("heading", { name: "施設コード" })).toBeVisible();
    const full = page.getByRole("button", { name: /^フルネーム/ });
    await full.click();
    await expect(full).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status").filter({ hasText: "フルネーム" })).toBeVisible();
    await page.getByRole("button", { name: "元に戻す" }).first().click();
    await expect(page.getByRole("button", { name: /^部屋番号＋姓/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "しない" }).click();
    await expect(page.getByRole("button", { name: "しない" })).toHaveAttribute("aria-pressed", "true");
  });

  test("職員の担当条件: 1 タップで付け外しでき、ボードの候補の理由に効く。元に戻せる", async ({ page }) => {
    await page.getByRole("button", { name: "サンプル施設で試す" }).click();
    await page.goto("/setup");
    const list = page.getByRole("list", { name: "職員ごとの担当条件" });
    const nakamura = list.getByRole("button", { name: "中村さんの入浴担当可", exact: true });
    await expect(nakamura).toHaveAttribute("aria-pressed", "false");
    await nakamura.click();
    await expect(nakamura).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status").filter({ hasText: "中村さんの担当条件に「入浴担当可」を付けました" })).toBeVisible();
    // ほかの条件を足す → 誰かに付けるまでは選択肢として出るだけ
    await page.getByLabel(/^ほかの条件を足す/).fill("喀痰吸引");
    await page.getByRole("button", { name: "条件を足す" }).click();
    await expect(page.getByText("「喀痰吸引」を足しました")).toBeVisible();
    await expect(list.getByRole("button", { name: /^佐藤さんの喀痰吸引/ })).toHaveAttribute("aria-pressed", "false");
    // 既にある条件は足さず、その旨を出す
    await page.getByLabel(/^ほかの条件を足す/).fill("看護師");
    await page.getByRole("button", { name: "条件を足す" }).click();
    await expect(page.getByText("「看護師」はすでにあります")).toBeVisible();
    // ボード: 入浴介助の候補で、中村さんの理由に「条件」が出なくなる
    await page.goto("/board?now=10:12");
    const card = page.locator("[data-task-id]").filter({ hasText: "入浴介助" }).filter({ hasText: "担当あと" }).first();
    await card.getByRole("button", { name: /に担当を追加$/ }).click();
    const panel = page.getByRole("dialog");
    const folded = panel.getByRole("button", { name: /^ほかの人（注意/ });
    if ((await folded.getAttribute("aria-expanded")) === "false") await folded.click();
    const row = panel.getByRole("listitem").filter({ hasText: /^中村/ }).first();
    await expect(row).toBeVisible();
    await expect(row).not.toContainText("条件「入浴担当可」");
    // 元に戻す（設定へ戻って）
    await page.goto("/setup");
    await page.getByRole("button", { name: "元に戻す" }).first().click();
    await expect(page.getByRole("list", { name: "職員ごとの担当条件" }).getByRole("button", { name: "中村さんの入浴担当可", exact: true })).toHaveAttribute("aria-pressed", "false");
  });

  test("職員を 1 人ずつ足す・直す・退職。元に戻せる", async ({ page }) => {
    await page.getByRole("button", { name: "サンプル施設で試す" }).click();
    await page.goto("/setup");
    // 足す
    await page.getByRole("button", { name: "＋ 1 人ずつ足す" }).click();
    const form = page.getByRole("form", { name: "職員を 1 人足す" });
    await form.getByLabel("名前（姓 名）").fill("野村 ミホ");
    await form.getByLabel("職種").fill("介護福祉士");
    await form.getByLabel("PHS（任意）").fill("811");
    await form.getByRole("button", { name: "入浴担当可", exact: true }).click();
    await form.getByRole("button", { name: "この内容で足す" }).click();
    await expect(page.getByRole("status").filter({ hasText: "野村さんを足しました" })).toBeVisible();
    const list = page.getByRole("list", { name: "職員ごとの担当条件" });
    await expect(list.getByRole("button", { name: "野村さんの入浴担当可", exact: true })).toHaveAttribute("aria-pressed", "true");
    // 同じ名前は足せない
    await page.getByRole("button", { name: "＋ 1 人ずつ足す" }).click();
    await form.getByLabel("名前（姓 名）").fill("野村 ミホ");
    await form.getByLabel("職種").fill("介護職員");
    await form.getByRole("button", { name: "この内容で足す" }).click();
    await expect(form.getByRole("alert")).toContainText("すでに登録されています");
    await form.getByRole("button", { name: "閉じる" }).click();
    // 直す: PHS
    await list.getByRole("button", { name: /^野村さんを直す/ }).click();
    const edit = page.getByRole("form", { name: "野村さんを直す" });
    await edit.getByLabel("PHS（任意）").fill("812");
    await edit.getByRole("button", { name: "この内容で直す" }).click();
    await expect(page.getByRole("status").filter({ hasText: "野村さんを直しました" })).toBeVisible();
    // 退職 → 一覧から消える → 元に戻す
    await list.getByRole("button", { name: /^野村さんを直す/ }).click();
    await edit.getByRole("button", { name: "退職にする…" }).click();
    await expect(edit).toContainText("今日以降の担当はありません");
    await edit.getByRole("button", { name: "外す（元に戻せます）" }).click();
    await expect(page.getByRole("status").filter({ hasText: "野村さんを退職にしました" })).toBeVisible();
    await expect(list.getByRole("button", { name: /^野村さんを直す/ })).toHaveCount(0);
    await page.getByRole("button", { name: "元に戻す" }).first().click();
    await expect(list.getByRole("button", { name: /^野村さんを直す/ })).toBeVisible();
  });

  test("退職: 今日以降の担当がある人は、件数を知らせてから外す。出勤者から消え、元に戻すで戻る", async ({ page }) => {
    await page.getByRole("button", { name: "サンプル施設で試す" }).click();
    await page.goto("/setup");
    const list = page.getByRole("list", { name: "職員ごとの担当条件" });
    await list.getByRole("button", { name: /^高橋さんを直す/ }).click();
    const edit = page.getByRole("form", { name: "高橋さんを直す" });
    await edit.getByRole("button", { name: "退職にする…" }).click();
    await expect(edit).toContainText(/今日以降の担当 \d+件からも外れます/);
    await edit.getByRole("button", { name: "外す（元に戻せます）" }).click();
    await expect(page.getByRole("status").filter({ hasText: /高橋さんを退職にしました（今日以降の担当 \d+件から外れました）/ })).toBeVisible();
    await page.goto("/board?now=10:12");
    await expect(page.getByLabel("きょうの出勤者")).not.toContainText("高橋");
    await page.getByRole("button", { name: /^元に戻す/ }).first().click();
    await expect(page.getByLabel("きょうの出勤者")).toContainText("高橋");
  });

  test("月の勤務表を貼り付ける: 表を貼ると日付ごとの番が入り、朝の帯がその番で並ぶ。照らせない略称は選ぶ。名簿と照らせない名前は知らせる", async ({ page }) => {
    await page.getByRole("button", { name: "サンプル施設で試す" }).click();
    await page.goto("/setup");
    await page.getByLabel(/^何月の勤務表ですか/).fill("2026-12");
    const text = ["氏名\t1\t2", "佐藤\t早A\t休", "高橋\t日B\tナイト", "川口 太郎\t早A\t早A"].join("\n");
    await page.getByRole("textbox", { name: "勤務表", exact: true }).fill(text);
    await expect(page.getByText("12/1〜12/2 の 2 日・2 人を入れられます")).toBeVisible();
    await expect(page.getByText(/名簿と照らせない名前.*川口 太郎/)).toBeVisible();
    await expect(page.getByText("読んだ対応: 早A→早番A・日B→日勤B")).toBeVisible();
    await expect(page.getByText("休みとして読んだ印: 休")).toBeVisible();
    const apply = page.getByRole("button", { name: "この内容で入れる" });
    await expect(apply).toBeDisabled();
    await expect(page.getByText("「ナイト」の番を選ぶと押せます。")).toBeVisible();
    await page.getByLabel("「ナイト」の番").selectOption({ label: "夜勤東" });
    await expect(apply).toBeEnabled();
    await apply.click();
    await expect(page.getByRole("status").filter({ hasText: "勤務表を入れました（12/1〜12/2・2人）" })).toBeVisible();
    // ボード 12/2: 朝の帯が入れてある番で並ぶ（佐藤は休み、高橋は夜勤東）
    await page.goto("/board?date=2026-12-02&now=7:00");
    await expect(page.getByText("勤務表どおり（12/2）に並べました")).toBeVisible();
    const band = page.getByRole("region", { name: /今日の時間割を作る/ }).or(page.locator("section").filter({ has: page.getByRole("heading", { name: "今日の時間割を作る" }) })).first();
    await expect(band.getByLabel("高橋 の番")).toHaveValue(/.+/);
    const takahashiSlot = await band.getByLabel("高橋 の番").evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent ?? "");
    expect(takahashiSlot).toContain("夜勤東");
    // 元に戻す
    await page.goto("/setup");
    await page.getByRole("button", { name: "元に戻す" }).first().click();
    await page.goto("/board?date=2026-12-02&now=7:00");
    await expect(page.getByText(/勤務表どおり（12\/2）に並べました/)).toHaveCount(0);
  });

  test("追加・変更: グループを足すと番と日課が入り次の日のボードに出る。名前を変える。所属が残る間は外せない。番の時刻を直しても入れてある勤務表は変わらない", async ({ page }) => {
    await page.getByRole("button", { name: "サンプル施設で試す" }).click();
    await page.goto("/setup");
    await expect(page.getByRole("heading", { name: "追加・変更" })).toBeVisible();
    // 施設の名前
    await page.getByLabel("名前（上部バーに出ます）").fill("ひまわり苑 本館");
    await page.getByRole("button", { name: "この名前にする" }).click();
    await expect(page.getByRole("status").filter({ hasText: "施設の名前を「ひまわり苑 本館」にしました" })).toBeVisible();
    // グループを足す
    await page.getByLabel(/^グループを足す/).fill("3階");
    await page.getByRole("button", { name: "＋ グループを足す" }).click();
    await expect(page.getByRole("status").filter({ hasText: /グループ「3階」をフロアとして足しました（番 \d+: .*・業務表の枠 \d+/ })).toBeVisible();
    const groupList = page.getByRole("list", { name: "グループの一覧" });
    await expect(groupList).toContainText("3階");
    await expect(page.getByRole("list", { name: "番の一覧" })).toContainText("3階");
    // 時間割がまだない日（11/5）のボードに 3階 の列と枠が出る（朝の帯 → この内容で作る）
    await page.goto("/board?date=2026-11-05&now=7:00");
    await page.getByRole("button", { name: "この内容で作る" }).click();
    await expect(page.getByLabel("時間割").getByText("3階", { exact: true })).toBeVisible();
    expect(await page.locator("[data-task-id]").count()).toBeGreaterThan(0);
    // 名前を変える → ボードの見出しも変わる
    await page.goto("/setup");
    const row = groupList.getByRole("listitem").filter({ hasText: "3階" });
    await row.getByRole("button", { name: "名前を変える" }).click();
    await page.getByLabel("3階の新しい名前").fill("4階");
    await row.getByRole("button", { name: "この名前にする" }).click();
    await expect(page.getByRole("status").filter({ hasText: "グループ「3階」を「4階」にしました" })).toBeVisible();
    // 所属が残るグループ（東フロア）は外せない
    await groupList.getByRole("button", { name: "東フロアを外す" }).click();
    await expect(page.getByRole("region", { name: "グループ（ユニット・フロア）" }).getByRole("alert")).toContainText("所属しています");
    // 番の時刻を直す: 早番A を 7:30 に。11/3 の佐藤の出勤は 7:00 のまま
    await page.getByRole("button", { name: "番「早番A」を直す" }).click();
    await page.getByRole("form", { name: "番「早番A」の編集" }).getByLabel(/^開始/).fill("7:30");
    await page.getByRole("button", { name: "この内容で直す" }).click();
    await expect(page.getByRole("status").filter({ hasText: "番「早番A」を直しました（入れてある勤務表の時刻はそのままです）" })).toBeVisible();
    await page.goto("/board?now=10:12");
    await expect(page.getByLabel("きょうの出勤者")).toContainText("7:00–16:00");
  });

  test("追加・変更: 種類を選んでグループを足す。キーボードの人のフォーカスが迷わない。職員の所属を直せる", async ({ page }) => {
    await page.getByRole("button", { name: "サンプル施設で試す" }).click();
    await page.goto("/setup");
    await page.getByLabel(/^グループを足す/).fill("すみれ");
    await page.getByRole("button", { name: "ユニット", exact: true }).click();
    await page.getByRole("button", { name: "＋ グループを足す" }).click();
    await expect(page.getByRole("status").filter({ hasText: "グループ「すみれ」をユニットとして足しました" })).toBeVisible();
    await expect(page.getByLabel(/^グループを足す/)).toBeFocused();
    const groupList = page.getByRole("list", { name: "グループの一覧" });
    await expect(groupList.getByRole("listitem").filter({ hasText: "すみれ" })).toContainText("ユニット");
    // 名前を変えるを押すと、入力へフォーカス
    await groupList.getByRole("listitem").filter({ hasText: "すみれ" }).getByRole("button", { name: "名前を変える" }).click();
    await expect(page.getByLabel("すみれの新しい名前")).toBeFocused();
    // 外せない理由はその行に出る
    const east = groupList.getByRole("listitem").filter({ hasText: "東フロア" });
    await east.getByRole("button", { name: "東フロアを外す" }).click();
    await expect(east.getByRole("alert")).toContainText("所属しています");
    await expect(east.getByRole("link", { name: "職員の欄へ" })).toBeVisible();
    // ＋ 番を足す → 名前の欄へ。夜勤を 17:00／9:00 で入れても翌9:00
    await page.getByRole("button", { name: "＋ 番を足す" }).click();
    await expect(page.locator("#slot-name")).toBeFocused();
    await page.locator("#slot-name").fill("夜勤X");
    await page.locator("#slot-start").fill("17:00");
    await page.locator("#slot-end").fill("9:00");
    await page.getByRole("button", { name: "この内容で足す" }).click();
    await expect(page.getByRole("status").filter({ hasText: "終わりを 翌9:00 として入れました" })).toBeVisible();
    await expect(page.getByRole("button", { name: "＋ 番を足す" })).toBeFocused();
    // 職員の所属を直す: 高橋さんを すみれ へ
    const staffList = page.getByRole("list", { name: "職員ごとの担当条件" });
    await staffList.getByRole("button", { name: /^高橋さんを直す/ }).click();
    const edit = page.getByRole("form", { name: "高橋さんを直す" });
    await edit.getByLabel("所属（グループ）").selectOption({ label: "すみれ" });
    await edit.getByRole("button", { name: "この内容で直す" }).click();
    await expect(groupList.getByRole("listitem").filter({ hasText: "すみれ" })).toContainText("職員 1人");
  });
});

test("トップの「サンプル施設で試す」からボードを見たあと設定を開くと、「はじめに」ではなく追加・変更が出る（ループ 16）", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await page.getByRole("link", { name: "サンプル施設で試す" }).click();
  await expect(page.locator("[data-task-id]").first()).toBeVisible();
  await page.goto("/setup");
  await expect(page.getByRole("heading", { name: "追加・変更" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "はじめに" })).toHaveCount(0);
});
