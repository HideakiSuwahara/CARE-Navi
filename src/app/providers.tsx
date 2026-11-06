"use client";

import { useEffect, type ReactNode } from "react";
import { watchTheme } from "@/components/theme";
import { EngineProvider } from "@/store/react";

export function Providers({ children }: { children: ReactNode }) {
  // 画面の明るさを、同じブラウザのほかのタブで変えたらそろえる（決定記録 0020、ループ 18）
  useEffect(() => watchTheme(), []);
  return <EngineProvider>{children}</EngineProvider>;
}
