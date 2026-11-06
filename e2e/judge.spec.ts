import { expect, test } from "@playwright/test";

/**
 * 決定記録 0018: 素人の審査員の最初の 10 分。
 * - サンプル施設は ?now が無くても 10:12 から時計が進む。「更新」の代わりに「サンプル施設の一日」
 * - 最初の画面に 3 つの場面と「しないこと」
 * - スマホの名前一覧に「試すなら」とリーダーの札（サンプルのときだけ）
 */
test.describe("審査員の最初の 10 分（サンプル施設）", () => {
  test("?now なしでも 10:12 から時計が進み、見せ場が画面に入る", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-11-09T22:40:00+09:00") });
    await page.goto("/board");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    await expect(page.getByTestId("board-scroller").getByText("10:12", { exact: true })).toBeVisible();
    await expect(page.getByText("サンプル施設の一日")).toBeVisible();
    await expect(page.locator('[data-badge="担当あと1人"]').first()).toBeInViewport();
    await page.clock.fastForward("03:00");
    await expect(page.getByTestId("board-scroller").getByText("10:15", { exact: true })).toBeVisible();
  });

  test("最初の画面に 3 つの場面と「しないこと」。場面のリンクから開ける", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/");
    const scenes = page.getByRole("region", { name: /試せること/ });
    await expect(scenes.getByRole("listitem")).toHaveCount(3);
    await expect(page.getByRole("region", { name: "しないこと" })).toContainText("製品の中で AI は使いません");
    await scenes.getByRole("link", { name: /朝の準備を見る/ }).click();
    await expect(page.getByRole("heading", { name: "今日の時間割を作る" })).toBeVisible();
  });
});

test.describe("審査員の最初の 10 分（スマホ）", () => {
  test.use({ viewport: { width: 412, height: 915 } });
  test("名前一覧に「試すなら」とリーダーの札", async ({ page }) => {
    await page.goto("/me?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/me?now=10:12");
    await expect(page.getByText(/サンプル施設で試すなら: .*初日の人の画面.*リーダー/)).toBeVisible();
    const sato = page.getByRole("list", { name: "きょうの出勤者" }).getByRole("button", { name: /^佐藤 / });
    await expect(sato).toContainText("リーダー");
  });
});

test.describe("審査員の最初の 10 分（サンプルデータ）", () => {
  test("入浴介助「担当あと1人」の「＋」で空いている人が出て、追加するとバッジが消える", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    const bath = page.locator('[data-badge="担当あと1人"]').filter({ hasText: "入浴介助" }).first();
    const id = await bath.getAttribute("data-task-id");
    await bath.getByRole("button", { name: /に担当を追加$/ }).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByText(/空いている人 [1-9]/)).toBeVisible();
    await panel.getByRole("button", { name: "追加" }).first().click();
    await expect(page.locator(`[data-task-id="${id}"]`)).not.toHaveAttribute("data-badge", /.+/);
  });

  test("次の日（11/5）に「この内容で作る」を押しても、夜勤の枠は担当未定にならない", async ({ page }) => {
    await page.goto("/board?date=2026-11-05&now=7:00");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?date=2026-11-05&now=7:00");
    await page.getByRole("button", { name: "この内容で作る" }).click();
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    const nightUnassigned = page.locator('[data-task-id][data-badge="担当未定"]').filter({ hasText: /夜勤|巡視/ });
    await expect(nightUnassigned).toHaveCount(0);
  });
});

test.describe("ループ 16 の持ち越し", () => {
  test("［利用者ごと］に切り替えた直後も、現在時刻の 1 時間前に寄っている", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    await page.getByRole("button", { name: "利用者ごと", exact: true }).click();
    await expect(page.getByTestId("board-scroller").getByText("10:12", { exact: true })).toBeInViewport();
  });

  test("ⓘ の説明はツールバーの下に出て、札は折れない", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    const chip = page.getByRole("button", { name: /^担当未定 \d+件/ });
    const h = (await chip.boundingBox())!.height;
    await page.getByRole("button", { name: "この数字について" }).click();
    await expect(page.locator("#board-note")).toBeVisible();
    expect((await chip.boundingBox())!.height).toBe(h);
  });
});

test.describe("ループ 14・15 の持ち越し", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
  });

  test("見るグループを選ぶと、件数をグループと共通に分けて書き、押すとそのグループの枠から移る", async ({ page }) => {
    await page.getByLabel("見るグループ").selectOption({ label: "東フロア" });
    const chip = page.getByRole("button", { name: /^担当未定 \d+件/ });
    await expect(chip).toContainText(/（東フロア \d+・共通 \d+）/);
    await chip.click();
    const focused = page.locator("[data-task-id]:has(button:focus)");
    await expect(focused).toHaveAttribute("data-group", "grp-east");
  });

  test("利用者ごとの列の中は ↓ で次の枠へ移る", async ({ page }) => {
    await page.getByRole("button", { name: "利用者ごと", exact: true }).click();
    const col = page.getByRole("group", { name: /様$/ }).first();
    const titles = col.locator("[data-card-title]");
    expect(await titles.count()).toBeGreaterThan(1);
    await titles.first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(titles.nth(1)).toBeFocused();
  });

  test("職員ごとの帯で、終わった枠は「✓ 終わった」と文字で出る", async ({ page }) => {
    await page.getByRole("button", { name: "職員ごと", exact: true }).click();
    await expect(page.getByTestId("staff-view").getByText("✓ 終わった").first()).toBeVisible();
  });
});

test.describe("見た目（決定記録 0019）", () => {
  test("最初の画面にボードとスマホの画面写真とロゴ", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("img", { name: /^ボード:/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /^スマホの自分の予定/ })).toBeVisible();
  });

  test("現在時刻の線はカードの後ろ、列の見出しにグループの帯、細いカードは始まりの時刻だけ", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    const z = await page.evaluate(() => {
      const line = [...document.querySelectorAll<HTMLElement>("[data-testid=board-scroller] div")].find((d) => d.className.includes("border-[var(--cn-now)]"))!.parentElement!;
      const card = document.querySelector<HTMLElement>("[data-task-id]")!.parentElement!;
      return { line: Number(getComputedStyle(line).zIndex), card: Number(getComputedStyle(card).zIndex) };
    });
    expect(z.line).toBeLessThan(z.card);
    const head = page.getByTestId("board-scroller").getByRole("heading", { level: 2 }).first();
    expect(await head.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("4px");
    // 横に並ぶ細いカード（さくらユニットの見守り 9:30）は「9:30〜」
    await expect(page.locator("[data-task-id]").filter({ hasText: "9:30〜" }).first()).toBeVisible();
  });
});

test.describe("ダークモード（決定記録 0020）", () => {
  test("端末が暗い設定なら紺の画面。設定で「明るい」にすると明るく、読み込み直しても同じ。印刷は明るい", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(await bg()).toBe("rgb(15, 27, 45)");
    await page.goto("/setup");
    await page.getByRole("group", { name: "画面の明るさ" }).getByRole("button", { name: "明るい" }).click();
    expect(await bg()).toBe("rgb(243, 243, 239)");
    await page.reload();
    expect(await bg()).toBe("rgb(243, 243, 239)");
    await page.getByRole("group", { name: "画面の明るさ" }).getByRole("button", { name: "暗い（紺）" }).click();
    await page.emulateMedia({ colorScheme: "light" });
    expect(await bg()).toBe("rgb(15, 27, 45)");
    await page.emulateMedia({ media: "print" });
    expect(await bg()).toBe("rgb(255, 255, 255)");
  });
});
