import { expect, test } from "@playwright/test";

/**
 * 決定記録 0018: 素人の審査員の最初の 10 分。
 * - サンプル施設は ?now が無くても 10:12 から時計が進む。「更新」の代わりに「サンプル施設の一日」
 * - 最初の画面に 3 つの場面と「しないこと」
 * - スマホの名前一覧に「試すなら」とリーダーの札（サンプルのときだけ）
 */
test.describe("審査員の最初の 10 分（サンプル施設）", () => {
  test("?now なしでも 10:12 から時計が進み、見せ場が画面に入る", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-11-09T22:40:00+09:00") });
    await page.goto("/board");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    await expect(page.getByTestId("board-scroller").getByText("10:12", { exact: true })).toBeVisible();
    await expect(page.getByText("サンプル施設の一日")).toBeVisible();
    // 負荷が高いときは寄せるのが遅れるので待つ（全件を並列で回したときに 1 回落ちた）
    await expect(page.locator('[data-badge="担当あと1人"]').first()).toBeInViewport({ timeout: 15_000 });
    await page.clock.fastForward("03:00");
    await expect(page.getByTestId("board-scroller").getByText("10:15", { exact: true })).toBeVisible();
  });

  test("最初の画面に 3 つの場面と「しないこと」。場面のリンクから開ける", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/");
    const scenes = page.getByRole("region", { name: /試せること/ });
    await expect(scenes.getByRole("listitem")).toHaveCount(3);
    await expect(page.getByRole("region", { name: "しないこと" })).toContainText("製品の中で AI は使いません");
    await scenes.getByRole("link", { name: /朝の準備を見る/ }).click();
    await expect(page.getByRole("heading", { name: "今日の時間割を作る" })).toBeVisible();
  });
});

test.describe("審査員の最初の 10 分（スマホ）", () => {
  test.use({ viewport: { width: 412, height: 915 } });
  test("名前一覧に「試すなら」とリーダーの札", async ({ page }) => {
    await page.goto("/me?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/me?now=10:12");
    await expect(page.getByText(/サンプル施設で試すなら: .*初日の人の画面.*リーダー/)).toBeVisible();
    const sato = page.getByRole("list", { name: "きょうの出勤者" }).getByRole("button", { name: /^佐藤 / });
    await expect(sato).toContainText("リーダー");
  });
});

test.describe("審査員の最初の 10 分（サンプルデータ）", () => {
  test("入浴介助「担当あと1人」の「＋」で空いている人が出て、追加するとバッジが消える", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    const bath = page.locator('[data-badge="担当あと1人"]').filter({ hasText: "入浴介助" }).first();
    const id = await bath.getAttribute("data-task-id");
    await bath.getByRole("button", { name: /に担当を追加$/ }).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByText(/空いている人 [1-9]/)).toBeVisible();
    await panel.getByRole("button", { name: "追加" }).first().click();
    await expect(page.locator(`[data-task-id="${id}"]`)).not.toHaveAttribute("data-badge", /.+/);
  });

  test("次の日（11/5）に「この内容で作る」を押しても、夜勤の枠は担当未定にならない", async ({ page }) => {
    await page.goto("/board?date=2026-11-05&now=7:00");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?date=2026-11-05&now=7:00");
    await page.getByRole("button", { name: "この内容で作る" }).click();
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    const nightUnassigned = page.locator('[data-task-id][data-badge="担当未定"]').filter({ hasText: /夜勤|巡視/ });
    await expect(nightUnassigned).toHaveCount(0);
  });
});

test.describe("ループ 16 の持ち越し", () => {
  test("［利用者ごと］に切り替えた直後も、現在時刻の 1 時間前に寄っている", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    await page.getByRole("button", { name: "利用者ごと", exact: true }).click();
    await expect(page.getByTestId("board-scroller").getByText("10:12", { exact: true })).toBeInViewport();
  });

  test("ⓘ の説明はツールバーの下に出て、札は折れない", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    const chip = page.getByRole("button", { name: /^担当未定 \d+件/ });
    const h = (await chip.boundingBox())!.height;
    await page.getByRole("button", { name: "この数字について" }).click();
    await expect(page.locator("#board-note")).toBeVisible();
    expect((await chip.boundingBox())!.height).toBe(h);
  });
});

