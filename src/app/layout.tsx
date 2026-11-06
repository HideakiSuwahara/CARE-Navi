import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { THEME_BOOT } from "@/components/theme";

export const metadata: Metadata = {
  title: "ケアナビ",
  description: "介護現場の一日を業務の時間割にし、必要な仕事に人を付け、一人ひとりに「いつ・どこで・誰に・何を」を案内する。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        {/* 画面の明るさを描く前に決める（決定記録 0020） */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
