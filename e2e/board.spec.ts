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
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1); // 見出しは施設名の1つ（1画面1目的）
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
    await expect(page.getByRole("region", { name: "休み" }).getByText(/渡辺さんの分 \d+件（担当未定 \d+/)).toBeVisible();
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

  test("カードの名前を押すと詳細が開き、対象の方ごとの時刻とサポートが出る（0004 §4）", async ({ page }) => {
    const card = page.locator("[data-task-id]").filter({ hasText: "起床介助" }).filter({ hasText: "人" }).last();
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("button", { name: /起床介助/ }).first().click();
    const panel = page.getByRole("dialog", { name: /起床介助/ });
    await expect(panel).toBeVisible();
    const kobayashi = panel.getByRole("listitem").filter({ hasText: "小林" });
    await expect(kobayashi).toContainText("6:30");
    await expect(panel.getByText(/^サポート: /).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });

  test("担当の追加: ＋ → 「空いている人」の「追加」で、バッジが消え、元に戻せる（2操作）", async ({ page }) => {
    const card = page.locator('[data-task-id][data-badge="担当未定"]').first();
    const id = await card.getAttribute("data-task-id");
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("button", { name: /に担当を追加$/ }).click();
    const panel = page.getByRole("dialog", { name: /.+/ });
    await expect(panel.getByText(/^空いている人 \d+人$/)).toBeVisible();
    await expect(panel.getByRole("button", { name: /^ほかの人（注意 \d+・勤務外 \d+）/ })).toBeVisible();
    await panel.getByRole("button", { name: /さんを追加$/ }).first().click();
    const after = page.locator(`[data-task-id="${id}"]`);
    await expect(after).not.toHaveAttribute("data-badge", "担当未定");
    await expect(page.locator("#board-toast")).toContainText("担当にしました");
    await page.locator("#board-toast").getByRole("button", { name: "元に戻す" }).click();
    await expect(after).toHaveAttribute("data-badge", "担当未定");
  });

  test("詳細パネル: 担当を外すと、バッジが出る", async ({ page }) => {
    const card = page.locator('[data-task-id][data-level="ok"]').first();
    const id = await card.getAttribute("data-task-id");
    await card.scrollIntoViewIfNeeded();
    await card.locator("[data-card-title]").click();
    const panel = page.getByRole("dialog");
    const removes = panel.getByRole("button", { name: /さんを担当から外す$/ });
    const n = await removes.count();
    for (let k = 0; k < n; k++) await removes.first().click();
    await expect(page.locator(`[data-task-id="${id}"]`)).toHaveAttribute("data-badge", /担当/);
  });

  test("D&D: 出勤者をカードへ落とすと担当になり、バッジが消える（1操作）", async ({ page }) => {
    const card = page.locator('[data-task-id][data-badge="担当未定"]').first();
    const id = await card.getAttribute("data-task-id");
    await page.waitForTimeout(300); // 開いたときの「現在時刻へ寄せる」が終わってから
    // 画面の端だとドラッグ中の自動スクロールでカードが動くので、真ん中へ寄せてから
    await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const who = page.getByRole("complementary", { name: "きょうの出勤者" }).getByRole("button", { name: /^\S+ / }).first();
    const from = (await who.boundingBox())!;
    const to = (await card.boundingBox())!;
    await page.mouse.move(from.x + 20, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + from.height / 2, { steps: 4 });
    await page.waitForTimeout(100); // 持ち上げたあと、落とせる場所の測り直しを待つ
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.waitForTimeout(100);
    // 途中で時間割の端を通ると自動で送られてカードが動くので、測り直して真上へ
    const at = (await card.boundingBox())!;
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2, { steps: 2 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await expect(page.locator(`[data-task-id="${id}"]`)).not.toHaveAttribute("data-badge", "担当未定");
    await expect(page.locator("#board-toast")).toContainText(/担当にしました/);
  });

  test("見出しの件数を押すと、該当する枠へ移動する", async ({ page }) => {
    await page.goto("/board?now=7:00");
    await page.getByRole("button", { name: /^担当未定 \d+件。押すと次の枠へ移動/ }).click();
    const focused = page.locator('[data-badge="担当未定"] button:focus');
    await expect(focused).toHaveCount(1);
    await expect(focused).toBeInViewport();
  });

  test("短い業務も「＋」と状態が切れない", async ({ page }) => {
    const clipped = await page.$$eval("[data-task-id]", (els) =>
      els.filter((e) => {
        const cb = e.getBoundingClientRect();
        return [...e.querySelectorAll("button[aria-label$='に担当を追加'], span.font-bold")].some((x) => {
          const b = x.getBoundingClientRect();
          return b.bottom > cb.bottom + 0.5 || b.right > cb.right + 0.5;
        });
      }).length,
    );
    expect(clipped).toBe(0);
  });

  test("現在時刻ラインが出る", async ({ page }) => {
    await expect(page.getByLabel("時間割").getByText("10:12", { exact: true })).toBeVisible();
  });
});

