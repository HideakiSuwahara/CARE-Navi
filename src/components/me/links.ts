/** 業務詳細を開いた予定（戻ったときに、その行へフォーカスを返す） */
export const LAST_TASK_KEY = "cn-me-last-task";

/** 自分の予定の中の行き来。デモ用の ?now= と ?date= は引き継ぐ */
export function meHref(taskId?: string): string {
  const q = new URLSearchParams();
  if (typeof window !== "undefined") {
    const cur = new URLSearchParams(window.location.search);
    for (const k of ["now", "date"]) {
      const v = cur.get(k);
      if (v) q.set(k, v);
    }
  }
  if (taskId) q.set("task", taskId);
  const s = q.toString();
  return s ? `/me?${s}` : "/me";
}
