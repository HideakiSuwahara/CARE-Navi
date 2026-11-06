import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * 提出前の通し確認（2026-11-06）。docs/acceptance.md の条件のうち、既存の E2E で直接は確かめていないもの。
 * 各 test の名前の先頭に acceptance.md の行番号（L22 など。2026-11-06 時点の行）を付ける。
 */
const axePath = require.resolve("axe-core/axe.min.js");

async function openBoard(page: Page, query = "now=10:12") {
  await page.goto(`/board?${query}`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/board?${query}`);
  await expect(page.locator("[data-task-id]").first()).toBeVisible();
}

async function pickMe(page: Page, now: string, surname: string) {
  await page.goto(`/me?now=${now}`);
  await page.getByRole("list", { name: "きょうの出勤者" }).getByRole("button", { name: new RegExp(`^${surname} `) }).click();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`${surname} さん`) })).toBeVisible();
}

/** 自分の施設を最小の入力で作り、今日の時間割を作る */
async function createOwnFacility(page: Page) {
  await page.goto("/setup");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/setup");
  await page.getByRole("button", { name: "自分の施設で始める" }).click();
  await page.getByLabel("施設の名前").fill("みどり荘");
  await page.getByLabel(/^グループ（必須/).fill("2階");
  await page.getByRole("textbox", { name: "2. 利用者を貼り付け" }).fill("菅野 ハル, 2階, 201\n熊谷 トメ, 2階, 202");
  await page.getByRole("textbox", { name: "3. 職員を貼り付け" }).fill("野村 ミホ, 介護福祉士, 入浴担当可, 811\n川口 ジュン, 介護職員");
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page).toHaveURL(/\/board/);
}

/**
 * WCAG の規則（2.0/2.1/2.2 の A・AA）で axe を回し、違反を「規則(件数): 要素」で返す。
 * best-practice（region など）は含めない（2026-11-06 の通し確認では、ボードの飛び先・利用者の見出しに region が出ている。備考に記録）。
 */
async function axeAll(page: Page) {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => {
    // @ts-expect-error axe はページに読み込んだもの
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
    return (r.violations as { id: string; nodes: { target: string[] }[] }[]).map((v) => `${v.id}(${v.nodes.length}): ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" / ")}`);
  });
}

test.describe("通し確認: ボード", () => {
  test("L20 見出しに実際の文言ごとの件数（担当未定 n件・担当あと1人 n件）", async ({ page }) => {
    await openBoard(page);
    const unassigned = await page.locator('[data-task-id][data-badge="担当未定"]').count();
    await expect(page.getByRole("button", { name: new RegExp(`^担当未定 ${unassigned}件`) })).toBeVisible();
    await expect(page.getByRole("button", { name: /^担当あと1人 \d+件/ })).toBeVisible();
  });

  test("L22 自分の施設のボードは「更新 h:mm」（時刻のみ）。サンプルは「サンプル施設の一日」（決定記録 0018）", async ({ page }) => {
    await openBoard(page, "now=10:12");
    await expect(page.getByText("サンプル施設の一日")).toBeVisible();
    await createOwnFacility(page);
    const list = page.getByRole("list", { name: "今日の出勤者" });
    await list.getByRole("button", { name: "出勤にする" }).first().click();
    await list.getByRole("combobox").first().selectOption({ label: "早番A" });
    await page.getByRole("button", { name: "この内容で作る" }).click();
    const stamp = page.getByText(/^更新 \d{1,2}:\d{2}$/);
    await expect(stamp).toBeVisible();
    // 時刻だけ（名前を添えない）
    expect((await stamp.innerText()).trim()).toMatch(/^更新 \d{1,2}:\d{2}$/);
  });

  // 2026-11-06 の通しで、/setup の番の行のボタンの名前が見えている文字を含まず label-content-name-mismatch（WCAG 2.5.3）だった。
  // 名前を見えている文字（＋読み上げだけの「を直す」）に直した。
  test("L23 暗い画面: ボード（3 つの並べ方）・利用者・見直し・設定・使い方・最初の画面で axe の違反 0", async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: "dark" });
    await openBoard(page);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(15, 27, 45)");
    const found: Record<string, string[]> = {};
    found["board(グループ)"] = await axeAll(page);
    await page.getByRole("button", { name: "職員ごと", exact: true }).click();
    found["board(職員)"] = await axeAll(page);
    await page.getByRole("button", { name: "利用者ごと", exact: true }).click();
    found["board(利用者)"] = await axeAll(page);
    await page.getByRole("button", { name: "グループごと", exact: true }).click();
    for (const path of ["/residents", "/review", "/setup", "/help", "/"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      found[path] = await axeAll(page);
    }
    const bad = Object.entries(found).filter(([, v]) => v.length > 0);
    expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
  });

  test("L24 ［利用者ごと］: 見守り・共通・休憩は出ず、何人かが対象の枠（n人の枠）の写しは灰色にしない", async ({ page }) => {
    await openBoard(page);
    // 東フロアの朝食介助 8:00（20人の一括）に「終わった」の印を付けておく
    const breakfast = page.locator('[data-task-id][data-group="grp-east"]').filter({ hasText: "朝食介助" }).filter({ hasText: "8:00–9:00" }).first();
    const bid = (await breakfast.getAttribute("data-task-id"))!;
    await breakfast.getByRole("button").first().click();
    await page.getByRole("dialog").getByRole("button", { name: "終わったら押す" }).click();
    await page.getByRole("button", { name: "閉じる" }).click();
    await expect(page.locator(`[data-task-id="${bid}"]`)).toHaveAttribute("data-done", "");
    await page.getByLabel("見るグループ").selectOption({ label: "東フロア" });
    await page.getByRole("button", { name: "利用者ごと", exact: true }).click();
    const scroller = page.getByTestId("board-scroller");
    await expect(scroller.getByRole("heading", { level: 2 }).first()).toContainText("様");
    const names = await scroller.locator("[data-task-id], [data-shared]").allInnerTexts();
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      expect(n).not.toMatch(/^見守り/);
      expect(n).not.toMatch(/^休憩/);
      for (const common of ["申し送り", "リネン回収", "物品補充", "レク準備"]) expect(n).not.toContain(common);
    }
    // 印のある一括の枠の写し（n人の枠）は、地を灰色にしない
    const shared = page.locator("[data-shared]").filter({ hasText: "朝食介助" }).filter({ hasText: "人の枠" }).first();
    await expect(shared).toBeAttached();
    expect(await shared.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
  });

  test("L26 休みの人には「その人の番の枠 n 件」だけ。出勤者に件数・予定時間がない", async ({ page }) => {
    await openBoard(page);
    const off = page.getByRole("region", { name: "休み" });
    await expect(off).toContainText(/の枠: 担当未定 \d+/);
    const palette = await page.getByRole("region", { name: "休み" }).locator("xpath=ancestor::aside[1]").innerText();
    expect(palette).not.toMatch(/\d+時間|\d+分|\d+件の担当/);
  });

  test("L43 サンプルは 11/3 で開き、「次の日」「前の日」「今日へ」で日を移れる。自分の施設は端末の今日", async ({ page }) => {
    await page.goto("/board");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board");
    await expect(page.getByText("11月3日（火）").first()).toBeVisible();
    await page.getByRole("link", { name: /^次の日/ }).click();
    await expect(page.getByText("11月4日（水）").first()).toBeVisible();
    await page.getByRole("link", { name: "今日へ" }).click();
    await expect(page.getByText("11月3日（火）").first()).toBeVisible();
    await page.getByRole("link", { name: /^前の日/ }).click();
    await expect(page.getByText("11月2日（月）").first()).toBeVisible();
    // 自分の施設: 端末の今日（6:00 より前は前の日）
    await createOwnFacility(page);
    const expected = await page.evaluate(() => {
      const d = new Date();
      if (d.getHours() < 6) d.setDate(d.getDate() - 1);
      return `${d.getMonth() + 1}月${d.getDate()}日`;
    });
    await expect(page.getByText(new RegExp(`^${expected}（`)).first()).toBeVisible();
  });

  test("L46 作ったあとの「＋ 今日来る人を足す」: 名前と番で足りない枠に入り、1回で元に戻る", async ({ page }) => {
    await openBoard(page);
    // 10:12 より前に終わったリネン回収 9:30 には入れない（ループ1）ので、これからの物品補充 12:00 で見る
    const card = page.locator("[data-task-id]").filter({ hasText: "物品補充" }).filter({ hasText: "12:00" }).first();
    await expect(card).toHaveAttribute("data-badge", "担当未定");
    const add = page.getByRole("region", { name: "今日来る人を足す" });
    await add.getByRole("button", { name: "＋ 今日来る人を足す" }).click();
    await add.getByRole("combobox", { name: "今日来る人" }).selectOption({ label: "渡辺（介護助手）" });
    const slot = add.getByRole("combobox", { name: "番" });
    const label = (await slot.locator("option").allTextContents()).find((t) => t.startsWith("介護助手"))!;
    await slot.selectOption({ label });
    await add.getByRole("button", { name: "この内容で決定" }).click();
    await expect(card).not.toHaveAttribute("data-badge", "担当未定");
    await expect(card).toContainText("渡辺");
    await page.getByRole("button", { name: /^元に戻す/ }).first().click();
    await expect(card).toHaveAttribute("data-badge", "担当未定");
    await expect(card).not.toContainText("渡辺");
  });

  test("L47 ツールバーの「欠勤・早退」: 決定のあと、トーストに件数と「＋ から埋められます」。元に戻せる", async ({ page }) => {
    await openBoard(page);
    await page.getByRole("button", { name: "欠勤・早退" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /鈴木/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "鈴木さん 早退" })).toBeVisible();
    await expect(dialog).toContainText("10:15");
    await dialog.getByRole("button", { name: /この内容で決定/ }).click();
    const toast = page.locator("#board-toast");
    await expect(toast).toContainText(/鈴木さんを 10:15 で早退にしました。いま 担当未定 \d+件.*（＋ から埋められます）/);
    await toast.getByRole("button", { name: "元に戻す" }).click();
    await expect(toast).toContainText("元に戻しました");
  });

  test("L47 ツールバーの「付き添い・外出」が開ける", async ({ page }) => {
    await openBoard(page);
    await page.getByRole("button", { name: "付き添い・外出" }).click();
    await expect(page.getByRole("dialog")).toContainText("田中様");
  });

  test("L48 ほかの画面から戻ってボードを開いても、前の操作のトーストは出ない。元に戻すはツールバーに残る", async ({ page }) => {
    await openBoard(page);
    await page.getByRole("button", { name: /に担当を追加$/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: /さんを追加$/ }).first().click();
    await expect(page.locator("#board-toast")).toContainText(/担当にしました|入れました/);
    await page.getByRole("link", { name: "業務の見直し" }).click();
    await expect(page).toHaveURL(/\/review/);
    await page.getByRole("link", { name: "ボード" }).first().click();
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    await expect(page.locator("#board-toast")).not.toContainText(/担当にしました|入れました/);
    await expect(page.getByRole("button", { name: /^元に戻す/ }).first()).toBeEnabled();
  });

  test("L65 サンプル 11/3 10:12 のボードは「終わっていない 2件」", async ({ page }) => {
    await openBoard(page);
    await expect(page.getByRole("button", { name: /^終わっていない 2件/ })).toBeVisible();
  });
});

test.describe("通し確認: 保存（必ず入る確認）", () => {
  test("再読み込みで状態が残り、⋯ →「サンプルに戻す」で初期化される", async ({ page }) => {
    await openBoard(page);
    const card = page.locator('[data-task-id][data-badge="担当未定"]').first();
    const id = (await card.getAttribute("data-task-id"))!;
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("button", { name: /に担当を追加$/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /さんを追加$/ }).first().click();
    const target = page.locator(`[data-task-id="${id}"]`);
    await expect(target).not.toHaveAttribute("data-badge", "担当未定");
    await page.reload();
    await expect(target).not.toHaveAttribute("data-badge", "担当未定");
    await page.getByRole("button", { name: "ほかの操作" }).click();
    await page.locator("#board-menu button", { hasText: "サンプルに戻す" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm).toContainText("サンプルに戻しますか");
    await confirm.getByRole("button", { name: "サンプルに戻す" }).click();
    await expect(page.locator(`[data-task-id="${id}"]`)).toHaveAttribute("data-badge", "担当未定");
    await page.reload();
    await expect(page.locator(`[data-task-id="${id}"]`)).toHaveAttribute("data-badge", "担当未定");
  });
});

test.describe("通し確認: 全体（スマホ幅）", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("L64 各行の「⋯」に 終わった・中止・ずらす・担当を外す", async ({ page }) => {
    await page.goto("/me?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await pickMe(page, "10:12", "佐藤");
    await page.getByRole("navigation", { name: "自分の予定と全体の切替" }).getByRole("link", { name: "全体" }).click();
    // 始まっていて担当のいる行（入浴介助 10:30 は担当あり・時刻前なので、始まった おむつ交換 10:00 を使う）
    const row = page.locator("[data-all-task]").filter({ hasText: "おむつ交換" }).filter({ hasText: "10:00" }).first();
    await row.getByRole("button", { name: /のほかの操作/ }).click();
    const dialog = page.getByRole("dialog");
    const text = await dialog.innerText();
    expect(text).toMatch(/終わった/);
    expect(text).toContain("中止");
    expect(text).toContain("ずらす");
    expect(text).toMatch(/担当を外す|外す/);
  });

  test("L65 全体の見出しも「終わっていない 2件」（11/3 10:12）", async ({ page }) => {
    await page.goto("/me?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await pickMe(page, "10:12", "佐藤");
    await page.getByRole("navigation", { name: "自分の予定と全体の切替" }).getByRole("link", { name: "全体" }).click();
    await expect(page.getByRole("button", { name: /^終わっていない 2件/ })).toBeVisible();
  });

  test("L23 暗い画面: 自分の予定・業務詳細・全体で axe の違反 0", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/me?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/me?now=10:12");
    const found: Record<string, string[]> = {};
    found["me(名前一覧)"] = await axeAll(page);
    await pickMe(page, "10:12", "佐藤");
    found["me"] = await axeAll(page);
    await page.getByRole("link", { name: /おむつ交換|入浴介助|昼食介助/ }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    found["me/detail"] = await axeAll(page);
    await page.goto("/me?now=10:12");
    await page.getByRole("navigation", { name: "自分の予定と全体の切替" }).getByRole("link", { name: "全体" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "全体" })).toBeVisible();
    found["me/all"] = await axeAll(page);
    const bad = Object.entries(found).filter(([, v]) => v.length > 0);
    expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
  });
});

test.describe("通し確認: 利用者・使い方・データの備え", () => {
  test("L160 日課を足すとき「今日の時間割にも入れる」で、今日の時間割にグループ全員の一括の枠ができる。1回で元に戻る", async ({ page }) => {
    await openBoard(page);
    const before = await page.locator("[data-task-id]").filter({ hasText: "体位変換" }).count();
    await page.goto("/residents");
    await page.getByRole("button", { name: "＋ 日課を足す" }).first().click();
    const panel = page.getByRole("dialog", { name: /に日課を足す$/ });
    await panel.getByRole("combobox").first().selectOption({ label: "体位変換" });
    await panel.getByLabel("開始").fill("13:30");
    await panel.getByLabel("終わり").fill("14:00");
    await panel.getByLabel(/の時間割にも入れる$/).check();
    await panel.getByRole("button", { name: /^(足す|この内容で決定|決定)/ }).click();
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    const cards = page.locator("[data-task-id]").filter({ hasText: "体位変換" }).filter({ hasText: "13:30" });
    await expect(cards).toHaveCount(1);
    // 一括の枠: 詳細の対象の方にグループの方が並ぶ（人数だけではない）
    await cards.first().getByRole("button").first().click();
    const detail = page.getByRole("dialog");
    await expect(detail).toBeVisible();
    expect((await detail.innerText()).match(/様/g)?.length ?? 0).toBeGreaterThan(5);
    await page.keyboard.press("Escape");
    expect(await page.locator("[data-task-id]").filter({ hasText: "体位変換" }).count()).toBe(before + 1);
    await page.getByRole("button", { name: /^元に戻す/ }).first().click();
    await expect(page.locator("[data-task-id]").filter({ hasText: "体位変換" }).filter({ hasText: "13:30" })).toHaveCount(0);
  });

  test("L175 使い方: 毎朝・途中で変わったら・直したいとき・間違えたら・データの備え。各行のリンクでその画面が開く", async ({ page }) => {
    await openBoard(page);
    await page.getByRole("link", { name: "使い方" }).first().click();
    await expect(page).toHaveURL(/\/help/);
    const main = page.locator("main");
    for (const h of ["毎朝", "途中で変わったら", "直したいとき", "間違えたら", "データの備え"]) {
      await expect(main.getByRole("heading", { name: new RegExp(`^${h}`) })).toBeVisible();
    }
    const hrefs = await main.getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(new Set(hrefs)).toEqual(new Set(["/board", "/residents", "/setup"]));
    await main.getByRole("link", { name: "利用者を開く" }).first().click();
    await expect(page).toHaveURL(/\/residents/);
  });

  test("L176 データの備え: 書き出すとファイルが落ち、読み込みは置き換えを確かめてから", async ({ page }) => {
    await openBoard(page);
    // 変更を 1 つ入れてから書き出す
    const card = page.locator('[data-task-id][data-badge="担当未定"]').first();
    const id = (await card.getAttribute("data-task-id"))!;
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("button", { name: /に担当を追加$/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /さんを追加$/ }).first().click();
    await expect(page.locator(`[data-task-id="${id}"]`)).not.toHaveAttribute("data-badge", "担当未定");
    await page.goto("/setup");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "この施設を書き出す（ファイル）" }).click()]);
    const file = await dl.path();
    // ファイル名（日本語）は headless では「download」になる（residents.spec と同じ）ので、中身で確かめる
    const body = JSON.parse(readFileSync(file!, "utf8"));
    expect(body.app).toBe("care-navi");
    expect(body.events.length).toBeGreaterThan(0);
    // サンプルに戻してから読み込むと、書き出した内容に戻る
    await page.goto("/board?now=10:12");
    await page.getByRole("button", { name: "ほかの操作" }).click();
    await page.locator("#board-menu button", { hasText: "サンプルに戻す" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "サンプルに戻す" }).click();
    await expect(page.locator(`[data-task-id="${id}"]`)).toHaveAttribute("data-badge", "担当未定");
    await page.goto("/setup");
    await page.locator('input[type="file"]').setInputFiles(file!);
    const ask = page.getByRole("alert").filter({ hasText: "置き換わります。よろしいですか" });
    await expect(ask).toBeVisible();
    await ask.getByRole("button", { name: "置き換えて読み込む" }).click();
    await page.goto("/board?now=10:12");
    await expect(page.locator(`[data-task-id="${id}"]`)).not.toHaveAttribute("data-badge", "担当未定");
  });
});

test.describe("通し確認: データの備え（同期中）", () => {
  // sync.spec.ts と同じく、Supabase の環境変数がそろっているときだけ走る
  test.skip(!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY), "Supabase の環境変数がないので飛ばす");

  test("L176 施設コードで同期しているあいだは読み込めない（書き出しはできる）", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/setup");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/setup");
    await page.getByRole("button", { name: "サンプル施設で試す" }).click();
    await page.waitForURL(/\/board/);
    await page.goto("/setup");
    await page.getByRole("button", { name: /この施設を同期する/ }).click();
    await expect(page.getByText(/この施設コードで、ほかの端末と同じ内容にしています/)).toBeVisible({ timeout: 30_000 });
    const backup = page.getByRole("region", { name: "データの備え（書き出し・読み込み）" });
    await expect(backup).toContainText("施設コードで同期しているあいだは読み込めません");
    await expect(backup.locator('input[type="file"]')).toHaveCount(0);
    await expect(backup.getByRole("button", { name: "この施設を書き出す（ファイル）" })).toBeVisible();
  });
});
