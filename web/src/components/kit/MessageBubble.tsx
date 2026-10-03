"use client";

// Chat bubble with optional KB citation chips (assistant side only).

import { bubbleSide } from "./logic";
import { cn } from "@/lib/utils";

export function MessageBubble({
  role,
  content,
  citations,
}: {
  role: string;
  content: string;
  citations?: string[];
}) {
  const side = bubbleSide(role);
  const isUser = side === "user";
  return (
    <div className={cn("flex max-w-[85%] flex-col gap-1.5", isUser ? "mr-auto" : "ml-auto")}>
      <div
        className={cn(
          "rounded-3xl px-4 py-2.5 text-sm leading-6",
          isUser
            ? "rounded-bl-lg bg-[var(--primary)] text-[var(--primary-foreground)]"
            : "rounded-br-lg bg-[var(--card)] text-[var(--card-foreground)] shadow-sm",
        )}
      >
        {content}
      </div>
      {!isUser && citations && citations.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold text-[var(--muted-foreground)]">منابع:</span>
          {citations.map((c, i) => (
            <span
              key={i}
              className="rounded-full border border-[var(--border)] bg-[var(--secondary)] px-2 py-0.5 text-[10px] text-[var(--secondary-foreground)]"
            >
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
