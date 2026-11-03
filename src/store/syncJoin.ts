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

/** 新しい施設コード（6 文字の乱数。0/O・1/I を除く）。発行のたびに違うコードにする（施設 ID から決めると、サンプル施設が全員同じコードになる） */
export function newFacilityCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(6);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) crypto.getRandomValues(buf);
  else for (let i = 0; i < 6; i++) buf[i] = Math.floor(Math.random() * 0xffffffff);
  return Array.from(buf, (n) => chars[n % chars.length]).join("");
}

/** 入力された施設コードを整える（小文字→大文字、空白を除く） */
export function normalizeCode(text: string): string {
  return text.replace(/\s+/g, "").toUpperCase();
}

/** 参加用の URL（QR にする） */
export function joinUrl(origin: string, code: string): string {
  return `${origin}/setup?join=${encodeURIComponent(code)}`;
}
