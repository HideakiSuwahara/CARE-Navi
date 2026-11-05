import { expect, test } from "@playwright/test";

/**
 * 決定記録 0010: 「終わった」の印と「終わっていない n 件」（ボード）。
 * - 時刻が過ぎただけでは印は付かない。見出しに「終わっていない n件 →」。押すと該当の枠へ
 * - 詳細パネルの「終わったら押す」で印が付き、件数が 1 減り、カードに ✓。元に戻すで戻る
 */
test.describe("「終わった」の印（ボード）", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
  });

  test("見出しの「終わっていない n件」→ 枠へ移動 → 終わったら押す → 件数が減り、元に戻せる", async ({ page }) => {
    const chip = page.getByRole("button", { name: /^終わっていない \d+件/ });
    await expect(chip).toBeVisible();
    const n = Number((await chip.innerText()).match(/(\d+)件/)![1]);
    expect(n).toBeGreaterThan(0);
    // サンプルは 8:00 までの枠に印あり（✓ 終わった）。時刻が過ぎただけの枠には印が無い
    expect(await page.locator("[data-done]").count()).toBeGreaterThan(0);
    await expect(page.locator("[data-done]").first()).toContainText("✓ 終わった");
    expect(await page.locator("[data-unfinished]").count()).toBe(n);
    expect(await page.locator("[data-done][data-unfinished]").count()).toBe(0);

    await chip.click();
    const focused = page.locator("[data-task-id]:has(button:focus)");
    await expect(focused).toHaveAttribute("data-unfinished", "");
    const id = await focused.getAttribute("data-task-id");
    await focused.getByRole("button").first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "終わったら押す" }).click();
    await expect(dialog.getByRole("button", { name: /終わった$/ })).toHaveAttribute("aria-pressed", "true");
    const card = page.locator(`[data-task-id="${id}"]`);
    await expect(card).toHaveAttribute("data-done", "");
    await expect(card).toContainText("✓");
    await expect(chip).toContainText(`終わっていない ${n - 1}件`);
    // 元に戻す
    await page.getByRole("button", { name: "閉じる" }).click();
    await page.getByRole("button", { name: /^元に戻す/ }).first().click();
    await expect(card).not.toHaveAttribute("data-done", "");
    await expect(chip).toContainText(`終わっていない ${n}件`);
  });

  test("禁止の語を出さない（完了・済・実施中・率）", async ({ page }) => {
    const text = await page.locator("main, body").first().innerText();
    for (const ng of ["完了", "済", "未実施", "実施中", "完了率"]) expect(text).not.toContain(ng); // wording-ok: 禁止語の列挙
  });
});
