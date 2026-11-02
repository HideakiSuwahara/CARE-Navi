import { expect, test } from "@playwright/test";

/**
 * D1: サンプル施設のボードが、0入力で時間割として表示される。
 * docs/acceptance.md: 個別・一括・共通・休憩が同じ画面に出る／担当未定・担当あと n 人が文字で出る／人に数字を付けない
 */
test.describe("ボード（D1）", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
  });

  test("サンプル施設の一日が、グループの列に並ぶ", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0); // 見出しを増やさない（1画面1目的）
    for (const name of ["東フロア", "さくらユニット", "共通"]) {
      await expect(page.getByLabel("時間割").getByText(name, { exact: true })).toBeVisible();
    }
    expect(await page.locator("[data-task-id]").count()).toBeGreaterThan(30);
  });

  test("未充足の枠だけに文字のバッジが付き、休憩には付かない", async ({ page }) => {
    await expect(page.getByText(/担当未定 \d+件/)).toBeVisible();
    await expect(page.getByText(/担当あと\d人 \d+件/)).toBeVisible();
    const breaks = page.locator('[data-level="break"]');
    expect(await breaks.count()).toBeGreaterThan(0);
    await expect(breaks.getByText(/担当未定|担当あと/)).toHaveCount(0);
  });

  test("人に数字を付けない（パレットに件数・予定時間がない）", async ({ page }) => {
    const palette = page.getByRole("complementary", { name: "きょうの出勤者" });
    await expect(palette.getByText(/\d+件$/)).toHaveCount(0);
    await expect(palette.getByText(/時間\d+分|予定 \d/)).toHaveCount(0);
    await expect(palette.getByText(/この人の番の枠 \d+件が担当未定/)).toBeVisible();
  });

  test("禁止の言い回しを出さない", async ({ page }) => {
    const text = await page.locator("body").innerText();
    for (const ng of ["人手不足", "実施中", "完了", "不足"]) expect(text).not.toContain(ng); // wording-ok: 禁止語の列挙
  });

  test("すべてのカードに 44px 以上の「＋」がある", async ({ page }) => {
    const plus = page.getByRole("button", { name: /に担当を追加$/ });
    expect(await plus.count()).toBe(await page.locator("[data-task-id]").count());
    const box = await plus.first().boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("現在時刻ラインが出る", async ({ page }) => {
    await expect(page.getByLabel("時間割").getByText("10:12", { exact: true })).toBeVisible();
  });
});
