import { expect, test, type Page } from "@playwright/test";

/**
 * D4: 全体（リーダーのスマホ）。docs/acceptance.md「全体（リーダーのスマホ）」、S3
 */
async function openAll(page: Page, now = "10:12", surname = "佐藤") {
  await page.goto(`/me?now=${now}`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/me?now=${now}`);
  await page.getByRole("list", { name: "きょうの出勤者" }).getByRole("button", { name: new RegExp(`^${surname} `) }).click();
  await page.getByRole("navigation", { name: "自分の予定と全体の切替" }).getByRole("link", { name: "全体" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "全体" })).toBeVisible();
}

test.describe("全体（リーダーのスマホ）", () => {
  test("リーダーでない人には［自分｜全体］を出さない", async ({ page }) => {
    await page.goto("/me?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/me?now=10:12");
    await page.getByRole("list", { name: "きょうの出勤者" }).getByRole("button", { name: /^高橋 / }).click();
    await expect(page.getByRole("heading", { level: 1, name: /高橋 さん/ })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "自分の予定と全体の切替" })).toHaveCount(0);
  });

  test("各行に「⋯」、未充足の行に「＋」。画面下にクイック操作と元に戻す。休憩にバッジはない", async ({ page }) => {
    await openAll(page);
    const list = page.getByRole("list", { name: "きょうの業務（時間順）" });
    const rows = list.locator("[data-all-task]");
    const n = await rows.count();
    expect(n).toBeGreaterThan(10);
    await expect(list.getByRole("button", { name: /のほかの操作/ })).toHaveCount(n);
    const plus = await list.getByRole("button", { name: /に担当を追加/ }).count();
    expect(plus).toBeGreaterThan(0);
    for (const brk of await rows.filter({ hasText: /\d 休憩/ }).all()) {
      await expect(brk).not.toContainText("担当未定");
      await expect(brk).not.toContainText("担当あと");
    }
    await expect(page.getByRole("button", { name: "欠勤・早退" })).toBeVisible();
    await expect(page.getByRole("button", { name: "付き添い・外出" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^元に戻す/ })).toBeVisible();
  });

  test("S3 付き添い・外出: ボタン → 田中様 → この内容で決定 の3タップ。元に戻すで消える", async ({ page }) => {
    await openAll(page);
    await page.getByRole("button", { name: "付き添い・外出" }).click();
    await page.getByRole("button", { name: "203 田中様" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("追加: 受診の付き添い 田中様 10:15–11:45");
    await expect(dialog).toContainText("担当未定");
    await dialog.getByRole("button", { name: /この内容で決定/ }).click();
    const row = page.locator("[data-all-task]").filter({ hasText: "受診の付き添い 田中様" });
    await expect(row).toContainText("10:15–11:45");
    await expect(row).toContainText("担当未定");
    await expect(row).toContainText("変わりました");
    await page.getByRole("button", { name: /^元に戻す\s*（/ }).click();
    await expect(page.locator("[data-all-task]").filter({ hasText: "受診の付き添い 田中様" })).toHaveCount(0);
  });

  test("付き添いに担当を付けると、重なる業務から外す行と、休憩をずらす行が出る", async ({ page }) => {
    await openAll(page, "10:45");
    await page.getByRole("button", { name: "付き添い・外出" }).click();
    await page.getByRole("button", { name: "203 田中様" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "ほかの人から選ぶ" }).click();
    {
      const others = dialog.getByRole("button", { name: /^ほかの人/ });
      if ((await others.getAttribute("aria-expanded")) !== "true") await others.click();
    }
    // 伊藤: 10:30–11:00 の田中様の排泄介助と重なり、11:00–12:00 は休憩（入浴日の早番B＝高橋の休憩は 14:00 から）
    await dialog.getByRole("button", { name: "伊藤さんを担当にする" }).click();
    await expect(dialog).toContainText("→ 担当 伊藤");
    await expect(dialog).toContainText("ずらす: 伊藤 の休憩");
  });

  test("付き添いの担当は「問題なし」の先頭の人を1タップで付けられる", async ({ page }) => {
    await openAll(page);
    await page.getByRole("button", { name: "付き添い・外出" }).click();
    await page.getByRole("button", { name: "203 田中様" }).click();
    const dialog = page.getByRole("dialog");
    const top = dialog.getByRole("button", { name: /さんを担当にする$/ });
    const label = (await top.textContent()) ?? "";
    await top.click();
    await expect(dialog).toContainText(`→ 担当 ${label.replace("さんを担当にする", "")}`);
  });

  test("欠勤・早退: 勤務中の人でも、来ていなければ1タップで欠勤に直せる", async ({ page }) => {
    await openAll(page, "7:10");
    await page.getByRole("button", { name: "欠勤・早退" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /高橋/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "高橋さん 早退" })).toBeVisible();
    await dialog.getByRole("button", { name: "欠勤（来ていない）" }).click();
    await expect(dialog.getByRole("heading", { name: "高橋さん 欠勤" })).toBeVisible();
    await expect(dialog).toContainText("高橋 を本日「欠勤」にする");
  });

  test("開くと、いまの時間の行へ寄る。シートを開いている間は Tab がシートの外へ出ない", async ({ page }) => {
    await openAll(page, "17:30", "木村");
    await expect(page.getByText("● いまの時間 17:30")).toBeInViewport();
    await page.locator("[data-all-task]").first().getByRole("button", { name: /のほかの操作/ }).click();
    const dialog = page.getByRole("dialog");
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
  });

  test("欠勤・早退: ボタン → 木村 → 決定 で欠勤。担当が外れる", async ({ page }) => {
    await openAll(page);
    await page.getByRole("button", { name: "欠勤・早退" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /木村/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "欠勤" })).toBeVisible();
    await expect(dialog).toContainText("木村 を本日「欠勤」にする");
    await dialog.getByRole("button", { name: /この内容で決定/ }).click();
    await expect(page.getByRole("status")).toContainText("木村さんを欠勤にしました");
    const text = await page.getByRole("list", { name: "きょうの業務（時間順）" }).innerText();
    expect(text).not.toContain("木村");
  });

  test("⋯ → 中止: 一覧に残り「中止」と出る。中止を取り消せる", async ({ page }) => {
    await openAll(page);
    const row = page.locator("[data-all-task]").filter({ hasText: "バイタル測定 田中様" });
    await row.getByRole("button", { name: /のほかの操作/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /この業務を中止/ }).click();
    await expect(row).toContainText("中止");
    await row.getByRole("button", { name: /のほかの操作/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "中止を取り消す" }).click();
    await expect(row).not.toContainText("中止");
  });

  test("＋ → 問題なしの人を追加すると、その行の担当未定が消える", async ({ page }) => {
    await openAll(page);
    const row = page.locator("[data-all-task]").filter({ hasText: "担当未定" }).first();
    const id = await row.getAttribute("data-all-task");
    await row.getByRole("button", { name: /に担当を追加/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /さんを追加$/ }).first().click();
    await expect(page.locator(`[data-all-task="${id}"]`)).not.toContainText("担当未定");
  });
});

test.describe("全体（夜勤明け）", () => {
  test("翌日の朝のリーダーには、前日の夜勤の業務が「夜勤明け」に見るだけで出る", async ({ page }) => {
    await page.goto("/me?now=7:00&date=2026-11-04");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/me?now=7:00&date=2026-11-04");
    await page.getByRole("list", { name: "きょうの出勤者" }).getByRole("button", { name: /^佐藤 / }).click();
    await page.getByRole("navigation", { name: "自分の予定と全体の切替" }).getByRole("link", { name: "全体" }).click();
    const sec = page.getByRole("region", { name: "昨夜の夜勤（11/3 から）の業務" });
    await expect(sec).toContainText("申し送り");
    await expect(sec.getByRole("button")).toHaveCount(0);
  });
});
