import { expect, test, type Page } from "@playwright/test";

/**
 * D3: 自分の予定・業務詳細（スマホ）。docs/acceptance.md「自分の予定・業務詳細」、S4・S5・S6
 */
async function pick(page: Page, now: string, surname: string) {
  await page.goto(`/me?now=${now}`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/me?now=${now}`);
  await page.getByRole("list", { name: "きょうの出勤者" }).getByRole("button", { name: new RegExp(`^${surname} `) }).click();
}

test.describe("自分の予定（スマホ）", () => {
  test("名前を選ぶと、その端末が覚える。切替で選び直せる", async ({ page }) => {
    await pick(page, "10:12", "高橋");
    await expect(page.getByRole("heading", { level: 1, name: /高橋 さん/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: /高橋 さん/ })).toBeVisible();
    await page.getByRole("button", { name: "名前を切り替える" }).click();
    await expect(page.getByText("あなたの名前を選んでください")).toBeVisible();
  });

  test("いまの時間の予定・きょうの流れ・退勤。困ったらが上に出る。禁止の語・仕組みの言葉・バッジがない", async ({ page }) => {
    await pick(page, "10:12", "高橋");
    await expect(page.getByRole("heading", { name: "いまの時間の予定" })).toBeVisible();
    await expect(page.getByRole("note", { name: "困ったら" })).toContainText("佐藤（リーダー） PHS 801");
    await expect(page.getByText("● いまの時間 10:12")).toBeVisible();
    await expect(page.getByText("退勤")).toBeVisible();
    const text = await page.locator("main").innerText();
    for (const ng of ["実施中", "完了", "済", "一括", "共通", "ノンコア", "コア", "担当未定", "担当あと", "役割枠"]) expect(text).not.toContain(ng); // wording-ok: 禁止語の列挙
  });

  test("初回の方（加藤 12:50）: 最初の予定に到着・案内、お願いすることと物品が開いて出る", async ({ page }) => {
    await pick(page, "12:50", "加藤");
    await expect(page.getByRole("heading", { name: "最初の予定" })).toBeVisible();
    const first = page.getByRole("link", { name: /到着・案内/ }).first();
    await expect(first).toContainText("お願いすること");
    await expect(page.getByRole("heading", { name: "つぎ" })).toBeVisible();
  });

  test("業務詳細: お願いすること・物品・手順・対象の方（部屋番号＋姓）・困ったら。記録のボタンはない", async ({ page }) => {
    await pick(page, "10:12", "伊藤");
    await page.getByRole("link", { name: /入浴介助/ }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: /入浴介助/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "あなたにお願いすること" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "物品の場所" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "この施設の手順" })).toBeVisible();
    const targets = page.getByRole("region", { name: /対象の方/ });
    await expect(targets.getByRole("listitem").first()).toHaveText(/^\d+ \S+様/);
    await expect(page.getByRole("region", { name: "困ったら" })).toContainText("きょうのリーダー");
    await expect(page.getByRole("button", { name: /記録|実施|完了/ })).toHaveCount(0); // wording-ok: 無いことの確認
    await page.getByRole("link", { name: "‹ 自分の予定へ戻る" }).click();
    await expect(page.getByRole("heading", { name: "いまの時間の予定" })).toBeVisible();
  });

  test("ボード（別タブ）で変えた担当が、自分の予定に反映される（S4）", async ({ page, context }) => {
    await pick(page, "10:12", "加藤");
    const before = await page.getByRole("heading", { name: "きょうの流れ" }).locator("..").innerText();
    expect(before).not.toContain("面会対応");
    // 別タブで、加藤さんを面会対応（担当未定・勤務時間の中）に付ける
    const board = await context.newPage();
    await board.setViewportSize({ width: 1440, height: 900 });
    await board.goto("/board?now=10:12");
    const card = board.locator("[data-task-id]").filter({ hasText: "面会対応" }).first();
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("button", { name: /に担当を追加$/ }).click();
    const panel = board.getByRole("dialog");
    await panel.getByRole("button", { name: /^ほかの人/ }).click(); // 初回の方は「注意」に畳まれている
    await panel.getByRole("button", { name: "加藤さんを追加" }).click();
    await expect(page.getByRole("heading", { name: "きょうの流れ" }).locator("..")).toContainText("面会対応", { timeout: 2000 });
  });

  test("印刷: A4 縦で、操作のボタンが隠れる", async ({ page }) => {
    await pick(page, "10:12", "高橋");
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("button", { name: "ほかの操作" })).toBeHidden();
    await expect(page.getByRole("heading", { name: "きょうの流れ" })).toBeVisible();
    await page.screenshot({ path: "test-results/me-print.png", fullPage: true });
  });
});