test.describe("ループ 14・15 の持ち越し", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
  });

  test("見るグループを選ぶと、件数をグループと共通に分けて書き、押すとそのグループの枠から移る", async ({ page }) => {
    await page.getByLabel("見るグループ").selectOption({ label: "東フロア" });
    const chip = page.getByRole("button", { name: /^担当未定 \d+件/ });
    await expect(chip).toContainText(/（東フロア \d+・共通 \d+）/);
    await chip.click();
    const focused = page.locator("[data-task-id]:has(button:focus)");
    await expect(focused).toHaveAttribute("data-group", "grp-east");
  });

  test("利用者ごとの列の中は ↓ で次の枠へ移る", async ({ page }) => {
    await page.getByRole("button", { name: "利用者ごと", exact: true }).click();
    const col = page.getByRole("group", { name: /様$/ }).first();
    const titles = col.locator("[data-card-title]");
    expect(await titles.count()).toBeGreaterThan(1);
    await titles.first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(titles.nth(1)).toBeFocused();
  });

  test("職員ごとの帯で、終わった枠は「✓ 終わった」と文字で出る", async ({ page }) => {
    await page.getByRole("button", { name: "職員ごと", exact: true }).click();
    await expect(page.getByTestId("staff-view").getByText("✓ 終わった").first()).toBeVisible();
  });
});

test.describe("見た目（決定記録 0019）", () => {
  test("最初の画面にボードとスマホの画面写真とロゴ", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("img", { name: /^ボード:/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /^スマホの自分の予定/ })).toBeVisible();
  });

  test("現在時刻の線はカードの後ろ、列の見出しにグループの帯、細いカードは始まりの時刻だけ", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    const z = await page.evaluate(() => {
      const line = [...document.querySelectorAll<HTMLElement>("[data-testid=board-scroller] div")].find((d) => d.className.includes("border-[var(--cn-now)]"))!.parentElement!;
      const card = document.querySelector<HTMLElement>("[data-task-id]")!.parentElement!;
      return { line: Number(getComputedStyle(line).zIndex), card: Number(getComputedStyle(card).zIndex) };
    });
    expect(z.line).toBeLessThan(z.card);
    const head = page.getByTestId("board-scroller").getByRole("heading", { level: 2 }).first();
    expect(await head.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("4px");
    // 横に並ぶ細いカード（さくらユニットの見守り 9:30）は「9:30〜」
    await expect(page.locator("[data-task-id]").filter({ hasText: "9:30〜" }).first()).toBeVisible();
  });
});

test.describe("ダークモード（決定記録 0020）", () => {
  test("端末が暗い設定なら紺の画面。設定で「明るい」にすると明るく、読み込み直しても同じ。印刷は明るい", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(await bg()).toBe("rgb(15, 27, 45)");
    await page.goto("/setup");
    await page.getByRole("group", { name: "画面の明るさ" }).getByRole("button", { name: "明るい" }).click();
    expect(await bg()).toBe("rgb(243, 243, 239)");
    await page.reload();
    expect(await bg()).toBe("rgb(243, 243, 239)");
    await page.getByRole("group", { name: "画面の明るさ" }).getByRole("button", { name: "暗い（紺）" }).click();
    await page.emulateMedia({ colorScheme: "light" });
    expect(await bg()).toBe("rgb(15, 27, 45)");
    await page.emulateMedia({ media: "print" });
    expect(await bg()).toBe("rgb(255, 255, 255)");
  });
});

test.describe("ループ 18（暗い画面と見た目の直し）", () => {
  test("設定の先頭の目次から「画面の明るさ」へ飛べ、選んだものに ✓ が付く", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    await page.goto("/setup");
    await page.getByRole("navigation", { name: "このページの中" }).getByRole("link", { name: "画面の明るさ" }).click();
    const group = page.getByRole("group", { name: "画面の明るさ" });
    await expect(group).toBeInViewport();
    await group.getByRole("button", { name: "暗い（紺）" }).click();
    await expect(group.getByRole("button", { name: "暗い（紺）" })).toContainText("✓");
    await expect(page.getByText("画面の明るさを「暗い（紺）」にしました")).toBeAttached();
    // 暗い画面のトーストは紺の地（明るい地にしない）
    await page.goto("/board?now=10:12");
    await page.getByRole("button", { name: /に担当を追加$/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "追加" }).first().click();
    const toast = page.locator("#board-toast > div").first();
    await expect(toast).toBeVisible();
    expect(await toast.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(34, 52, 79)");
    // 元に戻したあとのお知らせには「元に戻す」を出さない
    await toast.getByRole("button", { name: "元に戻す" }).click();
    await expect(page.locator("#board-toast")).toContainText("元に戻しました");
    await expect(page.locator("#board-toast").getByRole("button", { name: "元に戻す" })).toHaveCount(0);
  });
});