test.describe("今日の時間割を作る（1タップ）", () => {
  test("空の日は帯が出て、先週の同じ曜日の番で並び、1タップで時間割ができ、元に戻せる", async ({ page }) => {
    // サンプルの勤務表は 11/10 まで入っている。勤務表のない 11/13（金）は先週 11/6 の番を写す
    await page.goto("/board?date=2026-11-13&now=7:00");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?date=2026-11-13&now=7:00");
    const band = page.getByRole("region", { name: "今日の時間割を作る" });
    await expect(band).toBeVisible();
    await expect(band.getByText(/先週の同じ曜日（11\/6）と同じ番で並べました/)).toBeVisible();
    await expect(band.getByRole("combobox", { name: "業務表" })).toHaveValue(/.+/); // 業務表が選ばれている
    // スポット（11/6 に来た加藤）は写さない
    await expect(band.getByRole("list", { name: "今日の出勤者" }).getByText("加藤")).toHaveCount(0);

    await band.getByRole("button", { name: "この内容で作る" }).click(); // 1タップ
    expect(await page.locator("[data-task-id]").count()).toBeGreaterThan(30);
    await expect(page.getByRole("button", { name: /^元に戻す\s*（/ })).toBeVisible();

    await page.getByRole("button", { name: /^元に戻す\s*（/ }).click();
    await expect(page.getByRole("region", { name: "今日の時間割を作る" })).toBeVisible();
  });

  test("休みにした人の番の枠は担当未定になる", async ({ page }) => {
    // 先週（11/6）の番を写す日。渡辺（介護助手）が出勤で並ぶ
    await page.goto("/board?date=2026-11-13&now=7:00");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?date=2026-11-13&now=7:00");
    const band = page.getByRole("region", { name: "今日の時間割を作る" });
    const watanabe = band.getByRole("listitem").filter({ hasText: "渡辺" });
    await watanabe.getByRole("button", { name: "休み" }).click();
    await expect(watanabe.getByRole("button", { name: "出勤に戻す" })).toBeVisible();
    await band.getByRole("button", { name: "この内容で作る" }).click();
    await expect(page.locator("#board-toast")).toContainText("今日の時間割を作りました");
    await expect(page.locator("#board-title")).toBeFocused();
    await expect(page.getByRole("region", { name: "休み" }).getByText(/渡辺さんの分 \d+件（担当未定 \d+/)).toBeVisible();
  });
});

test("朝: 今日来る人（スポット）を足すと、番と初回の印が付いて並ぶ", async ({ page }) => {
  await page.goto("/board?date=2026-11-10&now=7:00");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/board?date=2026-11-10&now=7:00");
  const band = page.getByRole("region", { name: "今日の時間割を作る" });
  await band.getByRole("button", { name: "＋ 今日来る人を足す" }).click();
  await band.getByRole("combobox", { name: "今日来る人を選ぶ" }).selectOption({ label: "加藤（スポット）" });
  const row = band.getByRole("listitem").filter({ hasText: "加藤" });
  await expect(row.getByText("初回")).toBeVisible();
  await expect(row.getByRole("combobox", { name: "加藤 の番" })).toHaveValue(/spot/);
});

test.describe("ボードの見え方", () => {
  test("開いたとき現在時刻の近くへ寄せる", async ({ page }) => {
    await page.goto("/board?now=14:00");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    const top = await page.getByTestId("board-scroller").evaluate((el) => el.scrollTop);
    expect(top).toBeGreaterThan(1000); // 6:00 起点で 13:00 は 7時間×180px
  });

  test("スマホ幅ではボードを出さず、1文と「自分の予定を開く」を出す", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/board");
    await expect(page.getByText("ボードは PC・タブレット用の画面です。")).toBeVisible();
    await page.getByRole("link", { name: "自分の予定を開く" }).click();
    await expect(page).toHaveURL(/\/me/);
  });

  test("ボタン・リンクは 44px 以上（ナビ・カードの名前・＋）", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
    for (const loc of [page.getByRole("link", { name: "業務の見直し" }), page.locator("[data-task-id] button").first()]) {
      const box = await loc.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("ボード（翌朝）", () => {
  test("翌 6:00 より後の業務は、時間の軸が「翌朝」まで伸びて同じ列に出る。列の見出しは「利用者 n人」", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    const grid = page.getByLabel("時間割");
    await expect(grid.getByText(/ここから翌朝（11\/4 6:00 以降/)).toBeAttached();
    await expect(grid.getByText("翌7:00", { exact: true })).toBeAttached();
    const card = page.locator("[data-task-id]").filter({ hasText: "朝食介助" }).filter({ hasText: "翌7:30" }).first();
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
    await expect(page.getByRole("heading", { name: /東フロア 利用者 20人/ })).toBeVisible();
  });
});

test.describe("ボード（元に戻すの記録）", () => {
  test("読み込み直しても「元に戻す」が残り、戻せる", async ({ page }) => {
    await page.goto("/board?now=10:12");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/board?now=10:12");
    const card = page.locator('[data-task-id][data-badge="担当未定"]').first();
    const id = (await card.getAttribute("data-task-id"))!;
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("button", { name: /に担当を追加$/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /さんを追加$/ }).first().click();
    await expect(page.locator(`[data-task-id="${id}"]`)).not.toHaveAttribute("data-badge", "担当未定");
    await page.reload();
    await expect(page.locator(`[data-task-id="${id}"]`)).not.toHaveAttribute("data-badge", "担当未定");
    await page.getByRole("button", { name: /^元に戻す/ }).first().click();
    await expect(page.locator(`[data-task-id="${id}"]`)).toHaveAttribute("data-badge", "担当未定");
  });
});
