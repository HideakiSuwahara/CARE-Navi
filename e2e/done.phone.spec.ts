import { expect, test, type Page } from "@playwright/test";

/**
 * 決定記録 0010: 「終わった」の印（スマホ）。
 * - 自分の予定: きょうの流れの行で 1 タップ。✓ 終わった が出て、トーストの「元に戻す」で戻る
 * - 全体: 見出しの「終わっていない n件」→ 行へ。行の「終わった」で件数が減る。⋯ からも付け外しできる
 */
async function pick(page: Page, now: string, surname: string) {
  await page.goto(`/me?now=${now}`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/me?now=${now}`);
  await page.getByRole("list", { name: "きょうの出勤者" }).getByRole("button", { name: new RegExp(`^${surname} `) }).click();
}

test.describe("「終わった」の印（スマホ）", () => {
  test("自分の予定: 行の「終わった」を押すと ✓ が付き、元に戻すで消える。時刻が過ぎただけでは付かない", async ({ page }) => {
    await pick(page, "10:12", "高橋");
    const flow = page.getByRole("heading", { name: "きょうの流れ" }).locator("..");
    // サンプルは 8:00 までの枠に印あり → 「✓ 終わった」が先にある。印の無い行の「終わったら押す」を押す
    const before = await flow.getByText("✓ 終わった").count();
    const buttons = flow.getByRole("button", { name: "終わったら押す" });
    expect(await buttons.count()).toBeGreaterThan(0);
    // これからの行（始まっていない）には出さない
    const futureRow = flow.locator("li").filter({ hasText: /^1[2-5]:\d\d/ }).first();
    await expect(futureRow.getByRole("button", { name: "終わったら押す" })).toHaveCount(0);
    // 押すと名前が「終わった」に変わるので、ボタンは業務 ID で追う
    const first = page.locator(`[data-done-task="${await buttons.first().getAttribute("data-done-task")}"]`);
    await expect(first).toHaveAttribute("aria-pressed", "false");
    await first.click();
    await expect(first).toHaveAttribute("aria-pressed", "true");
    expect(await flow.getByText("✓ 終わった").count()).toBe(before + 1);
    const status = page.getByRole("status").filter({ hasText: "を終わったにしました" });
    await expect(status).toBeVisible();
    await status.getByRole("button", { name: "元に戻す" }).click();
    expect(await flow.getByText("✓ 終わった").count()).toBe(before);
    await expect(page.getByRole("status").filter({ hasText: "元に戻しました" })).toBeVisible();
    // トーストが消えたあとも、見出しの横の「元に戻す（操作名）」で戻せる（CLAUDE §5）
    await first.click();
    await expect(first).toHaveAttribute("aria-pressed", "true");
    const headerUndo = page.getByRole("button", { name: /^元に戻す（/ });
    await expect(headerUndo).toHaveAccessibleName(/を終わったにしました/);
    await headerUndo.click();
    await expect(first).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("status").filter({ hasText: "元に戻しました" })).toBeVisible();
  });

  test("業務詳細: 対象の方が物品の直後・手順より上に出る。終わったら押す → 印が付く", async ({ page }) => {
    await pick(page, "10:12", "伊藤");
    await page.getByRole("link", { name: /入浴介助/ }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: /入浴介助/ })).toBeVisible();
    const headings = await page.getByRole("heading", { level: 2 }).allInnerTexts();
    const iScope = headings.findIndex((h) => h.includes("お願いすること"));
    const iTargets = headings.findIndex((h) => h.startsWith("対象の方"));
    const iSupplies = headings.findIndex((h) => h === "物品の場所");
    const iProc = headings.findIndex((h) => h === "この施設の手順");
    expect(iScope).toBeGreaterThanOrEqual(0);
    expect(iSupplies).toBeGreaterThan(iScope);
    expect(iTargets).toBeGreaterThan(iSupplies);
    expect(iProc).toBeGreaterThan(iTargets);
    const btn = page.getByRole("button", { name: "終わったら押す" });
    await btn.click();
    await expect(page.getByRole("button", { name: "終わった", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("「終わった」の印が付いています")).toBeVisible();
  });

  test("全体: 「終わっていない n件」→ 行へ。行の「終わった」で件数が減る。⋯ から外せる", async ({ page }) => {
    await pick(page, "10:12", "佐藤");
    await page.getByRole("navigation", { name: "自分の予定と全体の切替" }).getByRole("link", { name: "全体" }).click();
    const chip = page.getByRole("button", { name: /^終わっていない \d+件/ });
    await expect(chip).toBeVisible();
    const n = Number((await chip.innerText()).match(/(\d+)件/)![1]);
    await chip.click();
    const firstUnfinished = page.locator("[data-all-task][data-unfinished]").first();
    await expect(firstUnfinished).toBeFocused();
    // 印を付けると data-unfinished が外れるので、行は ID で追う
    const row = page.locator(`[data-all-task="${await firstUnfinished.getAttribute("data-all-task")}"]`);
    await expect(row).toContainText("（時刻を過ぎました）");
    await row.getByRole("button", { name: "終わったら押す" }).click();
    await expect(row).toContainText("✓ 終わった");
    await expect(row).not.toContainText("（時刻を過ぎました）");
    // 印の付いた行は文字だけ（触って外れない）。外すのは ⋯ から
    await expect(row.getByRole("button", { name: "終わったら押す" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "終わった", exact: true })).toHaveCount(0);
    if (n > 1) await expect(chip).toContainText(`終わっていない ${n - 1}件`);
    else await expect(chip).toHaveCount(0);
    // ⋯ から外す
    await row.getByRole("button", { name: /のほかの操作/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "「✓ 終わった」を取り消す（□ に戻す）" }).click();
    await expect(row).not.toContainText("✓ 終わった");
    await expect(page.getByRole("button", { name: /^終わっていない \d+件/ })).toContainText(`終わっていない ${n}件`);
  });
});
