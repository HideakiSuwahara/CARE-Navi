import { defineConfig, devices } from "@playwright/test";

/**
 * 受け入れシナリオ（docs/acceptance.md）を E2E で確かめる。
 * - サンプル施設で3操作 → 「担当あと1人」が消える
 * - 朝の流れ（出勤者に役割 → 型を当てる）
 * - クイック操作「付き添い・外出を追加」
 * - スマホ（マイナビ）への反映
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "pc", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
