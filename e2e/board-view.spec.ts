import { expect, test } from "@playwright/test";

/**
 * 決定記録 0017: 終わった枠は灰色の地。見るグループで絞る。横軸［利用者］。端末で覚える。
 */
test.describe("ボードの見え方（見るグループ・利用者・終わった枠）", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
  });

  test("終わった印のある枠は灰色の地で「✓ 終わった」。印の無い枠は白のまま", async ({ page }) => {
    const done = page.locator("[data-done]").first();
    await expect(done).toContainText("✓ 終わった");
    const bg = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg("[data-done]")).not.toBe("rgb(255, 255, 255)");
    // 時刻が過ぎただけの枠（印なし）は白
    expect(await bg("[data-unfinished]:not([data-level=unassigned]):not([data-level=short])")).toBe("rgb(255, 255, 255)");
  });

  test("見るグループでさくらユニットを選ぶと、さくらユニットと共通の列だけ。読み込み直しても同じ", async ({ page }) => {
    const heads = page.getByTestId("board-scroller").getByRole("heading", { level: 2 });
    const before = await heads.count();
    await page.getByLabel("見るグループ").selectOption({ label: "さくらユニット" });
    await expect(heads).toHaveCount(2);
    await expect(heads.first()).toContainText("さくらユニット");
    await page.reload();
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    await expect(page.getByLabel("見るグループ")).toHaveValue(/.+/);
    await expect(heads).toHaveCount(2);
    await page.getByLabel("見るグループ").selectOption({ label: "すべて" });
    await expect(heads).toHaveCount(before);
  });

  test("横軸［利用者］: そのグループの方が列に並び、列の「＋」から付けると同じ枠に付く", async ({ page }) => {
    await page.getByLabel("見るグループ").selectOption({ label: "さくらユニット" });
    await page.getByRole("button", { name: "利用者ごと", exact: true }).click();
    const heads = page.getByTestId("board-scroller").getByRole("heading", { level: 2 });
    expect(await heads.count()).toBeGreaterThan(3);
    await expect(heads.first()).toContainText("様");
    await expect(page.getByText("対象の方が決まっていない枠（見守り・共通・休憩など）は［グループごと］で見ます")).toBeVisible();
    // 見守り・休憩は出ない
    await expect(page.locator('[data-level="break"]')).toHaveCount(0);
    // 何人かが対象の枠は写し（n人の枠）。押すと同じ詳細が開き、そこから担当を足せる
    const shared = page.locator("[data-shared]").first();
    await expect(shared).toContainText("人の枠");
    await shared.getByRole("button").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: "＋ 担当を追加" })).toBeVisible();
    // 読み込み直しても［利用者］のまま
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByRole("button", { name: "利用者ごと", exact: true })).toHaveAttribute("aria-pressed", "true");
  });
});
