import type { PropsWithChildren } from "react";

import { cn } from "@/lib/utils";

export function Card({
  children,
  className
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-white/10 bg-slate-950/60 p-5 shadow-2xl shadow-slate-950/20 backdrop-blur",
        className
      )}
    >
      {children}
    </div>
  );
}
