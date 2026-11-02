"use client";

import type { ReactNode } from "react";
import { EngineProvider } from "@/store/react";

export function Providers({ children }: { children: ReactNode }) {
  return <EngineProvider>{children}</EngineProvider>;
}
