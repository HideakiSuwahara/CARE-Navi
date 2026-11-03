import { Setup } from "@/components/setup/Setup";

export const metadata = { title: "設定 — ケアナビ" };

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ join?: string }> }) {
  const { join } = await searchParams;
  return <Setup join={join} />;
}