test.describe("ループ 12・13・18 の持ち越し", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
  });

  test("ボードの日付を押して日を選ぶと、その日のボードへ移る", async ({ page }) => {
    await expect(page.getByRole("button", { name: /押すと日付を選べます/ })).toBeVisible();
    await page.locator('nav[aria-label="日付"] input[type="date"]').fill("2026-11-09");
    await expect(page).toHaveURL(/date=2026-11-09/);
    await expect(page.getByRole("button", { name: /11月9日（月）/ })).toBeVisible();
  });

  test("利用者一覧の名前を押すと、その方を選んだ状態で「1 人ずつ足す・直す」が開く", async ({ page }) => {
    await page.goto("/residents");
    // 名前のボタンは「101 山田 キヨ 様 （直す）」
    const name = page.getByRole("button", { name: /^101 .+（直す）$/ });
    await name.click();
    await expect(page.getByLabel(/名前/).first()).toHaveValue("山田 キヨ");
  });

  test("利用者がまだいないグループの列には、次の 1 手を書く", async ({ page }) => {
    await page.goto("/setup");
    await page.getByLabel(/^グループを足す/).fill("すみれ");
    await page.getByRole("button", { name: "＋ グループを足す" }).click();
    await page.goto("/board?date=2026-11-12&now=7:00");
    await page.getByRole("button", { name: "この内容で作る" }).click();
    await expect(page.getByTestId("board-scroller").getByText("利用者がまだいません（利用者の画面で足せます）")).toBeVisible();
  });
});

test.describe("ループ 19（元に戻すの範囲・まだ来ていない日）", () => {
  test("ほかの日（11/5）で作った時間割は、11/3 のボードの「元に戻す」に出ない。まだ来ていない日に現在時刻の線を出さない", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?date=2026-11-05&now=7:00");
    await page.getByRole("button", { name: "この内容で作る" }).click();
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    // 11/5 は 11/3（サンプルの今日）より先の日: 線も「終わっていない」も出さない
    await expect(page.locator(".cn-now-label")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^終わっていない/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^元に戻す ?（今日の時間割を作りました）/ })).toBeVisible();
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^元に戻す ?（今日の時間割を作りました）/ })).toHaveCount(0);
  });
});

test.describe("ループ 19（スマホの元に戻す）", () => {
  test("自分の予定の「元に戻す」は、リーダーの操作（時間割を作る）を出さない", async ({ page }) => {
    // リーダーが PC で 11/5 の時間割を作る
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?date=2026-11-05&now=7:00");
    await page.getByRole("button", { name: "この内容で作る" }).click();
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    // 同じ端末をスマホの幅で、応援の人が開く
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto("/me?now=10:12");
    await page.getByRole("list", { name: "きょうの出勤者" }).getByRole("button", { name: /^加藤 / }).click();
    await expect(page.getByRole("button", { name: /今日の時間割を作りました/ })).toHaveCount(0);
  });
});

test.describe("ループ 19 の持ち越し（朝の帯・印刷）", () => {
  test("夜勤の番の人が全員初回なら、朝の帯に一言出る（止めない）", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?date=2026-11-05&now=7:00");
    await expect(page.getByText(/夜勤の番の人は全員、この施設で初めての勤務です/)).toBeVisible();
    await expect(page.getByRole("button", { name: "この内容で作る" })).toBeEnabled();
  });

  test("サンプル施設の自分の予定の印刷は、サンプルの日と時計で日時を出す", async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto("/me?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/me?now=10:12");
    await page.getByRole("list", { name: "きょうの出勤者" }).getByRole("button", { name: /^高橋 / }).click();
    await page.emulateMedia({ media: "print" });
    await expect(page.getByText(/印刷 11\/3 10:12/)).toBeVisible();
  });
});

