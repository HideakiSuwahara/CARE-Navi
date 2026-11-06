/** 設定の「登録する」→ ボードへ渡す知らせ（sessionStorage）。{ text, errors } */
export const SETUP_NOTE_KEY = "cn-setup-note";

/**
 * 「はじめに」を出すかの印（localStorage）。ボード・自分の予定でサンプルを見たら付ける。
 * 付けないと、トップの「サンプル施設で試す」から入った人が設定を開いたとき「はじめに」に戻り、データが消えたように見える（ループ 16）。
 */
export const CHOSEN_KEY = "cn-setup-chosen";
export function readChosen(): boolean {
  try {
    return window.localStorage.getItem(CHOSEN_KEY) === "1";
  } catch {
    return false;
  }
}
export function writeChosen(on: boolean) {
  try {
    if (on) window.localStorage.setItem(CHOSEN_KEY, "1");
    else window.localStorage.removeItem(CHOSEN_KEY);
  } catch {
    // 保存できない端末では、開いている間だけ覚える
  }
}
