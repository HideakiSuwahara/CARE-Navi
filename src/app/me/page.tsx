import { MyPage } from "@/components/me/MyPage";

export const metadata = { title: "自分の予定 — ケアナビ" };

export default async function MePage({ searchParams }: { searchParams: Promise<{ task?: string; date?: string }> }) {
  const { task, date } = await searchParams;
  const valid = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  return <MyPage taskId={task} date={valid} />;
}
