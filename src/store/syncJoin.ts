/**
 * この端末がどの施設コードで同期しているか（ブラウザに覚える）。決定記録 0009
 * - 未参加なら null → LocalStore（ブラウザ内保存）
 * - 参加していれば SyncStore（Supabase）
 * 切り替えは、覚えてから画面を読み込み直す（Engine を作り直す最も確かな方法）。
 */

const KEY = "care-navi.sync-code";

export function readSyncCode(): string | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v && /^[A-Z0-9]{4,12}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeSyncCode(code: string | null): void {
  try {
    if (code) window.localStorage.setItem(KEY, code);
    else window.localStorage.removeItem(KEY);
  } catch {
    // 覚えられない端末では、このタブだけで動く
  }
}

/** 入力された施設コードを整える（小文字→大文字、空白を除く） */
export function normalizeCode(text: string): string {
  return text.replace(/\s+/g, "").toUpperCase();
}

/** 参加用の URL（QR にする） */
export function joinUrl(origin: string, code: string): string {
  return `${origin}/setup?join=${encodeURIComponent(code)}`;
}
