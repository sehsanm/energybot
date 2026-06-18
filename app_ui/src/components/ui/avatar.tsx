import * as React from "react";
import { cn } from "@/lib/cn";

export function Avatar({
  name,
  className,
  size = "md",
}: {
  name?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const initials = (name || "؟")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(s => s[0])
    .join("")
    .toUpperCase();
  const sizes = {
    sm: "h-7 w-7 text-xs",
    md: "h-9 w-9 text-sm",
    lg: "h-12 w-12 text-base",
  } as const;
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-gradient-to-br from-primary/80 to-secondary/80 font-semibold text-primary-foreground select-none",
        sizes[size],
        className
      )}
    >
      {initials}
    </div>
  );
}
