import { expect, test } from "@playwright/test";

/**
 * D2: ボードの職員表示（横軸［職員］）と分担表の印刷。
 * docs/acceptance.md: 重なり・勤務外・休憩・見守りの空きが見える。件数・予定時間は出ない。分担表は A4 横。
 */
test.describe("ボードの職員表示と分担表", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    await page.getByRole("group", { name: "横軸" }).getByRole("button", { name: "職員" }).click();
  });

  test("職員ごとに担当の帯が並び、見守りのつながりが出る。人に数字を付けない", async ({ page }) => {
    const view = page.getByTestId("staff-view");
    await expect(view).toBeVisible();
    await expect(page.getByRole("button", { name: "職員" })).toHaveAttribute("aria-pressed", "true");
    const rows = view.locator("[data-staff-row]");
    expect(await rows.count()).toBeGreaterThan(8);
    await expect(view.getByRole("list", { name: "見守りのつながり" }).getByText("見守り").first()).toBeVisible();
    // 休憩の帯がある（点線）。件数・予定時間は出ない
    await expect(view.getByRole("button", { name: /休憩/ }).first()).toBeVisible();
    const text = await view.innerText();
    expect(text).not.toMatch(/\d+件|計\d|時間\d+分/);
  });

  test("帯を押すと業務の詳細が開く", async ({ page }) => {
    await page.getByTestId("staff-view").getByRole("button", { name: /、佐藤さん、/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("キーボード: Tab は行ごとに 1 回、行の中は → で次の帯へ。Enter で詳細が開き、条件が出る", async ({ page }) => {
    const view = page.getByTestId("staff-view");
    const sato = view.getByRole("group", { name: /^佐藤さんの担当/ });
    const bars = sato.getByRole("button");
    expect(await bars.count()).toBeGreaterThan(1);
    // 行の最初の帯だけ Tab で止まる
    const tabs = await bars.evaluateAll((els) => els.map((e) => e.getAttribute("tabindex")));
    expect(tabs[0]).toBe("0");
    expect(tabs.slice(1).every((t) => t === "-1")).toBe(true);
    await bars.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(bars.nth(1)).toBeFocused();
    await page.keyboard.press("End");
    await expect(bars.last()).toBeFocused();
    await page.keyboard.press("Home");
    await expect(bars.first()).toBeFocused();
    // 隣の行へは Tab 1 回（この行の残りの帯は飛ばす）
    await page.keyboard.press("Tab");
    expect(await sato.evaluate((el) => el.contains(document.activeElement))).toBe(false);
    // 入浴介助の帯を Enter で開くと、詳細に「条件: 入浴担当可」
    const bath = view.getByRole("button", { name: /入浴介助.*、鈴木さん、/ }).first();
    await bath.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("条件: 入浴担当可");
  });

  test("同じ人の時間が重なると「重なり」と出る", async ({ page }) => {
    // 高橋さんを、すでに担当している時間の別の業務へ足す（注意として許可される）
    await page.getByRole("button", { name: "グループ" }).click();
    const card = page.locator("[data-task-id]").filter({ hasText: "入浴介助" }).filter({ hasText: "担当あと" }).first();
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("button", { name: /に担当を追加$/ }).click();
    const panel = page.getByRole("dialog");
    const others = panel.getByRole("button", { name: /^ほかの人/ });
    if ((await others.getAttribute("aria-expanded")) !== "true") await others.click();
    const overlapper = panel.getByRole("listitem").filter({ hasText: "重なります" }).first();
    const surname = (await overlapper.getByRole("button", { name: /さんを追加$/ }).getAttribute("aria-label"))!.replace(/さんを追加$/, "").trim();
    await overlapper.getByRole("button", { name: /さんを追加$/ }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "職員" }).click();
    await expect(page.getByTestId("staff-view").locator(`[data-staff-row="${surname}"]`).getByText("重なり").first()).toBeVisible();
    await expect(page.getByTestId("staff-view").getByText("重なり").first()).toBeVisible();
  });

  test("見出しの「担当未定」を押すと、グループ表示に戻ってカードへ寄せる", async ({ page }) => {
    await page.getByRole("button", { name: /^担当未定 \d+件/ }).click();
    await expect(page.getByRole("button", { name: "グループ" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-task-id][data-badge="担当未定"]').first()).toBeVisible();
  });

  test("分担表の印刷: A4 横（日中・夜間の2枚）で、日付・施設名・担当が決まっていない枠の一覧が出て、ボードは隠れる", async ({ page }) => {
    await page.emulateMedia({ media: "print" });
    const sheet = page.getByTestId("staff-sheet-print");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading", { name: /分担表 11月3日（火） 日中 6:00/ })).toBeVisible();
    await expect(sheet.getByRole("heading", { name: /分担表 11月3日（火） 夜間 18:00/ })).toBeVisible();
    await expect(sheet).toContainText("ひまわり苑");
    await expect(sheet.getByRole("region", { name: "担当未定・担当あと n 人の枠" })).toContainText("担当未定");
    await expect(page.getByRole("complementary", { name: "きょうの出勤者" })).toBeHidden();
    // 紙の幅（A4 横）に収まる: 横にはみ出さない
    const box = await sheet.boundingBox();
    const vw = page.viewportSize()!.width;
    expect(box!.width).toBeLessThanOrEqual(vw);
    await page.screenshot({ path: "test-results/staff-sheet-print.png", fullPage: true });
  });

  test("⋯ → 今日を業務表として保存: 名前を入れて保存し、元に戻せる", async ({ page }) => {
    await page.getByRole("button", { name: "ほかの操作" }).click();
    await page.getByRole("button", { name: "今日を業務表として保存" }).click();
    const dialog = page.getByRole("dialog", { name: "今日を業務表として保存" });
    await expect(dialog.getByText("担当の人は保存しません")).toBeVisible();
    // 既定は今日を作った業務表を書き換える。新しい名前で残すこともできる（ループ 23）
    const radios = dialog.getByRole("radio");
    if ((await radios.count()) > 0) {
      await expect(radios.first()).toBeChecked();
      await dialog.getByRole("radio", { name: /新しい名前で残す/ }).check();
    }
    await dialog.getByLabel("業務表の名前").fill("入浴日（11/3版）");
    await dialog.getByRole("button", { name: "この内容で保存" }).click();
    await expect(page.locator("#board-toast")).toContainText("業務表「入浴日（11/3版）」を保存しました");
    await expect(page.getByRole("button", { name: /元に戻す ?（業務表/ })).toBeVisible();
  });
});

test.describe("今日を業務表として保存（ループ 23）", () => {
  test("既定は今日を作った業務表を書き換え、次に同じ業務表で作る日から効く", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    await page.getByRole("button", { name: "ほかの操作" }).click();
    await page.getByRole("button", { name: "今日を業務表として保存" }).click();
    const dialog = page.getByRole("dialog", { name: "今日を業務表として保存" });
    await expect(dialog.getByRole("radio", { name: /を書き換える/ })).toBeChecked();
    await dialog.getByRole("button", { name: "この内容で保存" }).click();
    await expect(page.locator("#board-toast")).toContainText("を今日の内容に書き換えました");
  });
});