test.describe("始まる前の「終わった」（決定記録 0021）", () => {
  test("始まる前の枠は一言聞いてから付く。始まった枠は 1 回で付く", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    // 16:00 の枠（始まる前）
    const later = page.locator("[data-task-id]").filter({ hasText: "16:00" }).filter({ hasNot: page.locator("[data-done]") }).first();
    await later.locator("[data-card-title]").click();
    const dialog = page.getByRole("dialog");
    const btn = dialog.getByRole("button", { name: /終わったら押す|まだ始まる前/ });
    await btn.click();
    await expect(dialog.getByRole("button", { name: /まだ始まる前です/ })).toBeVisible();
    await dialog.getByRole("button", { name: /まだ始まる前です/ }).click();
    await expect(dialog.getByRole("button", { name: /終わった$/ })).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("元に戻すの履歴（決定記録 0021）", () => {
  test("見ている日の操作が新しい順に並び、選んだところまで戻せる", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    await expect(page.locator('[data-badge="担当未定"]').first()).toBeVisible();
    const before = await page.locator('[data-badge="担当未定"]').count();
    for (let i = 0; i < 2; i++) {
      await page.locator('[data-badge="担当未定"]').first().getByRole("button", { name: /に担当を追加$/ }).click();
      const panel = page.getByRole("dialog");
      const others = panel.getByRole("button", { name: /^ほかの人/ });
      if ((await others.count()) > 0 && (await others.getAttribute("aria-expanded")) !== "true") await others.click();
      await panel.getByRole("button", { name: "追加" }).first().click();
      await page.keyboard.press("Escape");
    }
    await expect(page.locator('[data-badge="担当未定"]')).toHaveCount(before - 2);
    await page.getByRole("button", { name: "履歴" }).click();
    const hist = page.getByRole("region", { name: "元に戻すの履歴" });
    await expect(hist.getByRole("listitem")).toHaveCount(2);
    await hist.getByRole("button", { name: "ここまで戻す（2 件）" }).click();
    await expect(hist).toContainText("新しい方から 2 件");
    await hist.getByRole("button", { name: "2 件を戻す" }).click();
    await expect(page.locator('[data-badge="担当未定"]')).toHaveCount(before);
    await expect(page.locator("#board-toast")).toContainText("元に戻しました（2 件");
  });
});

test.describe("続けて埋める（決定記録 0021）", () => {
  test("担当がそろったら、パネルを閉じずに「担当がそろっていない次の枠へ」で次の枠を開ける", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    const first = page.locator('[data-badge="担当未定"]').first();
    await expect(first).toBeVisible();
    await first.getByRole("button", { name: /に担当を追加$/ }).click();
    const panel = page.getByRole("dialog");
    const title1 = await panel.locator("#assign-title").innerText();
    const others = panel.getByRole("button", { name: /^ほかの人/ });
    if ((await others.count()) > 0 && (await others.getAttribute("aria-expanded")) !== "true") await others.click();
    await panel.getByRole("button", { name: "追加" }).first().click();
    const next = panel.getByRole("button", { name: "担当がそろっていない次の枠へ" });
    await expect(next).toBeFocused();
    await next.click();
    await expect(page.getByRole("dialog").locator("#assign-title")).not.toHaveText(title1);
  });
});

test.describe("手が空いたら（決定記録 0021）", () => {
  test("自分の予定の空き時間に「予定のない時間」と手伝える仕事の名前。札や件数は出さない", async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto("/me?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/me?now=10:12");
    await page.getByRole("list", { name: "きょうの出勤者" }).getByRole("button", { name: /^高橋 / }).click();
    const gap = page.locator("li").filter({ hasText: "予定のない時間" }).filter({ hasText: "10:30" });
    await expect(gap).toContainText("手伝える仕事: 10:30 入浴介助");
    await expect(gap).toContainText("先にリーダーに声をかけてください");
    await expect(gap).not.toContainText("担当未定");
    await expect(gap).not.toContainText("担当あと");
  });
});

test.describe("担当の入れ替え（決定記録 0021）", () => {
  test("業務の詳細から、時間の重なるほかの枠の担当と入れ替える。こう変わりますを見てから決め、1 回で元に戻せる", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    const card = page.locator("[data-task-id]").filter({ hasText: "入浴介助（2人介助）" }).first();
    await card.locator("[data-card-title]").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "伊藤さんの担当を入れ替える…" }).click();
    const box = dialog.getByRole("group", { name: "伊藤さんの入れ替え" });
    const choice = box.getByRole("listitem").first().getByRole("button");
    await expect(choice).toBeFocused();
    const other = ((await choice.locator("span").first().innerText()) ?? "").replace("さん", "");
    await choice.click();
    await expect(box).toContainText("こう変わります");
    await expect(box).toContainText(`伊藤さん: 入浴介助`);
    const decide = box.getByRole("button", { name: "この内容で入れ替える" });
    await expect(decide).toBeFocused();
    await decide.click();
    await expect(page.locator("#board-toast")).toContainText(`伊藤さんと${other}さんの担当を入れ替えました`);
    const staffSec = dialog.getByRole("region", { name: "担当" }).or(dialog.locator('section[aria-labelledby="d-staff"]'));
    await expect(staffSec.first()).toContainText(other);
    await expect(staffSec.first()).not.toContainText("伊藤");
    await page.locator("#board-toast").getByRole("button", { name: /元に戻す/ }).click();
    await expect(staffSec.first()).toContainText("伊藤");
  });
});

