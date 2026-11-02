import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * 利用者（PC）: 施設の日課の一覧と、利用者ごとの24時間シート（決定記録 0004）。
 * サンプルの時刻や文章は別に直されることがあるので、田中様・小林様と「起床介助」があることだけを前提にする。
 */

async function wakeCell(page: Page, surname: string) {
  const col = await page.locator("thead th").evaluateAll((ths) => ths.findIndex((th) => th.textContent?.includes("起床介助")));
  expect(col).toBeGreaterThan(0);
  const row = page.locator("tbody tr").filter({ has: page.getByRole("rowheader", { name: new RegExp(surname) }) });
  return row.locator("td, th").nth(col).getByRole("button");
}

async function openGroupOf(page: Page, surname: string) {
  for (const g of ["東フロア", "さくらユニット"]) {
    await page.getByRole("group", { name: "グループ" }).getByRole("button", { name: g }).click();
    if ((await page.getByRole("rowheader", { name: new RegExp(surname) }).count()) > 0) return;
  }
  throw new Error(`${surname}様が見つかりません`);
}

test.describe("利用者（0004）", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/residents");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/residents");
    await expect(page.locator("tbody tr").first()).toBeVisible();
  });

  test("一覧が出る（利用者×日課）。上部のナビに利用者がある", async ({ page }) => {
    await expect(page.getByText("ここで直した時刻は、次に時間割を作るときから入ります")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "主な画面" }).getByRole("link", { name: "利用者" })).toHaveAttribute("aria-current", "page");
    await openGroupOf(page, "田中");
    await expect(page.locator("thead").getByText("起床介助")).toBeVisible();
    expect(await page.locator("tbody tr").count()).toBeGreaterThan(1);
  });

  test("マスで時刻を変えると太字の時刻になり、元に戻せる", async ({ page }) => {
    await openGroupOf(page, "田中");
    const cell = await wakeCell(page, "田中");
    const before = await cell.getAttribute("data-state");
    await cell.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("開始").fill("9:45");
    await dialog.getByRole("button", { name: "この内容で決定" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(cell.locator("strong")).toHaveText("9:45");
    await expect(cell).toHaveAttribute("data-state", "changed");
    await expect(page.getByRole("status")).toContainText("田中様の起床介助を 9:45 にしました");
    await page.getByRole("status").getByRole("button", { name: "元に戻す" }).click();
    await expect(cell).toHaveAttribute("data-state", before!);
    await expect(cell.locator("strong")).not.toHaveText("9:45");
  });

  test("まとめて変える: 選んだ方に同じ時刻を一度に入れ、1回で元に戻せる", async ({ page }) => {
    await openGroupOf(page, "田中");
    await page.getByRole("checkbox", { name: /田中/ }).check();
    await page.getByRole("checkbox", { name: /小林/ }).check();
    await expect(page.getByText("2人を選んでいます")).toBeVisible();
    await page.getByRole("button", { name: /^起床介助をまとめて変える（2人）/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("開始").fill("9:50");
    await dialog.getByRole("button", { name: "この内容で決定" }).click();
    const tanaka = await wakeCell(page, "田中");
    const kobayashi = await wakeCell(page, "小林");
    await expect(tanaka.locator("strong")).toHaveText("9:50");
    await expect(kobayashi.locator("strong")).toHaveText("9:50");
    await page.getByRole("status").getByRole("button", { name: "元に戻す" }).click();
    await expect(tanaka.locator("strong")).not.toHaveText("9:50");
    await expect(kobayashi.locator("strong")).not.toHaveText("9:50");
  });

  test("マスで「この方はなし」→「なし」と文字で出る", async ({ page }) => {
    await openGroupOf(page, "小林");
    const cell = await wakeCell(page, "小林");
    await cell.click();
    await page.getByRole("dialog").getByRole("button", { name: "この方はなし" }).click();
    await expect(cell).toHaveText("なし");
    await cell.click();
    await page.getByRole("dialog").getByRole("button", { name: "標準に戻す" }).click();
    await expect(cell).toHaveAttribute("data-state", "standard");
    await expect(cell).toHaveText("—");
  });

  test("24時間シート: 文章を書くと保存され、再読み込みしても残る", async ({ page }) => {
    await openGroupOf(page, "田中");
    await page.getByRole("button", { name: "24時間シート" }).click();
    await page.getByRole("navigation", { name: /の利用者$/ }).getByRole("button", { name: /田中/ }).click();
    const sheet = page.getByRole("region", { name: /田中.*様の24時間シート/ });
    await expect(sheet).toBeVisible();
    for (const label of ["時刻", "業務・日課", "生活リズム", "意向・好み", "自分でできること", "サポートが必要なこと"]) {
      await expect(sheet.getByRole("columnheader", { name: label, exact: true })).toBeVisible();
    }
    const box = sheet.getByRole("textbox", { name: /起床介助 の意向・好み$/ });
    const text = `テスト用の好み ${Date.now()}`;
    await box.fill(text);
    await box.blur();
    await expect(page.getByRole("status")).toContainText("意向・好みを保存しました");
    await page.reload();
    await page.getByRole("group", { name: "グループ" }).getByRole("button", { name: "さくらユニット" }).waitFor();
    await openGroupOf(page, "田中");
    await page.getByRole("button", { name: "24時間シート" }).click();
    await page.getByRole("navigation", { name: /の利用者$/ }).getByRole("button", { name: /田中/ }).click();
    await expect(page.getByRole("textbox", { name: /起床介助 の意向・好み$/ })).toHaveValue(text);
  });

  test("24時間シート: この方だけの行を足すと「この方だけ」と出る", async ({ page }) => {
    await openGroupOf(page, "小林");
    await page.getByRole("button", { name: "24時間シート" }).click();
    await page.getByRole("navigation", { name: /の利用者$/ }).getByRole("button", { name: /小林/ }).click();
    await page.getByRole("button", { name: "＋ この方だけの行を足す" }).click();
    const form = page.getByRole("form", { name: "この方だけの行を足す" });
    await form.getByLabel("時刻").fill("10:40");
    await form.getByLabel("名前").fill("新聞を読む");
    await form.getByRole("button", { name: "この内容で決定" }).click();
    const row = page.locator('tr[data-kind="extra"]').filter({ hasText: "新聞を読む" });
    await expect(row).toContainText("10:40");
    await expect(row).toContainText("この方だけ");
  });

  test("CSV: 一覧と24時間シートでダウンロードが起き、BOM つき", async ({ page }) => {
    await openGroupOf(page, "田中");
    const [grid] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV" }).click()]);
    // ファイル名（日本語）はロケールのない環境の headless Chrome では「download」になるので、中身で確かめる
    const gridText = readFileSync((await grid.path())!, "utf8");
    expect(gridText.charCodeAt(0)).toBe(0xfeff);
    expect(gridText).toContain("起床介助");

    await page.getByRole("button", { name: "24時間シート" }).click();
    await page.getByRole("navigation", { name: /の利用者$/ }).getByRole("button", { name: /田中/ }).click();
    const [sheet] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV" }).click()]);
    const sheetText = readFileSync((await sheet.path())!, "utf8");
    expect(sheetText).toContain("田中");
    expect(sheetText).toContain("サポートが必要なこと");
  });

  test("名簿を貼り付けると利用者が増え、全員が標準どおり", async ({ page }) => {
    await page.getByRole("button", { name: "名簿を貼り付ける" }).click();
    await page.getByRole("textbox", { name: "名簿", exact: true }).fill("森 ツル, 東フロア, 199\n石井 ミツ, どこか, 198");
    await expect(page.getByText("1人を足せます")).toBeVisible();
    await expect(page.getByText(/2行目: グループ「どこか」が見つかりません/)).toBeVisible();
    await page.getByRole("button", { name: "この内容で足す" }).click();
    const row = page.locator("tbody tr").filter({ has: page.getByRole("rowheader", { name: /森 ツル/ }) });
    await expect(row).toBeVisible();
    await expect(row.locator('[data-state="standard"]').first()).toBeVisible();
    expect(await row.locator('[data-state]:not([data-state="standard"])').count()).toBe(0);
  });
});
