import { expect, test, type Page } from "@playwright/test";

/**
 * docs/acceptance.md の受け入れ条件のうち、既存の E2E で確かめていないもの（スマホ Pixel 7）。
 * 各 test の名前の先頭に acceptance.md の行番号を付ける（L44 など）。
 */

async function pick(page: Page, now: string, surname: string) {
  await page.goto(`/me?now=${now}`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/me?now=${now}`);
  await page.getByRole("list", { name: "きょうの出勤者" }).getByRole("button", { name: new RegExp(`^${surname} `) }).click();
}

const NG_STAFF = ["実施中", "完了", "済", "一括", "共通", "ノンコア", "コア", "担当未定", "担当あと", "役割枠"]; // wording-ok: 無いことを確かめる語の列挙

test.describe("受け入れ: スマホ", () => {
  test("L25 スマホ（Pixel 7）でボードを開くと、1文と「自分の予定を開く」だけが出る", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await expect(page.getByText("ボードは PC・タブレット用の画面です。")).toBeVisible();
    await expect(page.locator("[data-task-id]").first()).toBeHidden();
    await expect(page.getByRole("link", { name: "自分の予定を開く" })).toBeVisible();
  });

  test("L44 「最初の予定」は「いまの時間の予定」と同じ大きさで出る", async ({ page }) => {
    await pick(page, "10:12", "高橋");
    const now = page.getByRole("heading", { name: "いまの時間の予定" });
    await expect(now).toBeVisible();
    const sizeNow = await now.evaluate((e) => getComputedStyle(e).fontSize);
    await pick(page, "12:50", "加藤");
    const first = page.getByRole("heading", { name: "最初の予定" });
    await expect(first).toBeVisible();
    expect(await first.evaluate((e) => getComputedStyle(e).fontSize)).toBe(sizeNow);
    const next = page.getByRole("heading", { name: "つぎ" });
    expect(await next.evaluate((e) => getComputedStyle(e).fontSize)).toBe(sizeNow);
  });

  test("L45 時刻が過ぎた予定を自動で終わった扱いにしない（濃さも語もボタンも変わらない）。薄くなるのは人が付けた印だけ", async ({ page }) => {
    await pick(page, "12:10", "高橋");
    const flow = page.getByRole("heading", { name: "きょうの流れ" }).locator("..");
    const past = flow.getByRole("link").filter({ hasText: "（時刻を過ぎた予定）" });
    expect(await past.count()).toBeGreaterThan(0);
    const notPast = flow.getByRole("link").filter({ hasNotText: "（時刻を過ぎた予定）" }).last();
    const colorPast = await past.first().evaluate((e) => getComputedStyle(e).color);
    const colorNow = await notPast.evaluate((e) => getComputedStyle(e).color);
    expect(colorPast).toBe(colorNow); // 時刻が過ぎただけでは薄くしない（決定記録 0010）
    const text = await page.locator("body").innerText();
    for (const ng of ["実施中", "完了", "済"]) expect(text).not.toContain(ng); // wording-ok: 無いことの確認
    await expect(page.getByRole("button", { name: /完了|実施|済/ })).toHaveCount(0); // wording-ok: 無いことの確認
    // 人が「終わった」を付けた行だけが薄くなる（印を付けると「（時刻を過ぎた予定）」は消えるので、行は ID で追う）
    const target = flow.locator(`[data-flow-task="${await past.first().getAttribute("data-flow-task")}"]`);
    await target.locator("..").getByRole("button", { name: "終わった", exact: true }).click();
    await expect(target).toContainText("✓ 終わった");
    expect(await target.evaluate((e) => getComputedStyle(e).color)).not.toBe(colorNow);
  });

  test("L46 業務詳細にも、充足バッジ・仕組みの言葉・完了の語が出ない", async ({ page }) => {
    await pick(page, "12:10", "高橋");
    for (const name of [/昼食介助/, /休憩/]) {
      await page.getByRole("link", { name }).first().click();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const text = await page.locator("main").innerText();
      for (const ng of NG_STAFF) expect(text, `${name} の詳細に「${ng}」`).not.toContain(ng);
      await page.getByRole("link", { name: "自分の予定へ戻る" }).first().click();
    }
  });

  test("L47 相談先（佐藤リーダー）が休憩中なら、休憩の時刻と代わりの人を上部に出す", async ({ page }) => {
    await pick(page, "14:10", "高橋");
    await expect(page.getByRole("note")).toContainText(/困ったら 佐藤（リーダー）は休憩中 14:00–15:00 → (\S+ PHS \d+|代わりはあなたです)/);
  });

  test("L48 業務詳細に「お願いしないこと」も出る", async ({ page }) => {
    await pick(page, "10:12", "伊藤");
    await page.getByRole("link", { name: /入浴介助/ }).first().click();
    await expect(page.getByRole("heading", { name: "あなたにお願いすること" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "お願いしないこと" })).toBeVisible();
    await expect(page.getByRole("region", { name: "困ったら" })).toBeVisible();
  });

  test("L49 設定を「フルネーム」にすると、手元の利用者名がフルネームになる（既定は部屋番号＋姓）", async ({ page }) => {
    await pick(page, "12:10", "高橋");
    await page.getByRole("link", { name: /昼食介助/ }).first().click();
    const name = () => page.getByRole("region", { name: /対象の方/ }).getByRole("listitem").filter({ hasText: "井上" }).first();
    await expect(name()).toContainText("103 井上様");
    const url = page.url();
    // 設定は PC の画面。同じ端末（同じ保存）で、ふだんの設定を開いて変える
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/setup");
    await page.getByRole("button", { name: "サンプル施設で試す" }).click();
    await page.goto("/setup");
    await page.getByRole("button", { name: /^フルネーム/ }).click();
    await expect(page.getByRole("button", { name: /^フルネーム/ })).toHaveAttribute("aria-pressed", "true");
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto(url);
    const who = page.getByRole("list", { name: "きょうの出勤者" }).getByRole("button", { name: /^高橋 / });
    if (await who.isVisible().catch(() => false)) await who.click(); // 名前の選び直しが要るとき
    await page.goto(url);
    await expect(name()).toContainText("井上 フミ様");
  });

  test("L140 業務詳細のサポートの1行は、担当の人にだけ出る", async ({ page }) => {
    await pick(page, "12:10", "高橋");
    await page.getByRole("link", { name: /昼食介助/ }).first().click();
    const targets = page.getByRole("region", { name: /対象の方/ });
    await expect(targets.getByText(/^103 井上様: .+/)).toBeVisible();
    const url = new URL(page.url());
    // 担当でない人（木村・遅番）が同じ業務を開いても、サポートの1行は出ない
    await page.goto("/me?now=12:10");
    await page.getByRole("button", { name: "自分ではない（名前を選び直す）" }).click();
    await page.getByRole("list", { name: "きょうの出勤者" }).getByRole("button", { name: /^木村 / }).click();
    await page.goto(`/me?now=12:10&task=${url.searchParams.get("task")}`);
    await expect(page.getByRole("heading", { level: 1, name: /昼食介助/ })).toBeVisible();
    await expect(page.getByRole("region", { name: /対象の方/ }).getByText(/^103 井上様: /)).toHaveCount(0);
  });

  test("L75 自分の予定・業務詳細: 押せる領域 44px 以上、文字のコントラスト 4.5:1 以上（axe color-contrast）", async ({ page }) => {
    await pick(page, "10:12", "高橋");
    const axePath = require.resolve("axe-core/axe.min.js");
    for (const step of ["me", "detail"]) {
      if (step === "detail") await page.getByRole("link", { name: /見守り|入浴|排泄/ }).first().click();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("main a, main button")]
          .map((e) => ({ e, r: e.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.height > 0 && r.height < 44)
          .map(({ e, r }) => `${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`),
      );
      expect(small, `${step}: 44px 未満`).toEqual([]);
      await page.addScriptTag({ path: axePath });
      const bad = await page.evaluate(async () => {
        // @ts-expect-error axe はページに読み込んだもの
        const r = await window.axe.run(document, { runOnly: ["color-contrast"] });
        return r.violations.flatMap((v: { nodes: { target: string[]; any: { message: string }[] }[] }) => v.nodes.map((n) => `${n.target.join(" ")}: ${n.any[0]?.message}`));
      });
      expect(bad, `${step}: コントラスト`).toEqual([]);
    }
  });
});