test.describe("やった人を変える（決定記録 0022）", () => {
  test("始まった枠で、担当の人の代わりにやった人を選ぶと担当が替わり「終わった」が付く。1 回で戻る", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    // おむつ交換（東フロア）10:00: 始まっていて、担当は鈴木・山本
    const card = page.locator("[data-task-id]").filter({ hasText: "おむつ交換" }).filter({ hasText: "鈴木" }).first();
    await card.locator("[data-card-title]").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "やった人を変える…" }).click();
    await dialog.getByRole("button", { name: "鈴木さんの代わり" }).click();
    const box = dialog.getByRole("region", { name: "鈴木さんの代わりにやった人" });
    const first = box.getByRole("listitem").first().getByRole("button");
    const who = (await first.locator("span").first().innerText()).replace("さん", "");
    await first.click();
    await expect(page.locator("#board-toast")).toContainText(`${who}さんがやったことにしました（鈴木さんの代わり`);
    const staff = dialog.locator('section[aria-labelledby="d-staff"]');
    await expect(staff).toContainText(who);
    await expect(staff).not.toContainText("鈴木");
    await expect(dialog.getByRole("button", { name: /終わった$/ })).toHaveAttribute("aria-pressed", "true");
    await page.locator("#board-toast").getByRole("button", { name: /元に戻す/ }).click();
    await expect(staff).toContainText("鈴木");
  });

  test("担当未定の始まった枠で、やった人を選ぶ", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    // リネン回収 9:30–10:00 は担当未定（サンプル）
    const card = page.locator("[data-task-id]").filter({ hasText: "リネン回収" }).first();
    await card.locator("[data-card-title]").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "やった人を変える…" }).click();
    const box = dialog.getByRole("region", { name: "やった人を選ぶ" });
    // 人を選ぶ段は見出しへ（1 回の Enter で決まらないように）
    await expect(box.getByRole("heading", { name: "やった人を選ぶ" })).toBeFocused();
    const first = box.getByRole("listitem").first().getByRole("button");
    const who = (await first.locator("span").first().innerText()).replace("さん", "");
    await first.click();
    await expect(page.locator("#board-toast")).toContainText(`${who}さんがやった`);
    await expect(dialog.getByRole("button", { name: /終わった$/ })).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.locator('section[aria-labelledby="d-staff"]')).toContainText(who);
    await page.locator("#board-toast").getByRole("button", { name: /元に戻す/ }).click();
    await expect(dialog.getByRole("button", { name: /終わったら押す/ })).toBeVisible();
  });

  test("始まる前の枠には出さない", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    const later = page.locator("[data-task-id]").filter({ hasText: "16:00" }).filter({ hasNot: page.locator("[data-done]") }).first();
    await later.locator("[data-card-title]").click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "やった人を変える…" })).toHaveCount(0);
  });
});

test.describe("ループ 22（業務の詳細の並び・いまの線・見守り・看護の一日）", () => {
  test("業務の詳細: 「予定を変える」と「やったことを記録する」を分けて書く", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    await page.locator("[data-task-id]").filter({ hasText: "おむつ交換" }).filter({ hasText: "鈴木" }).first().locator("[data-card-title]").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("予定を変える: 時間の重なるほかの業務の人と担当を入れ替えます（「終わった」の印は付きません）");
    await expect(dialog.getByRole("heading", { name: "やったことを記録する" })).toBeVisible();
    await expect(dialog).toContainText("やった人を担当にして「終わった」の印も付けます");
    await expect(dialog.getByRole("heading", { name: "時刻・中止" })).toBeVisible();
  });

  test("自分の予定: いまの線に「（見守りの途中）」、見守りには印が無い理由。看護の人に午後の看護の業務", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/me?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/me?now=10:12");
    await page.getByRole("list", { name: "きょうの出勤者" }).getByRole("button", { name: /^高橋 / }).click();
    await expect(page.getByText(/● いまの時間 10:12（見守り.*の途中）/)).toBeVisible();
    await expect(page.getByText("見守りは次の人へ引き継ぐ業務なので、「終わった」の印はありません。").first()).toBeVisible();
    await page.goto("/me?now=14:30");
    await page.getByRole("button", { name: /名前を選び直す|ほかの人/ }).first().click().catch(() => {});
    const list = page.getByRole("list", { name: "きょうの出勤者" });
    if (await list.isVisible()) await list.getByRole("button", { name: /^中村 / }).click();
    await expect(page.getByRole("heading", { name: "いまの時間の予定" }).locator("..")).toContainText("看護の業務");
  });
});
