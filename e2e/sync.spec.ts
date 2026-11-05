import { expect, test } from "@playwright/test";

/**
 * 端末間の同期（決定記録 0009）。docs/acceptance.md S4（別端末）
 * 環境変数 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY がそろっているときだけ走る（CI では飛ばす）。
 * 2 つのブラウザ文脈（PC と スマホ）を別の端末に見立てる。施設コードはテストごとに新しく作る。
 */
const available = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

test.describe("同期（別端末）", () => {
  test.skip(!available, "Supabase の環境変数がないので飛ばす");

  test("PC で変えた担当が、別端末（スマホ）の自分の予定に届く。見出しに「同期中」", async ({ browser }) => {
    test.setTimeout(120_000);
    // 端末1（PC）: サンプル施設をこのコードで同期する（設定の「この施設を同期する」と同じ経路を、コード指定で）
    const pc = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pcPage = await pc.newPage();
    await pcPage.goto("/setup");
    await pcPage.evaluate(() => localStorage.clear());
    await pcPage.goto("/setup");
    await pcPage.getByRole("button", { name: "サンプル施設で試す" }).click();
    await pcPage.waitForURL(/\/board/);
    await pcPage.goto("/setup");
    // 施設コードを発行して送る（発行のたびに乱数のコード。テスト同士が混ざらない）
    await pcPage.getByRole("button", { name: /この施設を同期する/ }).click();
    await pcPage.waitForURL(/\/setup/);
    await expect(pcPage.getByText(/この施設コードで、ほかの端末と同じ内容にしています/)).toBeVisible({ timeout: 30_000 });
    const issued = (await pcPage.locator("p.tracking-\\[0\\.2em\\] span[aria-hidden]").textContent())?.trim() ?? "";
    expect(issued).toMatch(/^[A-Z0-9]{4,12}$/);
    // 端末2（スマホ）: 施設コードで参加
    const phone = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
    const phonePage = await phone.newPage();
    await phonePage.goto(`/setup?join=${issued}`);
    await phonePage.waitForURL(/\/me/);
    await expect(phonePage.getByRole("status")).toContainText("で参加しました");
    await phonePage.goto("/me?now=10:12");
    await phonePage.getByRole("list", { name: "きょうの出勤者" }).getByRole("button", { name: /^高橋 / }).click({ timeout: 30_000 });
    await expect(phonePage.getByRole("heading", { level: 1, name: /高橋 さん/ })).toBeVisible();
    const before = await phonePage.locator("main").innerText();
    expect(before).not.toContain("リネン回収");

    // 端末1: リネン回収（担当未定）に高橋さんを足す
    await pcPage.goto("/board?now=10:12");
    await expect(pcPage.getByRole("status").filter({ hasText: "同期中" }).first()).toBeVisible({ timeout: 30_000 });
    const card = pcPage.locator("[data-task-id]").filter({ hasText: "リネン回収" }).first();
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("button", { name: /に担当を追加$/ }).click();
    const panel = pcPage.getByRole("dialog");
    const others = panel.getByRole("button", { name: /^ほかの人/ });
    if ((await others.getAttribute("aria-expanded")) !== "true") await others.click();
    await panel.getByRole("button", { name: "高橋さんを追加" }).click();

    // 端末2: 読み込み直さずに届く。「ほかの端末で変更がありました」
    await expect(phonePage.locator("main")).toContainText("リネン回収", { timeout: 30_000 });

    // 端末1: 同期をやめても、いまの内容（高橋さんの担当）はこの端末に残る
    await pcPage.goto("/setup");
    await pcPage.getByRole("button", { name: "この端末だけにする（同期をやめる）" }).click();
    await pcPage.getByRole("button", { name: "やめる", exact: true }).click();
    await pcPage.waitForURL(/\/setup/);
    await expect(pcPage.getByRole("status").filter({ hasText: "やめました" })).toBeVisible({ timeout: 30_000 });
    await pcPage.goto("/board?now=10:12");
    const after = pcPage.locator("[data-task-id]").filter({ hasText: "リネン回収" }).first();
    await expect(after).toContainText("高橋");
    await expect(pcPage.getByRole("status").filter({ hasText: "同期中" })).toHaveCount(0);

    await pc.close();
    await phone.close();
  });

  test("内容のない施設コードで参加すると、案内と「この端末だけにする」が出る", async ({ browser }) => {
    const phone = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
    const page = await phone.newPage();
    await page.goto(`/setup?join=ZZ${Date.now().toString(36).toUpperCase().slice(-5)}`);
    await page.waitForURL(/\/me/);
    await expect(page.getByText("この施設コードの内容は届いていません")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "この端末だけにする（同期をやめる）" }).click();
    await page.waitForURL(/\/setup/);
    await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();
    await phone.close();
  });
});
