import { expect, test, type Page } from "@playwright/test";

/**
 * docs/acceptance.md の受け入れ条件のうち、既存の E2E で確かめていないもの（PC 1440×900）。
 * 各 test の名前の先頭に acceptance.md の行番号を付ける（L27 など）。
 */

async function openBoard(page: Page, query = "now=10:12") {
  await page.goto(`/board?${query}`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/board?${query}`);
}

async function openSampleBoard(page: Page) {
  await openBoard(page);
  await expect(page.locator("[data-task-id]").first()).toBeVisible();
}

/** 入浴介助（担当あと n 人）の「＋」パネルを開く */
async function openBathPanel(page: Page) {
  const card = page.locator("[data-task-id]").filter({ hasText: "入浴介助" }).filter({ hasText: "担当あと" }).first();
  await card.scrollIntoViewIfNeeded();
  await card.getByRole("button", { name: /に担当を追加$/ }).click();
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();
  return { card, panel };
}

test.describe("受け入れ: ボード", () => {
  test.beforeEach(async ({ page }) => {
    await openSampleBoard(page);
  });

  test("L27 ＋のパネル: 空いている人だけ開き、ほかの人は畳む。全員に理由が一文", async ({ page }) => {
    const { panel } = await openBathPanel(page);
    const okList = panel.locator("section").filter({ has: page.getByRole("heading", { name: /^空いている人 \d+人$/ }) }).getByRole("listitem");
    const okCount = await okList.count();
    const folded = panel.getByRole("button", { name: /^ほかの人（注意 (\d+)・勤務外 (\d+)）/ });
    // 空いている人がいれば畳んでおく。0 人なら最初から開いている（押す回数を増やさない）
    await expect(folded).toHaveAttribute("aria-expanded", okCount > 0 ? "false" : "true");
    const m = /注意 (\d+)・勤務外 (\d+)/.exec((await folded.innerText()) ?? "")!;
    if (okCount > 0) {
      expect(await panel.getByRole("listitem").count()).toBe(okCount);
      await folded.click();
    }
    const all = panel.getByRole("listitem");
    expect(await all.count()).toBe(okCount + Number(m[1]) + Number(m[2]));
    // 全員に理由が一文（名前の下の p）
    const reasons = await all.evaluateAll((lis) => lis.map((li) => li.querySelector("p")?.textContent?.trim() ?? ""));
    expect(reasons.length).toBeGreaterThan(0);
    for (const r of reasons) expect(r.length).toBeGreaterThan(3);
  });

  test("L28 注意（重なり・勤務外の一部・休憩・条件・初回のみ）は理由つきで追加でき、二重登録はできない", async ({ page }) => {
    const { panel, card } = await openBathPanel(page);
    const id = await card.getAttribute("data-task-id");
    const others = panel.getByRole("button", { name: /^ほかの人/ });
    if ((await others.getAttribute("aria-expanded")) !== "true") await others.click();
    const text = await panel.innerText();
    expect(text).toMatch(/注意: .*と重なります/);
    expect(text).toMatch(/条件「.+」を満たしていません/);
    // 注意の人の「追加」を押すと担当になる（警告して許可）
    const warnRow = panel.getByRole("listitem").filter({ hasText: "注意:" }).first();
    const btn = warnRow.getByRole("button", { name: /さんを追加$/ });
    const surname = (await btn.getAttribute("aria-label"))!.replace(/さんを追加$/, "");
    await btn.click();
    await expect(page.locator("#board-toast")).toContainText(`${surname}さんを「入浴介助（東フロア）」の担当にしました`);
    await expect(page.locator(`[data-task-id="${id}"]`).getByRole("button", { name: new RegExp(`^${surname}`) })).toBeVisible();
    // 二重登録: すでに担当の人は、パネルの候補に出ない
    if (!(await page.getByRole("dialog").isVisible())) {
      await page.locator(`[data-task-id="${id}"]`).getByRole("button", { name: /に担当を追加$/ }).click();
    }
    const again = page.getByRole("dialog");
    const folded = again.getByRole("button", { name: /^ほかの人/ });
    if ((await folded.getAttribute("aria-expanded")) === "false") await folded.click();
    await expect(again.getByRole("button", { name: `${surname}さんを追加` })).toHaveCount(0);
  });

  test("L28 初回の方だけの配置は「注意」で理由が出て、追加できる", async ({ page }) => {
    // サンプルでは加藤（初回）の 15:30 面会対応は「水分補給」との重なりが先に出る。重なりを外してから見る
    const water = page.locator("[data-task-id]").filter({ hasText: "水分補給" }).filter({ hasText: "加藤" }).first();
    await water.scrollIntoViewIfNeeded();
    // 横に並ぶ短い枠は担当を名字の文字で出すので、業務名から詳細を開く
    await water.locator("[data-card-title]").click();
    await page.getByRole("dialog").getByRole("button", { name: "加藤さんを担当から外す" }).click();
    await page.keyboard.press("Escape");
    const card = page.locator('[data-task-id][data-badge="担当未定"]').filter({ hasText: "面会対応" }).first();
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("button", { name: /に担当を追加$/ }).click();
    const panel = page.getByRole("dialog");
    {
      const others = panel.getByRole("button", { name: /^ほかの人/ });
      if ((await others.getAttribute("aria-expanded")) !== "true") await others.click();
    }
    const kato = panel.getByRole("listitem").filter({ hasText: "加藤" });
    await expect(kato).toContainText("注意: 初回の方だけの配置になります");
    await kato.getByRole("button", { name: "加藤さんを追加" }).click();
    await expect(page.locator("#board-toast")).toContainText("加藤さんを「面会対応 松本様」の担当にしました");
  });

  test("L28 二重登録: 担当の人をパレットから同じカードへ落としても入らない", async ({ page }) => {
    const card = page.locator('[data-task-id][data-level="ok"]').filter({ hasText: "入浴介助" }).first();
    const id = (await card.getAttribute("data-task-id"))!;
    await page.waitForTimeout(300);
    await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const chips = card.locator("button[aria-roledescription]");
    const before = await chips.count();
    expect(before).toBeGreaterThan(0);
    const surname = (await chips.first().getAttribute("aria-label"))!.replace(/（初回）$/, "");
    const who = page.getByRole("complementary", { name: "きょうの出勤者" }).getByRole("button", { name: new RegExp(`^${surname} `) });
    const from = (await who.boundingBox())!;
    await page.mouse.move(from.x + 20, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + from.height / 2, { steps: 4 });
    await page.waitForTimeout(100);
    const to = (await card.boundingBox())!;
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await page.waitForTimeout(100);
    const at = (await card.boundingBox())!;
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2, { steps: 2 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await expect(page.locator("#board-toast")).toContainText(`${surname}さん: すでにこの業務の担当です`);
    await expect(page.locator(`[data-task-id="${id}"] button[aria-roledescription]`)).toHaveCount(before);
  });

  test("L29 変更はトーストで分かり、ツールバーの「元に戻す」で10手まで戻る（トーストが消えても出ている）", async ({ page }) => {
    const card = page.locator("[data-task-id]").filter({ hasText: "起床介助" }).filter({ hasText: "人" }).last();
    const id = (await card.getAttribute("data-task-id"))!;
    const label = async () => (await page.locator(`[data-task-id="${id}"]`).getAttribute("aria-label"))!;
    const original = await label();
    await card.scrollIntoViewIfNeeded();
    await card.locator("[data-card-title]").click();
    const panel = page.getByRole("dialog", { name: /起床介助/ });
    for (let k = 0; k < 10; k++) {
      await panel.getByRole("button", { name: "30分後へ" }).click();
      await expect(page.locator("#board-toast")).toContainText("「起床介助」を30分後へずらしました");
    }
    await page.keyboard.press("Escape");
    expect(await label()).not.toBe(original);
    const undo = page.getByRole("button", { name: /^元に戻す\s*（/ });
    // トーストが消えたあとも、ツールバーの「元に戻す」は出ている
    await expect(page.locator("#board-toast")).not.toContainText("ずらしました", { timeout: 10_000 });
    await expect(undo).toBeVisible();
    for (let k = 0; k < 10; k++) await undo.click();
    await expect.poll(label).toBe(original);
  });

  test("L30 カードの詳細: 中止・ずらす・担当を外す・対象者。カードを縦にドラッグしても時刻は変わらない", async ({ page }) => {
    const card = page.locator("[data-task-id]").filter({ hasText: "起床介助" }).filter({ hasText: "人" }).last();
    const id = (await card.getAttribute("data-task-id"))!;
    const original = await card.getAttribute("aria-label");
    await card.scrollIntoViewIfNeeded();
    await card.locator("[data-card-title]").click();
    const panel = page.getByRole("dialog", { name: /起床介助/ });
    await expect(panel.getByRole("button", { name: "この業務を中止" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "30分前へ" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "30分後へ" })).toBeVisible();
    await expect(panel.getByRole("button", { name: /さんを担当から外す$/ }).first()).toBeVisible();
    await expect(panel.getByRole("heading", { name: /^対象の方 \d+人$/ })).toBeVisible();
    await page.keyboard.press("Escape");
    // カードの本体（時刻の行）をつかんで下へ 200px 動かす
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + box.width - 8, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 8, box.y + 204, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator(`[data-task-id="${id}"]`)).toHaveAttribute("aria-label", original!);
  });

  test("L31 職員表示: 勤務外（斜線と勤務時間）・休憩・見守りの空き（担当未定）が見え、件数・予定時間は出ない", async ({ page }) => {
    // 見守りの担当を外して空きを作る
    const watch = page.locator("[data-task-id]").filter({ hasText: "見守り" }).first();
    await watch.scrollIntoViewIfNeeded();
    await watch.locator("[data-card-title]").click();
    const panel = page.getByRole("dialog");
    const removes = panel.getByRole("button", { name: /さんを担当から外す$/ });
    const n = await removes.count();
    for (let k = 0; k < n; k++) await removes.first().click();
    await page.keyboard.press("Escape");
    await page.getByRole("group", { name: "横軸" }).getByRole("button", { name: "職員" }).click();
    const view = page.getByTestId("staff-view");
    await expect(view.getByRole("list", { name: "見守りのつながり" }).getByRole("button", { name: /担当未定/ }).first()).toBeVisible();
    await expect(view.getByRole("button", { name: /休憩/ }).first()).toBeVisible();
    // 勤務外は斜線（勤務時間の外の帯）と、名前の下の勤務時間
    const hatched = await view.locator("[data-staff-row] div[aria-hidden='true']").evaluateAll((els) => els.filter((e) => (e as HTMLElement).style.backgroundImage.includes("repeating-linear-gradient")).length);
    expect(hatched).toBeGreaterThan(0);
    await expect(view.locator("[data-staff-row]").first()).toContainText(/\d{1,2}:\d{2}–\d{1,2}:\d{2}/);
    expect(await view.innerText()).not.toMatch(/\d+件|計\d|時間\d+分/);
  });

  test("L63・L38 ⋯ メニューは 分担表を印刷・今日を業務表として保存・サンプルに戻す の3つ（作り直しはない: 決定記録 0005）", async ({ page }) => {
    await page.getByRole("button", { name: "ほかの操作" }).click();
    const items = await page.locator("#board-menu button").allInnerTexts();
    expect(items).toEqual(["分担表を印刷", "今日を業務表として保存", "サンプルに戻す"]);
  });

  test("L75 押せる領域 44px 以上: カードの名前・担当チップ・＋・ナビ・ツールバー", async ({ page }) => {
    const result = await page.evaluate(() => {
      const size = (sel: string) =>
        [...document.querySelectorAll<HTMLElement>(sel)].map((e) => {
          const r = e.getBoundingClientRect();
          return { name: (e.getAttribute("aria-label") ?? e.textContent ?? "").trim(), w: Math.round(r.width), h: Math.round(r.height) };
        });
      const under = (xs: { name: string; w: number; h: number }[]) => xs.filter((x) => x.w < 44 || x.h < 44).map((x) => `${x.name} ${x.w}x${x.h}`);
      return {
        nav: under(size("nav a")),
        toolbar: under(size("[role='group'][aria-label='横軸'] button, button[aria-label='ほかの操作'], button[aria-label='この数字について']")),
        plus: under(size("[data-task-id] button[aria-label$='に担当を追加']")),
        palette: under(size("[aria-label='きょうの出勤者'] button")),
        // カードの業務名（混んだ列では幅が 0 になるものも数える）
        title: under(size("[data-task-id] [data-card-title]")),
        // 担当チップは見た目 28px で、::before で上下に押せる領域を広げている。実際に押せる高さを当たり判定で測る
        chip: [...document.querySelectorAll<HTMLElement>("[data-task-id] button[aria-roledescription]")]
          .filter((e) => {
            const r = e.getBoundingClientRect();
            // 時間割の見えている範囲（列見出しの下）に収まっているものだけ
            const view = document.querySelector("[data-testid='board-scroller']")!.getBoundingClientRect();
            if (r.top - 10 < view.top + 48 || r.bottom + 10 > view.bottom) return false;
            // 横スクロールで右端に隠れているものも除く（隠れているのは大きさの問題ではない）
            if (r.left < view.left || r.right > view.right) return false;
            const x = r.left + r.width / 2;
            const hit = (y: number) => e.contains(document.elementFromPoint(x, y));
            const top = r.top + r.height / 2 - 21.5;
            const bottom = r.top + r.height / 2 + 21.5;
            return r.width < 44 || !hit(top) || !hit(bottom);
          })
          .map((e) => `${e.getAttribute("aria-label")} ${Math.round(e.getBoundingClientRect().width)}x(当たり判定 44 未満)`),
      };
    });
    expect.soft(result.nav, "ナビ").toEqual([]);
    expect.soft(result.toolbar, "ツールバー").toEqual([]);
    expect.soft(result.plus, "＋").toEqual([]);
    expect.soft(result.palette, "出勤者").toEqual([]);
    expect.soft(result.title.length, `カードの業務名が 44px 未満: ${result.title.slice(0, 5).join("、")}`).toBe(0);
    expect.soft(result.chip.length, `担当チップが 44px 未満: ${result.chip.slice(0, 5).join("、")}`).toBe(0);
  });

  test("L75 ボードの文字のコントラスト 4.5:1 以上（axe color-contrast）", async ({ page }) => {
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const bad = await page.evaluate(async () => {
      // @ts-expect-error axe はページに読み込んだもの
      const r = await window.axe.run(document, { runOnly: ["color-contrast"] });
      return r.violations.flatMap((v: { nodes: { target: string[]; any: { message: string }[] }[] }) => v.nodes.map((n) => `${n.target.join(" ")}: ${n.any[0]?.message}`));
    });
    expect(bad).toEqual([]);
  });

  test("L49 ボードの詳細では、利用者はフルネーム", async ({ page }) => {
    const card = page.locator("[data-task-id]").filter({ hasText: "起床介助" }).filter({ hasText: "人" }).last();
    await card.scrollIntoViewIfNeeded();
    await card.locator("[data-card-title]").click();
    const names = await page.getByRole("dialog", { name: /起床介助/ }).getByRole("listitem").locator("span.font-bold").filter({ hasText: /様$/ }).allInnerTexts();
    expect(names.length).toBeGreaterThan(1);
    for (const n of names) expect(n).toMatch(/^\S+ \S+様$/);
  });

  test("L76 キーボードだけで: 先頭の飛び先「出勤者一覧へ移動」、＋ → 追加 で割当、元に戻すで取消", async ({ page }) => {
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "出勤者一覧へ移動" });
    await expect(skip).toBeFocused();
    const card = page.locator('[data-task-id][data-badge="担当未定"]').first();
    const id = (await card.getAttribute("data-task-id"))!;
    await card.getByRole("button", { name: /に担当を追加$/ }).focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog");
    await expect(panel.getByRole("button", { name: "閉じる" })).toBeFocused();
    // Tab で最初の「追加」まで進む
    for (let k = 0; k < 10; k++) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
      if (/さんを追加$/.test(focused)) break;
    }
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")).toMatch(/さんを追加$/);
    await page.keyboard.press("Enter");
    await expect(page.locator(`[data-task-id="${id}"]`)).not.toHaveAttribute("data-badge", "担当未定");
    await page.keyboard.press("Escape");
    const undo = page.getByRole("button", { name: /^元に戻す\s*（/ });
    await undo.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(`[data-task-id="${id}"]`)).toHaveAttribute("data-badge", "担当未定");
  });
});

test.describe("受け入れ: 今日の時間割を作る", () => {
  test.beforeEach(async ({ page }) => {
    await openBoard(page, "date=2026-11-10&now=7:00");
  });

  test("L35 火曜の業務表「入浴日」が選ばれ、先週の休みの人は休みとして写さない", async ({ page }) => {
    const band = page.getByRole("region", { name: "今日の時間割を作る" });
    const select = band.getByRole("combobox").last();
    await expect(select.locator("option:checked")).toHaveText(/入浴日/);
    // 先週（11/3）休みの渡辺さんは、休みの印を引き継がず出勤で並ぶ
    const watanabe = band.getByRole("listitem").filter({ hasText: "渡辺" });
    await expect(watanabe.getByRole("button", { name: "休み" })).toBeVisible();
  });

  test("L36 1タップで、番に束ねた業務に担当が付く", async ({ page }) => {
    await page.getByRole("region", { name: "今日の時間割を作る" }).getByRole("button", { name: "この内容で作る" }).click();
    const cards = page.locator("[data-task-id]");
    await expect(cards.first()).toBeVisible();
    expect(await page.locator('[data-task-id][data-level="ok"]').count()).toBeGreaterThan(10);
    expect(await page.locator("[data-task-id] button[aria-roledescription]").count()).toBeGreaterThan(10);
  });

  test("L37 介護助手（渡辺）を休みにすると、介護助手の番の枠（リネン回収など）が担当未定", async ({ page }) => {
    const band = page.getByRole("region", { name: "今日の時間割を作る" });
    await band.getByRole("listitem").filter({ hasText: "渡辺" }).getByRole("button", { name: "休み" }).click();
    await band.getByRole("button", { name: "この内容で作る" }).click();
    await expect(page.locator('[data-task-id][data-badge="担当未定"]').filter({ hasText: "リネン回収" }).first()).toBeVisible();
  });

  test("L40 急かす表示（目標◯分・残り◯秒など）がない", async ({ page }) => {
    const text = await page.getByRole("region", { name: "今日の時間割を作る" }).innerText();
    expect(text).not.toMatch(/目標|\d+\s*分以内|\d+\s*秒|急いで|残り/);
  });

  test("L141 ノンコアの業務（リネン回収・物品補充）は業務表から番に束ねて担当が付く", async ({ page }) => {
    await page.getByRole("region", { name: "今日の時間割を作る" }).getByRole("button", { name: "この内容で作る" }).click();
    for (const name of ["リネン回収", "物品補充"]) {
      const card = page.locator("[data-task-id]").filter({ hasText: name }).first();
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute("data-level", "ok");
      await expect(card.getByRole("button", { name: /^渡辺/ })).toBeVisible();
    }
  });
});

test.describe("受け入れ: 利用者（0004）と時間割", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/residents");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/residents");
    await expect(page.locator("tbody tr").first()).toBeVisible();
  });

  async function makeTuesday(page: Page) {
    await page.goto("/board?date=2026-11-10&now=7:00");
    await page.getByRole("region", { name: "今日の時間割を作る" }).getByRole("button", { name: "この内容で作る" }).click();
    await expect(page.locator("[data-task-id]").first()).toBeVisible();
  }

  async function openDetailOf(page: Page, taskName: string, surname: string) {
    const cards = page.locator("[data-task-id]").filter({ hasText: taskName });
    const n = await cards.count();
    for (let k = 0; k < n; k++) {
      const c = cards.nth(k);
      await c.scrollIntoViewIfNeeded();
      await c.locator("[data-card-title]").click();
      const panel = page.getByRole("dialog");
      if ((await panel.getByRole("listitem").filter({ hasText: surname }).count()) > 0) return { panel, card: c };
      await page.keyboard.press("Escape");
    }
    throw new Error(`${taskName}に${surname}様がいません`);
  }

  test("L132 名簿を貼り付けた方は、次に作った時間割の一括の枠に入る（追加の入力なし）", async ({ page }) => {
    await page.getByRole("button", { name: "名簿を貼り付ける" }).click();
    await page.getByRole("textbox", { name: "名簿", exact: true }).fill("森 ツル, 東フロア, 199");
    await page.getByRole("button", { name: "この内容で足す" }).click();
    await expect(page.locator("tbody tr").filter({ has: page.getByRole("rowheader", { name: /森 ツル/ }) })).toBeVisible();
    await makeTuesday(page);
    const { panel } = await openDetailOf(page, "起床介助", "森");
    await expect(panel.getByRole("listitem").filter({ hasText: "森 ツル" })).toBeVisible();
  });

  test("L134 枠の中の時刻は一括の枠のまま（対象者一覧に時刻）、枠の外は別の枠になる", async ({ page }) => {
    // 東フロアの田中様: 枠の中、小林様: 枠の外
    for (const g of ["東フロア", "さくらユニット"]) {
      await page.getByRole("group", { name: "グループ" }).getByRole("button", { name: g }).click();
      if ((await page.getByRole("rowheader", { name: /田中/ }).count()) > 0) break;
    }
    const col = await page.locator("thead th").evaluateAll((ths) => ths.findIndex((th) => th.textContent?.includes("起床介助")));
    const cellOf = (s: string) => page.locator("tbody tr").filter({ has: page.getByRole("rowheader", { name: new RegExp(s) }) }).locator("td, th").nth(col).getByRole("button");
    // 田中様: 枠の中の時刻
    await (await cellOf("田中")).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("開始").fill("6:45"); // 標準 6:00–7:00 の中
    await expect(dialog.getByText("この時刻で、いつもの枠に入ります")).toBeVisible();
    const inTime = await dialog.getByLabel("開始").inputValue();
    await dialog.getByRole("button", { name: "この内容で決定" }).click();
    // 小林様: 10:30（枠の外）
    await expect(page.getByRole("rowheader", { name: /小林/ })).toHaveCount(1); // 小林様は田中様と同じグループ
    await (await cellOf("小林")).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("開始").fill("10:30");
    await expect(dialog.getByText("枠の外なので、別の枠になります")).toBeVisible();
    await dialog.getByRole("button", { name: "この内容で決定" }).click();

    await makeTuesday(page);
    const { panel } = await openDetailOf(page, "起床介助", "田中");
    await expect(panel.getByRole("listitem").filter({ hasText: "田中" })).toContainText(inTime);
    expect(await panel.getByRole("listitem").count()).toBeGreaterThan(1); // 一括の枠のまま
    await expect(panel.getByRole("listitem").filter({ hasText: "小林" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    const own = await openDetailOf(page, "起床介助", "小林");
    await expect(own.panel.getByText(/10:30/).first()).toBeVisible();
    expect(await own.panel.locator("section[aria-labelledby='d-targets'] li").count()).toBe(1);
  });

  test("L135 複数の方を選んで「選んだ方はなし」を一度に入れ、1回で元に戻せる", async ({ page }) => {
    for (const g of ["東フロア", "さくらユニット"]) {
      await page.getByRole("group", { name: "グループ" }).getByRole("button", { name: g }).click();
      if ((await page.getByRole("rowheader", { name: /田中/ }).count()) > 0) break;
    }
    await page.getByRole("checkbox", { name: /田中/ }).check();
    await page.getByRole("checkbox", { name: /小林/ }).check();
    await page.getByRole("button", { name: /^起床介助をまとめて変える（2人）/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "選んだ方はなし" }).click();
    const col = await page.locator("thead th").evaluateAll((ths) => ths.findIndex((th) => th.textContent?.includes("起床介助")));
    const cellOf = (s: string) => page.locator("tbody tr").filter({ has: page.getByRole("rowheader", { name: new RegExp(s) }) }).locator("td, th").nth(col).getByRole("button");
    await expect(cellOf("田中")).toHaveText("なし");
    await expect(cellOf("小林")).toHaveText("なし");
    await page.getByRole("status").getByRole("button", { name: "元に戻す" }).click();
    await expect(cellOf("田中")).not.toHaveText("なし");
    await expect(cellOf("小林")).not.toHaveText("なし");
  });

  test("L137 24時間シート: 生活リズム・意向・好み・自分でできること・サポートが必要なことを書け、再読み込みで残る", async ({ page }) => {
    for (const g of ["東フロア", "さくらユニット"]) {
      await page.getByRole("group", { name: "グループ" }).getByRole("button", { name: g }).click();
      if ((await page.getByRole("rowheader", { name: /田中/ }).count()) > 0) break;
    }
    const openSheet = async () => {
      await page.getByRole("button", { name: "24時間シート" }).click();
      await page.getByRole("navigation", { name: /の利用者$/ }).getByRole("button", { name: /田中/ }).click();
    };
    await openSheet();
    const stamp = Date.now();
    const fields = ["生活リズム", "意向・好み", "自分でできること", "サポートが必要なこと"];
    for (const f of fields) {
      const box = page.getByRole("textbox", { name: new RegExp(`起床介助 の${f}$`) });
      await box.fill(`テスト ${f} ${stamp}`);
      await box.blur();
      await expect(page.getByRole("status")).toContainText(`${f}を保存しました`);
    }
    await page.reload();
    await page.getByRole("group", { name: "グループ" }).getByRole("button", { name: "さくらユニット" }).waitFor();
    for (const g of ["東フロア", "さくらユニット"]) {
      await page.getByRole("group", { name: "グループ" }).getByRole("button", { name: g }).click();
      if ((await page.getByRole("rowheader", { name: /田中/ }).count()) > 0) break;
    }
    await openSheet();
    for (const f of fields) await expect(page.getByRole("textbox", { name: new RegExp(`起床介助 の${f}$`) })).toHaveValue(`テスト ${f} ${stamp}`);
  });

  test("L138 この方だけの行: 業務の種類を選べば次の時間割で個別の枠になり、選ばなければ枠にならない", async ({ page }) => {
    for (const g of ["東フロア", "さくらユニット"]) {
      await page.getByRole("group", { name: "グループ" }).getByRole("button", { name: g }).click();
      if ((await page.getByRole("rowheader", { name: /小林/ }).count()) > 0) break;
    }
    await page.getByRole("button", { name: "24時間シート" }).click();
    await page.getByRole("navigation", { name: /の利用者$/ }).getByRole("button", { name: /小林/ }).click();
    const add = async (time: string, name: string, kind?: string) => {
      await page.getByRole("button", { name: "＋ この方だけの行を足す" }).click();
      const form = page.getByRole("form", { name: "この方だけの行を足す" });
      await form.getByLabel("時刻").fill(time);
      await form.getByLabel("名前").fill(name);
      if (kind) {
        const select = form.getByLabel("業務の種類（任意）");
        const value = await select.locator("option").filter({ hasText: kind }).first().getAttribute("value");
        await select.selectOption(value!);
      }
      await form.getByRole("button", { name: "この内容で決定" }).click();
      await expect(page.locator('tr[data-kind="extra"]').filter({ hasText: time })).toBeVisible();
    };
    await add("15:40", "シートだけの行");
    await add("16:10", "個別の枠の行", "口腔ケア");
    await makeTuesday(page);
    const withKind = page.locator("[data-task-id]").filter({ hasText: /口腔ケア/ }).filter({ hasText: "16:10" });
    await expect(withKind.first()).toBeVisible();
    expect(await page.locator("[data-task-id]").filter({ hasText: "シートだけの行" }).count()).toBe(0);
    expect(await page.locator("[data-task-id]").filter({ hasText: "15:40" }).count()).toBe(0);
  });

  test("L139 24時間シートを A4 縦で印刷できる（印刷ボタン・@page A4 portrait・操作は隠れる）", async ({ page }) => {
    for (const g of ["東フロア", "さくらユニット"]) {
      await page.getByRole("group", { name: "グループ" }).getByRole("button", { name: g }).click();
      if ((await page.getByRole("rowheader", { name: /田中/ }).count()) > 0) break;
    }
    await page.getByRole("button", { name: "24時間シート" }).click();
    await page.getByRole("navigation", { name: /の利用者$/ }).getByRole("button", { name: /田中/ }).click();
    await expect(page.getByRole("button", { name: "印刷" })).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("navigation", { name: /の利用者$/ })).toBeHidden();
    await expect(page.getByRole("region", { name: /田中.*様の24時間シート/ })).toBeVisible();
    const pdf = await page.pdf({ preferCSSPageSize: true });
    const box = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(pdf.toString("latin1"))!;
    // A4 縦 = 595 × 842 pt
    expect(Math.round(Number(box[1]))).toBe(595);
    expect(Math.round(Number(box[2]))).toBe(842);
  });
});
