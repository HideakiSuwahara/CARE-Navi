import { expect, test } from "@playwright/test";

/**
 * 業務の見直し（PC、今週）。docs/acceptance.md「業務の見直し・印刷」
 */
test.describe("業務の見直し", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/review");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/review");
    await expect(page.getByRole("heading", { name: "業務の見直し" })).toBeVisible();
  });

  test("前提「予定時間ベース」「職員の評価には使いません」が常に出る。期間は今週", async ({ page }) => {
    const note = page.getByRole("note");
    await expect(note).toContainText("予定時間ベース");
    await expect(note).toContainText("職員の評価には使いません");
    await expect(page.getByText("今週 11/2（月）〜11/8（日）")).toBeVisible();
  });

  test("区分×時間帯の図と同じ数値の表、介護助手の勤務帯、ノンコアの枠の一覧（番別。人の名前なし）", async ({ page }) => {
    await expect(page.getByRole("img", { name: /区分 × 時間帯/ })).toBeVisible();
    const table = page.getByRole("table", { name: /区分 × 時間帯の予定時間/ });
    await expect(table.getByRole("rowheader", { name: "9:00–10:00" })).toBeVisible();
    await expect(table.getByRole("rowheader", { name: "今週の合計" })).toBeVisible();
    await expect(page.getByRole("list", { name: "凡例" })).toContainText("介護助手の勤務帯 9:00–13:00");
    const nc = page.getByRole("table", { name: /ノンコア業務の枠の一覧/ });
    await expect(nc.getByRole("row", { name: /リネン回収/ })).toContainText("中");
    const text = await page.locator("main").innerText();
    for (const name of ["佐藤", "高橋", "鈴木", "渡辺"]) expect(text).not.toContain(name);
    for (const ng of ["任せられる", "要らない", "見直す ▾", "人手不足"]) expect(text).not.toContain(ng); // wording-ok: 禁止語の列挙
  });
});
