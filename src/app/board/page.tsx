import { Board } from "@/components/board/Board";

export const metadata = { title: "ボード — ケアナビ" };

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const valid = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  return <Board date={valid} />;
}
