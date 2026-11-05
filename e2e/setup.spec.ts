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
});
