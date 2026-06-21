import { Zap } from "lucide-react";
import { cn } from "@/lib/cn";

export function Brand({ className, wordmark = true }: { className?: string; wordmark?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-secondary text-primary-foreground shadow-sm">
        <Zap className="h-5 w-5" fill="currentColor" strokeWidth={1.5} />
      </span>
      {wordmark && <span className="text-lg font-bold tracking-tight">انرژی‌بات</span>}
    </div>
  );
}
