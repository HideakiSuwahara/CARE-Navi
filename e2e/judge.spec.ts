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
    // 負荷が高いときは寄せるのが遅れるので待つ（全件を並列で回したときに 1 回落ちた）
    await expect(page.locator('[data-badge="担当あと1人"]').first()).toBeInViewport({ timeout: 15_000 });
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

test.describe("ループ 18（暗い画面と見た目の直し）", () => {
  test("設定の先頭の目次から「画面の明るさ」へ飛べ、選んだものに ✓ が付く", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    await page.goto("/setup");
    await page.getByRole("navigation", { name: "このページの中" }).getByRole("link", { name: "画面の明るさ" }).click();
    const group = page.getByRole("group", { name: "画面の明るさ" });
    await expect(group).toBeInViewport();
    await group.getByRole("button", { name: "暗い（紺）" }).click();
    await expect(group.getByRole("button", { name: "暗い（紺）" })).toContainText("✓");
    await expect(page.getByText("画面の明るさを「暗い（紺）」にしました")).toBeAttached();
    // 暗い画面のトーストは紺の地（明るい地にしない）
    await page.goto("/board?now=10:12");
    await page.getByRole("button", { name: /に担当を追加$/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "追加" }).first().click();
    const toast = page.locator("#board-toast > div").first();
    await expect(toast).toBeVisible();
    expect(await toast.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(34, 52, 79)");
    // 元に戻したあとのお知らせには「元に戻す」を出さない
    await toast.getByRole("button", { name: "元に戻す" }).click();
    await expect(page.locator("#board-toast")).toContainText("元に戻しました");
    await expect(page.locator("#board-toast").getByRole("button", { name: "元に戻す" })).toHaveCount(0);
  });
});

test.describe("ループ 12・13・18 の持ち越し", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
  });

  test("ボードの日付を押して日を選ぶと、その日のボードへ移る", async ({ page }) => {
    await expect(page.getByRole("button", { name: /押すと日付を選べます/ })).toBeVisible();
    await page.locator('nav[aria-label="日付"] input[type="date"]').fill("2026-11-09");
    await expect(page).toHaveURL(/date=2026-11-09/);
    await expect(page.getByRole("button", { name: /11月9日（月）/ })).toBeVisible();
  });

  test("利用者一覧の名前を押すと、その方を選んだ状態で「1 人ずつ足す・直す」が開く", async ({ page }) => {
    await page.goto("/residents");
    // 名前のボタンは「101 山田 キヨ 様 （直す）」
    const name = page.getByRole("button", { name: /^101 .+（直す）$/ });
    await name.click();
    await expect(page.getByLabel(/名前/).first()).toHaveValue("山田 キヨ");
  });

  test("利用者がまだいないグループの列には、次の 1 手を書く", async ({ page }) => {
    await page.goto("/setup");
    await page.getByLabel(/^グループを足す/).fill("すみれ");
    await page.getByRole("button", { name: "＋ グループを足す" }).click();
    await page.goto("/board?date=2026-11-12&now=7:00");
    await page.getByRole("button", { name: "この内容で作る" }).click();
    await expect(page.getByTestId("board-scroller").getByText("利用者がまだいません（利用者の画面で足せます）")).toBeVisible();
  });
});

test.describe("ループ 19（元に戻すの範囲・まだ来ていない日）", () => {
  test("ほかの日（11/5）で作った時間割は、11/3 のボードの「元に戻す」に出ない。まだ来ていない日に現在時刻の線を出さない", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?date=2026-11-05&now=7:00");
    await page.getByRole("button", { name: "この内容で作る" }).click();
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    // 11/5 は 11/3（サンプルの今日）より先の日: 線も「終わっていない」も出さない
    await expect(page.locator(".cn-now-label")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^終わっていない/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^元に戻す ?（今日の時間割を作りました）/ })).toBeVisible();
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^元に戻す ?（今日の時間割を作りました）/ })).toHaveCount(0);
  });
});

test.describe("ループ 19（スマホの元に戻す）", () => {
  test("自分の予定の「元に戻す」は、リーダーの操作（時間割を作る）を出さない", async ({ page }) => {
    // リーダーが PC で 11/5 の時間割を作る
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?date=2026-11-05&now=7:00");
    await page.getByRole("button", { name: "この内容で作る" }).click();
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    // 同じ端末をスマホの幅で、応援の人が開く
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto("/me?now=10:12");
    await page.getByRole("list", { name: "きょうの出勤者" }).getByRole("button", { name: /^加藤 / }).click();
    await expect(page.getByRole("button", { name: /今日の時間割を作りました/ })).toHaveCount(0);
  });
});

test.describe("ループ 19 の持ち越し（朝の帯・印刷）", () => {
  test("夜勤の番の人が全員初回なら、朝の帯に一言出る（止めない）", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?date=2026-11-05&now=7:00");
    await expect(page.getByText(/夜勤の番の人は全員、この施設で初めての勤務です/)).toBeVisible();
    await expect(page.getByRole("button", { name: "この内容で作る" })).toBeEnabled();
  });

  test("サンプル施設の自分の予定の印刷は、サンプルの日と時計で日時を出す", async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto("/me?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/me?now=10:12");
    await page.getByRole("list", { name: "きょうの出勤者" }).getByRole("button", { name: /^高橋 / }).click();
    await page.emulateMedia({ media: "print" });
    await expect(page.getByText(/印刷 11\/3 10:12/)).toBeVisible();
  });
});
