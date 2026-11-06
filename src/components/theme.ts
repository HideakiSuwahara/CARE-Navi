/**
 * 画面の明るさ（決定記録 0020）。［端末に合わせる｜明るい｜暗い］を、その端末のブラウザで覚える（同期しない）。
 * <html data-theme="light|dark"> で決まる。「端末に合わせる」は属性を外す（CSS の prefers-color-scheme に任せる）。
 */
export type ThemeChoice = "auto" | "light" | "dark";
export const THEME_KEY = "care-navi:theme";

export function readTheme(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function applyTheme(choice: ThemeChoice) {
  const el = document.documentElement;
  if (choice === "auto") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", choice);
}

export function writeTheme(choice: ThemeChoice) {
  try {
    if (choice === "auto") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    // 保存できなくても、開いている間はそのまま
  }
  applyTheme(choice);
}

/** 描く前に読む小さなスクリプト（layout の <head>）。開いた瞬間に明るい画面が一瞬出ないように */
export const THEME_BOOT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
